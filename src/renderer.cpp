#include "renderer.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <limits>
#include <thread>
#include <vector>

namespace st {
namespace {

int effective_threads(int requested) {
    if (requested > 0) {
        return requested;
    }
    const unsigned int hw = std::thread::hardware_concurrency();
    return static_cast<int>(hw == 0 ? 4 : hw);
}

void parallel_for(int count, int threads, const std::function<void(int)>& work) {
    if (count <= 0) {
        return;
    }
    threads = std::max(1, std::min(threads, count));
    std::atomic<int> next{0};
    std::vector<std::thread> workers;
    workers.reserve(static_cast<std::size_t>(threads));
    for (int t = 0; t < threads; ++t) {
        workers.emplace_back([&] {
            for (;;) {
                const int index = next.fetch_add(1, std::memory_order_relaxed);
                if (index >= count) {
                    return;
                }
                work(index);
            }
        });
    }
    for (std::thread& worker : workers) {
        worker.join();
    }
}

double halton(std::uint64_t index, int base) {
    double result = 0.0;
    double fraction = 1.0 / static_cast<double>(base);
    while (index > 0) {
        result += fraction * static_cast<double>(index % static_cast<std::uint64_t>(base));
        index /= static_cast<std::uint64_t>(base);
        fraction /= static_cast<double>(base);
    }
    return result;
}

double pixel_phase(std::uint64_t pixel, int dimension) {
    const std::uint64_t h = hash_combine(pixel, static_cast<std::uint64_t>(dimension));
    return static_cast<double>(h >> 11) * (1.0 / 9007199254740992.0);
}

double medium_ior(Medium medium, double lambda_nm) {
    switch (medium) {
        case Medium::PrismGlass:
            return prism_ior(lambda_nm);
        case Medium::TubeGlass:
            return tube_glass_ior(lambda_nm);
        case Medium::Water:
            return water_ior(lambda_nm);
        case Medium::Air:
            return air_ior();
    }
    return air_ior();
}

double medium_absorption_scalar(Medium medium, double lambda_nm) {
    if (medium == Medium::Air) {
        return 0.0;
    }
    const Vec3 sigma = material_absorption(
        medium == Medium::PrismGlass ? Material::PrismGlass :
        medium == Medium::TubeGlass ? Material::TubeGlass : Material::Water,
        lambda_nm);
    return (sigma.x + sigma.y + sigma.z) / 3.0;
}

struct Projection {
    bool valid = false;
    double x = 0.0;
    double y = 0.0;
    double distance = 0.0;
};

Projection project_point(const Camera& camera, const Vec3& point) {
    Projection result;
    const Vec3 rel = point - camera.origin;
    const Vec3 forward = camera.forward();
    const double z = dot(rel, forward);
    if (z <= 1e-5) {
        return result;
    }
    const double half_h = camera.image_plane_half_height();
    const double u = dot(rel, camera.right()) / (z * half_h * camera.pixel_aspect());
    const double v = dot(rel, camera.camera_up()) / (z * half_h);
    if (u < -1.1 || u > 1.1 || v < -1.1 || v > 1.1) {
        return result;
    }
    result.valid = true;
    result.x = (u * 0.5 + 0.5) * static_cast<double>(camera.width) - 0.5;
    result.y = (0.5 - v * 0.5) * static_cast<double>(camera.height) - 0.5;
    result.distance = length(rel);
    return result;
}

double sample_image_bilinear(const std::vector<double>& image, int width, int height,
                             int channel, const Projection& projection) {
    if (!projection.valid) {
        return 0.0;
    }
    const double x = clamp(projection.x, 0.0, static_cast<double>(width - 1));
    const double y = clamp(projection.y, 0.0, static_cast<double>(height - 1));
    const int x0 = static_cast<int>(std::floor(x));
    const int y0 = static_cast<int>(std::floor(y));
    const int x1 = std::min(x0 + 1, width - 1);
    const int y1 = std::min(y0 + 1, height - 1);
    const double fx = x - static_cast<double>(x0);
    const double fy = y - static_cast<double>(y0);
    const std::size_t plane = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    const std::size_t base = static_cast<std::size_t>(channel) * plane;
    const auto at = [&](int px, int py) {
        return image[base + static_cast<std::size_t>(py) * width + px];
    };
    const double a = at(x0, y0) * (1.0 - fx) + at(x1, y0) * fx;
    const double b = at(x0, y1) * (1.0 - fx) + at(x1, y1) * fx;
    return a * (1.0 - fy) + b * fy;
}

double smith_g1(double no_v, double alpha) {
    const double a2 = alpha * alpha;
    const double cos2 = no_v * no_v;
    return 2.0 * no_v / std::max(1e-12, no_v +
           std::sqrt(a2 + (1.0 - a2) * cos2));
}

Vec3 sample_ggx_half(const Vec3& normal, double alpha, Rng& rng) {
    const double u1 = rng.next();
    const double u2 = rng.next();
    const double phi = 2.0 * kPi * u2;
    const double a2 = alpha * alpha;
    const double cos_theta = std::sqrt((1.0 - u1) /
        (1.0 + (a2 - 1.0) * u1));
    const double sin_theta = std::sqrt(std::max(0.0, 1.0 - cos_theta * cos_theta));
    const OrthoBasis basis = make_basis(normal);
    return normalize(basis.u * (sin_theta * std::cos(phi)) +
                     basis.v * (sin_theta * std::sin(phi)) +
                     basis.w * cos_theta);
}

bool refract_direction(const Vec3& direction, const Vec3& normal,
                       double eta, Vec3& refracted) {
    const double cos_i = clamp(-dot(direction, normal), 0.0, 1.0);
    const double sin_t2 = eta * eta * std::max(0.0, 1.0 - cos_i * cos_i);
    if (sin_t2 >= 1.0) {
        return false;
    }
    const double cos_t = std::sqrt(std::max(0.0, 1.0 - sin_t2));
    refracted = normalize(direction * eta + normal * (eta * cos_i - cos_t));
    return true;
}

double pixel_solid_angle(const Camera& camera) {
    const double f = 2.0 * camera.image_plane_half_height() /
                     static_cast<double>(camera.height);
    return f * f;
}

double focal_pixels(const Camera& camera) {
    return 0.5 * static_cast<double>(camera.height) / camera.image_plane_half_height();
}

struct SourceSample {
    Vec3 origin;
    Vec3 direction;
    double wavelength_u = 0.5;
    std::uint64_t rng_seed = 1;
};

SourceSample make_source_sample(const Scene& scene, int sample_index,
                                std::uint64_t salt) {
    SourceSample sample;
    const std::uint64_t seed = hash_combine(
        static_cast<std::uint64_t>(sample_index), salt);
    Rng rng(seed);
    sample.origin = scene.source.center +
        scene.source.right * (2.0 * scene.source.aperture_half_width * (rng.next() - 0.5)) +
        scene.source.up * (2.0 * scene.source.aperture_half_height * (rng.next() - 0.5));
    sample.direction = sample_cone(scene.source.axis, scene.source.cone_half_angle, rng);
    sample.wavelength_u = rng.next();
    sample.rng_seed = seed;
    return sample;
}

}  // namespace
}  // namespace st

namespace st {
namespace {

double tone_map_channel(double value, double exposure) {
    double x = std::max(0.0, value) * exposure;
    x = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
    x = saturate(x);
    return x <= 0.0031308
        ? 12.92 * x
        : 1.055 * std::pow(x, 1.0 / 2.4) - 0.055;
}

std::uint8_t to_byte(double x) {
    return static_cast<std::uint8_t>(std::lround(saturate(x) * 255.0));
}

}  // namespace

double image_luminance_energy(const std::vector<double>& rgb,
                              int width, int height) {
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    double sum = 0.0;
    for (std::size_t i = 0; i < pixels; ++i) {
        sum += 0.2126 * rgb[i * 3 + 0] +
               0.7152 * rgb[i * 3 + 1] +
               0.0722 * rgb[i * 3 + 2];
    }
    return sum;
}

std::uint64_t image_region_pixel_count(const std::vector<std::uint8_t>& mask,
                                       Material material) {
    std::uint64_t count = 0;
    for (std::uint8_t value : mask) {
        if (value == static_cast<std::uint8_t>(material)) {
            ++count;
        }
    }
    return count;
}

Vec3 image_region_mean_rgb(const std::vector<double>& rgb, int width, int height,
                           const std::vector<std::uint8_t>& mask,
                           Material material) {
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    Vec3 sum(0.0, 0.0, 0.0);
    std::uint64_t count = 0;
    for (std::size_t i = 0; i < pixels && i < mask.size(); ++i) {
        if (mask[i] != static_cast<std::uint8_t>(material)) {
            continue;
        }
        sum += Vec3(rgb[i * 3 + 0], rgb[i * 3 + 1], rgb[i * 3 + 2]);
        ++count;
    }
    if (count == 0) {
        return sum;
    }
    return sum / static_cast<double>(count);
}

void write_band_pfm(const std::string& path, const std::vector<double>& image,
                    int width, int height) {
    std::ofstream out(path, std::ios::binary);
    out << "Pf\n" << width << " " << height << "\n-1.0\n";
    for (int y = height - 1; y >= 0; --y) {
        for (int x = 0; x < width; ++x) {
            const double value =
                image[static_cast<std::size_t>(y) * width + x];
            const float pixel = static_cast<float>(value);
            out.write(reinterpret_cast<const char*>(&pixel), sizeof(pixel));
        }
    }
}

void write_rgb_ppm(const std::string& path, const std::vector<double>& rgb,
                   int width, int height, double exposure) {
    std::ofstream out(path, std::ios::binary);
    out << "P6\n" << width << " " << height << "\n255\n";
    std::vector<unsigned char> row(static_cast<std::size_t>(width) * 3);
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const std::size_t index = static_cast<std::size_t>(y) * width + x;
            row[static_cast<std::size_t>(x) * 3 + 0] =
                to_byte(tone_map_channel(rgb[index * 3 + 0], exposure));
            row[static_cast<std::size_t>(x) * 3 + 1] =
                to_byte(tone_map_channel(rgb[index * 3 + 1], exposure));
            row[static_cast<std::size_t>(x) * 3 + 2] =
                to_byte(tone_map_channel(rgb[index * 3 + 2], exposure));
        }
        out.write(reinterpret_cast<const char*>(row.data()),
                  static_cast<std::streamsize>(row.size()));
    }
}

void write_geometry_pgm(const std::string& path,
                        const std::vector<std::uint32_t>& geometry,
                        int width, int height) {
    std::ofstream out(path, std::ios::binary);
    out << "P5\n" << width << " " << height << "\n255\n";
    std::vector<unsigned char> row(static_cast<std::size_t>(width));
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            const std::size_t index = static_cast<std::size_t>(y) * width + x;
            const std::uint32_t id = geometry[index];
            row[static_cast<std::size_t>(x)] = id == 0
                ? 0
                : static_cast<unsigned char>(24 + (hash_u64(id) % 220));
        }
        out.write(reinterpret_cast<const char*>(row.data()),
                  static_cast<std::streamsize>(row.size()));
    }
}

void write_depth_pfm(const std::string& path, const std::vector<float>& depth,
                     int width, int height) {
    std::ofstream out(path, std::ios::binary);
    out << "Pf\n" << width << " " << height << "\n-1.0\n";
    for (int y = height - 1; y >= 0; --y) {
        for (int x = 0; x < width; ++x) {
            float value = depth[static_cast<std::size_t>(y) * width + x];
            if (!std::isfinite(value)) {
                value = -1.0f;
            }
            out.write(reinterpret_cast<const char*>(&value), sizeof(value));
        }
    }
}

}  // namespace st

namespace st {
namespace {

struct LightChannelResult {
    BandLightStats stats;
    std::vector<double> diffuse;
    std::vector<double> metal;
};

struct LightTransport {
    std::vector<LightChannelResult> channels;
};

struct VisibilityBuffers {
    std::vector<float> opaque_depth;
    std::vector<std::uint8_t> primary_material;
    std::vector<std::uint32_t> primary_geometry;
    std::uint64_t edge_pixels = 0;
    std::uint64_t edge_hash = 0;
};

struct CausticSet {
    const std::vector<double>* diffuse = nullptr;
    const std::vector<double>* metal = nullptr;
    int channels = 0;
    int width = 0;
    int height = 0;
    double pixel_solid = 0.0;
};

VisibilityBuffers build_visibility(const Scene& scene, int threads);
LightChannelResult render_light_channel(const Scene& scene,
                                        const std::vector<float>& opaque_depth,
                                        double lambda_lo, double lambda_hi,
                                        int photon_count,
                                        double channel_source_power,
                                        int max_depth,
                                        std::uint64_t salt,
                                        double pixel_solid,
                                        double focal_px);
LightTransport run_light_transport(const Scene& scene,
                                   const std::vector<float>& opaque_depth,
                                   const RenderConfig& config, bool spectral);
std::vector<double> render_spectral_eye(const Scene& scene,
                                        const RenderConfig& config,
                                        const CausticSet& caustics);
std::vector<double> render_rgb_eye(const Scene& scene,
                                   const RenderConfig& config,
                                   const CausticSet& caustics);
double trace_eye(const Scene& scene, const Vec3& ray_origin,
                 const Vec3& ray_direction, double lambda_nm, int channel,
                 int depth, Medium medium, Rng rng,
                 const CausticSet& caustics, int max_depth);

}  // namespace

RenderResult render_frame(const Scene& scene, const RenderConfig& config) {
    const auto start = std::chrono::steady_clock::now();
    const int width = scene.camera.width;
    const int height = scene.camera.height;
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    const int threads = effective_threads(config.threads);
    const double pixel_solid = pixel_solid_angle(scene.camera);

    std::cerr << "[" << config.label << "] visibility pass\n";
    VisibilityBuffers visibility = build_visibility(scene, threads);

    std::cerr << "[" << config.label << "] spectral photon pass: "
              << config.photon_samples << " hero samples x " << kBandCount
              << " companion bands\n";
    LightTransport spectral_light = run_light_transport(
        scene, visibility.opaque_depth, config, true);

    std::vector<double> spectral_diffuse(pixels * kBandCount, 0.0);
    std::vector<double> spectral_metal(pixels * kBandCount, 0.0);
    for (int channel = 0; channel < kBandCount; ++channel) {
        const std::size_t offset = static_cast<std::size_t>(channel) * pixels;
        const LightChannelResult& source = spectral_light.channels[static_cast<std::size_t>(channel)];
        std::copy(source.diffuse.begin(), source.diffuse.end(),
                  spectral_diffuse.begin() + static_cast<std::ptrdiff_t>(offset));
        std::copy(source.metal.begin(), source.metal.end(),
                  spectral_metal.begin() + static_cast<std::ptrdiff_t>(offset));
    }
    CausticSet spectral_caustics;
    spectral_caustics.diffuse = &spectral_diffuse;
    spectral_caustics.metal = &spectral_metal;
    spectral_caustics.channels = kBandCount;
    spectral_caustics.width = width;
    spectral_caustics.height = height;
    spectral_caustics.pixel_solid = pixel_solid;

    std::cerr << "[" << config.label << "] spectral eye pass: "
              << config.samples_per_band << " samples per band\n";
    std::vector<double> spectral_image = render_spectral_eye(
        scene, config, spectral_caustics);

    std::cerr << "[" << config.label << "] RGB-approximation photon pass\n";
    LightTransport rgb_light = run_light_transport(
        scene, visibility.opaque_depth, config, false);
    std::vector<double> rgb_diffuse(pixels * 3, 0.0);
    std::vector<double> rgb_metal(pixels * 3, 0.0);
    for (int channel = 0; channel < 3; ++channel) {
        const std::size_t offset = static_cast<std::size_t>(channel) * pixels;
        const LightChannelResult& source = rgb_light.channels[static_cast<std::size_t>(channel)];
        std::copy(source.diffuse.begin(), source.diffuse.end(),
                  rgb_diffuse.begin() + static_cast<std::ptrdiff_t>(offset));
        std::copy(source.metal.begin(), source.metal.end(),
                  rgb_metal.begin() + static_cast<std::ptrdiff_t>(offset));
    }
    CausticSet rgb_caustics;
    rgb_caustics.diffuse = &rgb_diffuse;
    rgb_caustics.metal = &rgb_metal;
    rgb_caustics.channels = 3;
    rgb_caustics.width = width;
    rgb_caustics.height = height;
    rgb_caustics.pixel_solid = pixel_solid;

    std::cerr << "[" << config.label << "] RGB-approximation eye pass\n";
    std::vector<double> rgb_image = render_rgb_eye(scene, config, rgb_caustics);

    RenderResult result;
    result.width = width;
    result.height = height;
    result.label = config.label;
    result.exposure = config.exposure;
    result.opaque_depth = std::move(visibility.opaque_depth);
    result.primary_material = std::move(visibility.primary_material);
    result.primary_geometry = std::move(visibility.primary_geometry);
    result.geometry_edge_pixels = visibility.edge_pixels;
    result.geometry_edge_hash = visibility.edge_hash;
    result.spectral_bands = std::move(spectral_image);
    result.rgb_approx = std::move(rgb_image);
    for (int channel = 0; channel < kBandCount; ++channel) {
        result.band_stats[static_cast<std::size_t>(channel)] =
            spectral_light.channels[static_cast<std::size_t>(channel)].stats;
        double energy = 0.0;
        const std::size_t offset = static_cast<std::size_t>(channel) * pixels;
        for (std::size_t i = 0; i < pixels; ++i) {
            energy += result.spectral_bands[offset + i];
        }
        result.spectral_image_energy[static_cast<std::size_t>(channel)] = energy;
    }
    for (int channel = 0; channel < 3; ++channel) {
        const BandLightStats& src =
            rgb_light.channels[static_cast<std::size_t>(channel)].stats;
        ChannelStats& dst = result.rgb_stats[static_cast<std::size_t>(channel)];
        dst.wavelength_nm = src.wavelength_nm;
        dst.centroid_x = src.centroid_x;
        dst.centroid_y = src.centroid_y;
        dst.centroid_z = src.centroid_z;
        dst.centroid_weight = src.centroid_weight;
        dst.receiver_power = src.receiver_power;
        double energy = 0.0;
        const std::size_t offset = static_cast<std::size_t>(channel) * pixels;
        for (std::size_t i = 0; i < pixels; ++i) {
            energy += result.rgb_approx[offset + i];
        }
        result.rgb_image_energy[static_cast<std::size_t>(channel)] = energy;
    }

    std::vector<double> rgb_interleaved(pixels * 3, 0.0);
    for (std::size_t i = 0; i < pixels; ++i) {
        for (int channel = 0; channel < 3; ++channel) {
            rgb_interleaved[i * 3 + static_cast<std::size_t>(channel)] =
                result.rgb_approx[static_cast<std::size_t>(channel) * pixels + i];
        }
    }
    result.rgb_approx = std::move(rgb_interleaved);

    result.caustic_energy.resize(kBandCount, 0.0);
    result.caustic_bands.assign(pixels * kBandCount, 0.0);
    for (int channel = 0; channel < kBandCount; ++channel) {
        const std::size_t offset = static_cast<std::size_t>(channel) * pixels;
        double sum = 0.0;
        for (std::size_t i = 0; i < pixels; ++i) {
            const double value = spectral_diffuse[offset + i] +
                                 spectral_metal[offset + i];
            result.caustic_bands[offset + i] = value;
            sum += value;
        }
        result.caustic_energy[static_cast<std::size_t>(channel)] = sum;
    }

    const auto end = std::chrono::steady_clock::now();
    result.seconds = std::chrono::duration<double>(end - start).count();
    return result;
}

std::vector<double> integrate_spectral_image(const std::vector<double>& bands,
                                             int width, int height) {
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    std::vector<double> rgb(pixels * 3, 0.0);
    for (std::size_t i = 0; i < pixels; ++i) {
        std::array<double, kBandCount> sample{};
        for (int band = 0; band < kBandCount; ++band) {
            sample[static_cast<std::size_t>(band)] =
                bands[static_cast<std::size_t>(band) * pixels + i];
        }
        const Vec3 color = spectrum_to_linear_srgb(sample);
        rgb[i * 3 + 0] = color.x;
        rgb[i * 3 + 1] = color.y;
        rgb[i * 3 + 2] = color.z;
    }
    return rgb;
}

}  // namespace st

namespace st {
namespace {

LightTransport run_light_transport(const Scene& scene,
                                   const std::vector<float>& opaque_depth,
                                   const RenderConfig& config, bool spectral) {
    const int channels = spectral ? kBandCount : 3;
    const double pixel_solid = pixel_solid_angle(scene.camera);
    const double focal_px = focal_pixels(scene.camera);
    const double channel_power = 1.0 / static_cast<double>(channels);
    const std::uint64_t salt = spectral ? 0x51a17e5eULL : 0x7b9c31d4ULL;
    LightTransport transport;
    transport.channels.resize(static_cast<std::size_t>(channels));
    parallel_for(channels, effective_threads(config.threads), [&](int channel) {
        double lo = 0.0;
        double hi = 0.0;
        if (spectral) {
            const SpectralBand& band = bands()[static_cast<std::size_t>(channel)];
            lo = band.lo;
            hi = band.hi;
        } else {
            lo = hi = rgb_primaries()[static_cast<std::size_t>(channel)].lambda;
        }
        transport.channels[static_cast<std::size_t>(channel)] = render_light_channel(
            scene, opaque_depth, lo, hi, config.photon_samples, channel_power,
            config.max_depth, salt, pixel_solid, focal_px);
    });
    return transport;
}

std::vector<double> render_spectral_eye(const Scene& scene,
                                        const RenderConfig& config,
                                        const CausticSet& caustics) {
    const int width = scene.camera.width;
    const int height = scene.camera.height;
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    std::vector<double> image(pixels * kBandCount, 0.0);
    const int samples = std::max(1, config.samples_per_band);
    const double inv_samples = 1.0 / static_cast<double>(samples);

    parallel_for(height, effective_threads(config.threads), [&](int py) {
        for (int px = 0; px < width; ++px) {
            const std::size_t index = static_cast<std::size_t>(py) * width + px;
            const std::uint64_t pixel_hash = hash_combine(
                static_cast<std::uint64_t>(index), 0x9e3779b97f4a7c15ULL);
            for (int s = 0; s < samples; ++s) {
                const double jx = std::fmod(
                    halton(static_cast<std::uint64_t>(s) + 1, 2) +
                    pixel_phase(pixel_hash, 1), 1.0);
                const double jy = std::fmod(
                    halton(static_cast<std::uint64_t>(s) + 1, 3) +
                    pixel_phase(pixel_hash, 2), 1.0);
                const Vec3 direction = scene.camera.ray_direction(
                    static_cast<double>(px) + jx,
                    static_cast<double>(py) + jy);
                const uint64_t path_seed = hash_combine(
                    pixel_hash, static_cast<std::uint64_t>(s) + 1);
                const double wave_u = std::fmod(
                    halton(static_cast<std::uint64_t>(s) + 1, 5) +
                    pixel_phase(pixel_hash, 5), 1.0);
                const int hero_band = hero_band_index(s, pixel_hash);
                for (int offset = 0; offset < kBandCount; ++offset) {
                    const int band = (hero_band + offset) % kBandCount;
                    const SpectralBand& spec = bands()[static_cast<std::size_t>(band)];
                    const double lambda = spec.sample(wave_u);
                    Rng rng(path_seed);
                    const double radiance = trace_eye(
                        scene, scene.camera.origin, direction, lambda, band,
                        0, Medium::Air, rng, caustics, config.max_depth);
                    const std::size_t out = static_cast<std::size_t>(band) * pixels + index;
                    image[out] += radiance * inv_samples;
                }
            }
        }
    });
    return image;
}

std::vector<double> render_rgb_eye(const Scene& scene,
                                   const RenderConfig& config,
                                   const CausticSet& caustics) {
    const int width = scene.camera.width;
    const int height = scene.camera.height;
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    std::vector<double> image(pixels * 3, 0.0);
    const int samples = std::max(1, config.samples_per_band);
    const double inv_samples = 1.0 / static_cast<double>(samples);

    parallel_for(height, effective_threads(config.threads), [&](int py) {
        for (int px = 0; px < width; ++px) {
            const std::size_t index = static_cast<std::size_t>(py) * width + px;
            const std::uint64_t pixel_hash = hash_combine(
                static_cast<std::uint64_t>(index), 0xd1b54a32d192ed03ULL);
            for (int s = 0; s < samples; ++s) {
                const double jx = std::fmod(
                    halton(static_cast<std::uint64_t>(s) + 1, 2) +
                    pixel_phase(pixel_hash, 11), 1.0);
                const double jy = std::fmod(
                    halton(static_cast<std::uint64_t>(s) + 1, 3) +
                    pixel_phase(pixel_hash, 12), 1.0);
                const Vec3 direction = scene.camera.ray_direction(
                    static_cast<double>(px) + jx,
                    static_cast<double>(py) + jy);
                const uint64_t path_seed = hash_combine(
                    pixel_hash, static_cast<std::uint64_t>(s) + 1);
                for (int channel = 0; channel < 3; ++channel) {
                    const double lambda =
                        rgb_primaries()[static_cast<std::size_t>(channel)].lambda;
                    Rng rng(path_seed);
                    const double radiance = trace_eye(
                        scene, scene.camera.origin, direction, lambda, channel,
                        0, Medium::Air, rng, caustics, config.max_depth);
                    const std::size_t out =
                        static_cast<std::size_t>(channel) * pixels + index;
                    image[out] += radiance * inv_samples;
                }
            }
        }
    });
    return image;
}

}  // namespace
}  // namespace st

namespace st {
namespace {

VisibilityBuffers build_visibility(const Scene& scene, int threads) {
    const int width = scene.camera.width;
    const int height = scene.camera.height;
    const std::size_t pixels = static_cast<std::size_t>(width) * height;
    VisibilityBuffers result;
    result.opaque_depth.assign(pixels, std::numeric_limits<float>::infinity());
    result.primary_material.assign(pixels, 255);
    result.primary_geometry.assign(pixels, 0);

    parallel_for(height, threads, [&](int py) {
        for (int px = 0; px < width; ++px) {
            const double sx = static_cast<double>(px) + 0.5;
            const double sy = static_cast<double>(py) + 0.5;
            const Vec3 direction = scene.camera.ray_direction(sx, sy);
            Vec3 origin = scene.camera.origin;
            const std::size_t index = static_cast<std::size_t>(py) * width + px;

            Hit first;
            if (scene.intersect(origin, direction, 1e-5, kInf, first, true)) {
                result.primary_material[index] =
                    static_cast<std::uint8_t>(first.material);
                result.primary_geometry[index] = first.geometry_id;
            }

            double distance = 0.0;
            Vec3 ray_origin = origin;
            Vec3 ray_direction = direction;
            for (int bounce = 0; bounce < 24; ++bounce) {
                Hit hit;
                if (!scene.intersect(ray_origin, ray_direction, 1e-5, kInf,
                                     hit, true)) {
                    break;
                }
                distance += hit.t;
                if (material_is_dielectric(hit.material)) {
                    ray_origin = hit.point + ray_direction * 3e-5;
                    continue;
                }
                result.opaque_depth[index] = static_cast<float>(distance);
                break;
            }
        }
    });

    std::vector<std::uint8_t> edges(pixels, 0);
    parallel_for(height, threads, [&](int py) {
        for (int px = 0; px < width; ++px) {
            const std::size_t index = static_cast<std::size_t>(py) * width + px;
            const std::uint8_t mat = result.primary_material[index];
            const float depth = result.opaque_depth[index];
            bool edge = false;
            const int nx[2] = {px + 1, px};
            const int ny[2] = {py, py + 1};
            for (int k = 0; k < 2; ++k) {
                if (nx[k] >= width || ny[k] >= height) {
                    continue;
                }
                const std::size_t ni = static_cast<std::size_t>(ny[k]) * width + nx[k];
                if (result.primary_material[ni] != mat) {
                    edge = true;
                }
                const float nd = result.opaque_depth[ni];
                const bool a_inf = std::isinf(depth);
                const bool b_inf = std::isinf(nd);
                if (a_inf != b_inf) {
                    edge = true;
                } else if (!a_inf) {
                    const double delta = std::abs(static_cast<double>(depth) -
                                                  static_cast<double>(nd));
                    if (delta > 0.025 + 0.04 * std::min(depth, nd)) {
                        edge = true;
                    }
                }
            }
            if (edge) {
                edges[index] = 1;
            }
        }
    });

    std::uint64_t hash = 1469598103934665603ULL;
    for (std::uint8_t value : edges) {
        if (value) {
            ++result.edge_pixels;
        }
        hash ^= static_cast<std::uint64_t>(value);
        hash *= 1099511628211ULL;
    }
    result.edge_hash = hash;
    return result;
}

double environment_radiance(const Vec3& direction, double lambda_nm) {
    const double t = saturate((lambda_nm - 400.0) / 320.0);
    const double up = saturate(direction.y * 0.5 + 0.5);
    const double horizon = std::exp(-9.0 * direction.y * direction.y);
    return (0.018 - 0.004 * t) * (0.55 + 0.55 * up + 0.18 * horizon);
}

double sample_fill_light(const Scene& scene, const Hit& hit,
                         double lambda_nm, Rng& rng) {
    const RectEmitter& light = scene.fill_light();
    const Vec3 sample_point = light.center +
        normalize(light.axis_u) * (2.0 * light.half_u * (rng.next() - 0.5)) +
        normalize(light.axis_v) * (2.0 * light.half_v * (rng.next() - 0.5));
    Vec3 to_light = sample_point - hit.point;
    const double dist2 = length2(to_light);
    if (dist2 < 1e-8) {
        return 0.0;
    }
    const double dist = std::sqrt(dist2);
    const Vec3 wi = to_light / dist;
    const double cos_surface = dot(hit.normal, wi);
    const double cos_emitter = dot(light.normal, -wi);
    if (cos_surface <= 0.0 || cos_emitter <= 0.0) {
        return 0.0;
    }
    const Vec3 shadow_origin = hit.point + hit.normal * 3e-5;
    if (scene.occluded(shadow_origin, wi, 1e-5, dist - 2e-4)) {
        return 0.0;
    }
    const double pdf = dist2 / std::max(1e-9, light.area() * cos_emitter);
    const double albedo = material_albedo(hit.material, lambda_nm);
    return light.radiance * albedo / kPi * cos_surface / pdf;
}

double trace_eye(const Scene& scene, const Vec3& ray_origin,
                 const Vec3& ray_direction, double lambda_nm, int channel,
                 int depth, Medium medium, Rng rng,
                 const CausticSet& caustics, int max_depth) {
    if (depth >= max_depth) {
        return 0.0;
    }
    Hit hit;
    if (!scene.intersect(ray_origin, ray_direction, 1e-5, kInf, hit, true)) {
        return environment_radiance(ray_direction, lambda_nm);
    }

    if (hit.material == Material::BeamEmitter) {
        return scene.beam_light().radiance;
    }
    if (hit.material == Material::FillEmitter) {
        return scene.fill_light().radiance;
    }

    if (material_is_dielectric(hit.material)) {
        const double sigma = medium_absorption_scalar(medium, lambda_nm);
        const double transmittance = sigma > 0.0 ? std::exp(-sigma * hit.t) : 1.0;
        const double cos_i = clamp(-dot(ray_direction, hit.normal), 0.0, 1.0);
        const double n_i = medium_ior(medium, lambda_nm);
        const double n_t = hit.front_face
            ? material_ior(hit.material, lambda_nm) : air_ior();
        const double eta = n_i / n_t;
        const double fresnel = dielectric_fresnel(cos_i, n_i, n_t);
        Vec3 refracted;
        if (!refract_direction(ray_direction, hit.normal, eta, refracted)) {
            const Vec3 reflected = normalize(reflect_dir(ray_direction, hit.normal));
            return transmittance * trace_eye(
                scene, hit.point + reflected * 2e-5, reflected, lambda_nm,
                channel, depth + 1, medium, rng, caustics, max_depth);
        }
        const double p_reflect = clamp(fresnel, 2e-4, 0.9998);
        if (rng.next() < p_reflect) {
            const Vec3 reflected = normalize(reflect_dir(ray_direction, hit.normal));
            return transmittance * (fresnel / p_reflect) * trace_eye(
                scene, hit.point + reflected * 2e-5, reflected, lambda_nm,
                channel, depth + 1, medium, rng, caustics, max_depth);
        }
        const Medium next_medium =
            hit.front_face ? material_medium(hit.material) : Medium::Air;
        return transmittance * ((1.0 - fresnel) / (1.0 - p_reflect)) * trace_eye(
            scene, hit.point + refracted * 2e-5, refracted, lambda_nm,
            channel, depth + 1, next_medium, rng, caustics, max_depth);
    }

    const Projection projection = project_point(scene.camera, hit.point);
    double caustic = 0.0;
    if (caustics.diffuse != nullptr) {
        caustic += sample_image_bilinear(*caustics.diffuse, caustics.width,
                                        caustics.height, channel, projection);
    }

    if (hit.material == Material::Brass) {
        double metal_caustic = 0.0;
        if (caustics.metal != nullptr) {
            metal_caustic = sample_image_bilinear(*caustics.metal, caustics.width,
                                                  caustics.height, channel, projection);
        }
        const double no_v = clamp(dot(-ray_direction, hit.normal), 1e-4, 1.0);
        const BrassIor ior = brass_ior(lambda_nm);
        const double fresnel = conductor_fresnel(no_v, ior.n, ior.k);
        const double alpha = std::max(1e-3, material_roughness(hit.material));
        const Vec3 half = sample_ggx_half(hit.normal, alpha, rng);
        Vec3 reflected = normalize(reflect_dir(ray_direction, half));
        if (dot(reflected, hit.normal) <= 0.0) {
            reflected = normalize(reflect_dir(ray_direction, hit.normal));
        }
        const double no_l = clamp(dot(reflected, hit.normal), 1e-4, 1.0);
        const double no_h = clamp(dot(half, hit.normal), 1e-4, 1.0);
        const double g = smith_g1(no_v, alpha) * smith_g1(no_l, alpha);
        const double weight = fresnel * g / no_h;
        const double reflected_radiance = trace_eye(
            scene, hit.point + reflected * 4e-5, reflected, lambda_nm,
            channel, depth + 1, Medium::Air, rng, caustics, max_depth);
        return metal_caustic * 1.35 + weight * reflected_radiance;
    }

    const double albedo = material_albedo(hit.material, lambda_nm);
    const double direct = sample_fill_light(scene, hit, lambda_nm, rng);
    const double ambient = albedo * 0.032 *
        (0.65 + 0.35 * std::max(0.0, hit.normal.y));
    return albedo * caustic + direct + ambient;
}

}  // namespace
}  // namespace st

namespace st {
namespace {

void splat_receiver(std::vector<double>& target,
                    const std::vector<float>& opaque_depth,
                    const Camera& camera, const Vec3& point,
                    double power, double pixel_solid,
                    double focal_px, double gain) {
    const Projection projection = project_point(camera, point);
    if (!projection.valid || power <= 0.0) {
        return;
    }
    const double sigma = std::max(0.58, 0.013 * focal_px /
                                  std::max(projection.distance, 0.1));
    const int reach = std::max(1, static_cast<int>(std::ceil(3.0 * sigma)));
    const int cx = static_cast<int>(std::lround(projection.x));
    const int cy = static_cast<int>(std::lround(projection.y));
    const double norm = 1.0 / (2.0 * kPi * sigma * sigma);
    const double radiance_scale = gain /
        std::max(1e-9, kPi * projection.distance * projection.distance * pixel_solid);
    const int width = camera.width;
    const int height = camera.height;
    for (int oy = -reach; oy <= reach; ++oy) {
        const int py = cy + oy;
        if (py < 0 || py >= height) {
            continue;
        }
        for (int ox = -reach; ox <= reach; ++ox) {
            const int px = cx + ox;
            if (px < 0 || px >= width) {
                continue;
            }
            const std::size_t index = static_cast<std::size_t>(py) * width + px;
            if (projection.distance > static_cast<double>(opaque_depth[index]) + 0.045) {
                continue;
            }
            const double dx = (projection.x - static_cast<double>(px)) / sigma;
            const double dy = (projection.y - static_cast<double>(py)) / sigma;
            const double weight = std::exp(-0.5 * (dx * dx + dy * dy)) * norm;
            target[index] += power * weight * radiance_scale;
        }
    }
}

void account_receiver(LightChannelResult& result, const Hit& hit,
                      double power, const Vec3& camera_point) {
    BandLightStats& stats = result.stats;
    stats.receiver_power += power;
    stats.received_photons += 1;
    stats.centroid_x += power * hit.point.x;
    stats.centroid_y += power * hit.point.y;
    stats.centroid_z += power * hit.point.z;
    stats.centroid_weight += power;
    (void)camera_point;
    if (hit.material == Material::Brass) {
        stats.brass_power += power;
    } else if (hit.material == Material::WhiteWall) {
        stats.wall_power += power;
    } else {
        stats.floor_power += power;
    }
}

void trace_photon(const Scene& scene, LightChannelResult& result,
                  const std::vector<float>& opaque_depth,
                  const Vec3& origin, const Vec3& direction,
                  double lambda_nm, double start_power,
                  int max_depth, Rng rng,
                  const Camera& camera, double pixel_solid,
                  double focal_px) {
    Vec3 ray_origin = origin;
    Vec3 ray_direction = direction;
    double power = start_power;
    Medium medium = Medium::Air;
    BandLightStats& stats = result.stats;

    for (int depth = 0; depth < max_depth; ++depth) {
        Hit hit;
        if (!scene.intersect(ray_origin, ray_direction, 1e-5, kInf, hit, true)) {
            stats.escaped_power += power;
            return;
        }

        if (hit.material == Material::BeamEmitter ||
            hit.material == Material::FillEmitter) {
            stats.escaped_power += power;
            return;
        }

        if (material_is_dielectric(hit.material)) {
            const double sigma = medium_absorption_scalar(medium, lambda_nm);
            if (sigma > 0.0) {
                const double transmittance = std::exp(-sigma * hit.t);
                stats.absorbed_power += power * (1.0 - transmittance);
                power *= transmittance;
            }
            const double cos_i = clamp(-dot(ray_direction, hit.normal), 0.0, 1.0);
            const double n_i = medium_ior(medium, lambda_nm);
            const double n_t = hit.front_face
                ? material_ior(hit.material, lambda_nm) : air_ior();
            const double eta = n_i / n_t;
            const double fresnel = dielectric_fresnel(cos_i, n_i, n_t);
            Vec3 refracted;
            const bool can_refract = refract_direction(
                ray_direction, hit.normal, eta, refracted);
            if (!can_refract) {
                ray_direction = normalize(reflect_dir(ray_direction, hit.normal));
                ray_origin = hit.point + ray_direction * 2e-5;
                continue;
            }
            const double p_reflect = clamp(fresnel, 2e-4, 0.9998);
            if (rng.next() < p_reflect) {
                power *= fresnel / p_reflect;
                ray_direction = normalize(reflect_dir(ray_direction, hit.normal));
                ray_origin = hit.point + ray_direction * 2e-5;
            } else {
                power *= (1.0 - fresnel) / (1.0 - p_reflect);
                ray_direction = refracted;
                ray_origin = hit.point + ray_direction * 2e-5;
                medium = hit.front_face ? material_medium(hit.material) : Medium::Air;
            }
            continue;
        }

        if (hit.material == Material::Brass) {
            account_receiver(result, hit, power, camera.origin);
            splat_receiver(result.metal, opaque_depth, camera, hit.point,
                           power, pixel_solid, focal_px, 1.90);
            return;
        }

        account_receiver(result, hit, power, camera.origin);
        splat_receiver(result.diffuse, opaque_depth, camera, hit.point,
                       power, pixel_solid, focal_px, 2.20);
        return;
    }
    stats.lost_power += power;
}

LightChannelResult render_light_channel(const Scene& scene,
                                        const std::vector<float>& opaque_depth,
                                        double lambda_lo, double lambda_hi,
                                        int photon_count,
                                        double channel_source_power,
                                        int max_depth,
                                        std::uint64_t salt,
                                        double pixel_solid,
                                        double focal_px) {
    LightChannelResult result;
    const std::size_t pixels = static_cast<std::size_t>(scene.camera.width) *
                               static_cast<std::size_t>(scene.camera.height);
    result.diffuse.assign(pixels, 0.0);
    result.metal.assign(pixels, 0.0);
    result.stats.wavelength_nm = 0.5 * (lambda_lo + lambda_hi);
    result.stats.source_power = channel_source_power;
    result.stats.traced_photons = static_cast<std::uint64_t>(photon_count);
    if (photon_count <= 0) {
        return result;
    }
    const double photon_power = channel_source_power /
                                static_cast<double>(photon_count);
    for (int s = 0; s < photon_count; ++s) {
        const SourceSample sample = make_source_sample(scene, s, salt);
        Rng rng(sample.rng_seed);
        const double lambda_nm = lambda_lo +
            (lambda_hi - lambda_lo) * sample.wavelength_u;
        trace_photon(scene, result, opaque_depth, sample.origin,
                     sample.direction, lambda_nm, photon_power,
                     max_depth, rng, scene.camera, pixel_solid, focal_px);
    }
    if (result.stats.centroid_weight > 0.0) {
        const double inv = 1.0 / result.stats.centroid_weight;
        result.stats.centroid_x *= inv;
        result.stats.centroid_y *= inv;
        result.stats.centroid_z *= inv;
    }
    return result;
}

}  // namespace
}  // namespace st
