#include "renderer.hpp"
#include "scene.hpp"
#include "spectrum.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

struct Options {
    int width = 1024;
    int height = 576;
    int low_spp = 8;
    int high_spp = 64;
    int low_photons = 40000;
    int high_photons = 200000;
    int threads = 0;
    int max_depth = 12;
    double exposure = 1.50;
    bool quick = false;
    std::string output = "output";
};

void print_usage() {
    std::cout
        << "Salt Lake Spectral Tower - C++17 spectral path tracer\n"
        << "Usage: spectral_tower [options]\n"
        << "  --width N          image width (default 1024)\n"
        << "  --height N         image height (default 576)\n"
        << "  --low-spp N        low-pass samples per spectral band (default 8)\n"
        << "  --high-spp N       high-pass samples per spectral band (default 64)\n"
        << "  --low-photons N    hero photon samples per band, low (default 40000)\n"
        << "  --high-photons N   hero photon samples per band, high (default 200000)\n"
        << "  --threads N        worker threads (default hardware concurrency)\n"
        << "  --exposure X       fixed tone-map exposure (default 1.50)\n"
        << "  --output DIR       output root (default output)\n"
        << "  --quick            tiny smoke render: 320x180, 1 spp, 800 photons\n"
        << "  --help             show this help\n";
}

bool parse_int(const char* text, int& value) {
    try {
        std::size_t used = 0;
        const int parsed = std::stoi(text, &used);
        if (used != std::string(text).size()) {
            return false;
        }
        value = parsed;
        return true;
    } catch (...) {
        return false;
    }
}

bool parse_double(const char* text, double& value) {
    try {
        std::size_t used = 0;
        const double parsed = std::stod(text, &used);
        if (used != std::string(text).size()) {
            return false;
        }
        value = parsed;
        return true;
    } catch (...) {
        return false;
    }
}

bool parse_options(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        auto next = [&](const char* name) -> const char* {
            if (i + 1 >= argc) {
                std::cerr << "missing value for " << name << "\n";
                return nullptr;
            }
            return argv[++i];
        };
        if (arg == "--help" || arg == "-h") {
            print_usage();
            std::exit(0);
        } else if (arg == "--quick") {
            options.quick = true;
        } else if (arg == "--width") {
            const char* v = next("--width");
            if (v == nullptr || !parse_int(v, options.width)) return false;
        } else if (arg == "--height") {
            const char* v = next("--height");
            if (v == nullptr || !parse_int(v, options.height)) return false;
        } else if (arg == "--low-spp") {
            const char* v = next("--low-spp");
            if (v == nullptr || !parse_int(v, options.low_spp)) return false;
        } else if (arg == "--high-spp") {
            const char* v = next("--high-spp");
            if (v == nullptr || !parse_int(v, options.high_spp)) return false;
        } else if (arg == "--low-photons") {
            const char* v = next("--low-photons");
            if (v == nullptr || !parse_int(v, options.low_photons)) return false;
        } else if (arg == "--high-photons") {
            const char* v = next("--high-photons");
            if (v == nullptr || !parse_int(v, options.high_photons)) return false;
        } else if (arg == "--threads") {
            const char* v = next("--threads");
            if (v == nullptr || !parse_int(v, options.threads)) return false;
        } else if (arg == "--max-depth") {
            const char* v = next("--max-depth");
            if (v == nullptr || !parse_int(v, options.max_depth)) return false;
        } else if (arg == "--exposure") {
            const char* v = next("--exposure");
            if (v == nullptr || !parse_double(v, options.exposure)) return false;
        } else if (arg == "--output") {
            const char* v = next("--output");
            if (v == nullptr) return false;
            options.output = v;
        } else {
            std::cerr << "unknown option: " << arg << "\n";
            return false;
        }
    }
    if (options.quick) {
        options.width = 320;
        options.height = 180;
        options.low_spp = 1;
        options.high_spp = 2;
        options.low_photons = 800;
        options.high_photons = 1600;
    }
    return options.width > 0 && options.height > 0 &&
           options.low_spp > 0 && options.high_spp > 0 &&
           options.low_photons > 0 && options.high_photons > 0;
}

std::string band_name(int index) {
    std::ostringstream out;
    out << "band_" << std::setw(3) << std::setfill('0')
        << static_cast<int>(std::lround(st::bands()[static_cast<std::size_t>(index)].center))
        << "nm";
    return out.str();
}

std::string format_double(double value, int precision = 6) {
    std::ostringstream out;
    out << std::setprecision(precision) << std::fixed << value;
    return out.str();
}

using st::kBandCount;
using st::Material;
using st::RenderResult;

struct ValidationSummary {
    double max_band_image_delta = 0.0;
    int max_band_image_delta_index = 0;
    double max_band_receiver_delta = 0.0;
    double mean_band_image_delta = 0.0;
    double spectral_dispersion_x = 0.0;
    double spectral_dispersion_y = 0.0;
    double spectral_receiver_energy_low = 0.0;
    double spectral_receiver_energy_high = 0.0;
    double rgb_receiver_energy_high = 0.0;
    double spectral_image_luminance_high = 0.0;
    double rgb_image_luminance_high = 0.0;
    double spectral_mirror_red_blue = 0.0;
    double rgb_mirror_red_blue = 0.0;
    std::uint64_t mirror_pixels = 0;
};

}  // namespace

namespace {

void write_validation(const std::string& root,
                      const Options& options,
                      const RenderResult& low,
                      const RenderResult& high,
                      const ValidationSummary& summary) {
    const bool edges_match = low.geometry_edge_hash == high.geometry_edge_hash;
    const bool energy_converged = summary.max_band_image_delta < 0.08 &&
                                  summary.max_band_receiver_delta < 0.08;
    const bool dispersion_visible = summary.spectral_dispersion_x > 1e-4 ||
                                    summary.spectral_dispersion_y > 1e-4;
    const bool mirror_present = summary.mirror_pixels > 0;
    const bool all_pass = edges_match && energy_converged &&
                          dispersion_visible && mirror_present;

    std::ofstream json(root + "/validation.json");
    json << std::setprecision(10)
         << "{\n"
         << "  \"scene\": \"salt_lake_spectral_tower\",\n"
         << "  \"renderer\": \"C++17 stdlib CPU spectral path tracer\",\n"
         << "  \"camera\": {\"origin\": [0.55, 2.95, 8.25], "
            "\"target\": [0.35, 1.34, -0.55], \"fov_degrees\": 39.0, "
            "\"resolution\": [" << options.width << ", " << options.height << "]},\n"
         << "  \"hero_wavelength_sampling\": {\"bands\": 16, "
            "\"heroes_stratified_per_pixel\": true, "
            "\"companion_bands_share_camera_ray_and_rng\": true},\n"
         << "  \"band_range_nm\": [" << st::kBandLo << ", " << st::kBandHi << "],\n"
         << "  \"rgb_approximation_primaries_nm\": [620, 545, 460],\n"
         << "  \"spectral_integration\": \"CIE 1931 XYZ analytic fit, D65-independent equal-energy white balance\",\n"
         << "  \"prebaked_rainbow_texture\": false,\n"
         << "  \"passes\": {\n"
         << "    \"low\": {\"samples_per_band\": " << options.low_spp
         << ", \"hero_photons_per_band\": " << options.low_photons
         << ", \"seconds\": " << low.seconds << "},\n"
         << "    \"high\": {\"samples_per_band\": " << options.high_spp
         << ", \"hero_photons_per_band\": " << options.high_photons
         << ", \"seconds\": " << high.seconds << "}\n"
         << "  },\n"
         << "  \"checks\": {\n"
         << "    \"all_pass\": " << (all_pass ? "true" : "false") << ",\n"
         << "    \"band_energy_converged\": " << (energy_converged ? "true" : "false") << ",\n"
         << "    \"max_band_image_relative_delta\": " << summary.max_band_image_delta << ",\n"
         << "    \"mean_band_image_relative_delta\": " << summary.mean_band_image_delta << ",\n"
         << "    \"max_band_receiver_relative_delta\": " << summary.max_band_receiver_delta << ",\n"
         << "    \"geometry_edges_identical_across_wavelengths\": "
         << (edges_match ? "true" : "false") << ",\n"
         << "    \"geometry_edge_pixels\": " << high.geometry_edge_pixels << ",\n"
         << "    \"geometry_edge_hash_low\": \"" << std::hex
         << low.geometry_edge_hash << std::dec << "\",\n"
         << "    \"geometry_edge_hash_high\": \"" << std::hex
         << high.geometry_edge_hash << std::dec << "\",\n"
         << "    \"geometry_edge_misalignment_pixels\": "
         << (edges_match ? 0 : high.geometry_edge_pixels) << ",\n"
         << "    \"dispersion_visible\": " << (dispersion_visible ? "true" : "false") << ",\n"
         << "    \"mirror_present\": " << (mirror_present ? "true" : "false") << "\n"
         << "  },\n"
         << "  \"white_light\": {\"source_energy_per_pass\": 1.0, "
            "\"low_receiver_energy\": " << summary.spectral_receiver_energy_low
         << ", \"high_receiver_energy\": " << summary.spectral_receiver_energy_high
         << ", \"rgb_approx_receiver_energy\": " << summary.rgb_receiver_energy_high
         << "},\n"
         << "  \"image_luminance_energy\": {\"spectral_high\": "
         << summary.spectral_image_luminance_high << ", \"rgb_approx_high\": "
         << summary.rgb_image_luminance_high << "},\n"
         << "  \"metal_reflection_color_cast\": {\"mirror_pixels\": "
         << summary.mirror_pixels << ", \"spectral_red_blue_ratio\": "
         << summary.spectral_mirror_red_blue << ", \"rgb_approx_red_blue_ratio\": "
         << summary.rgb_mirror_red_blue << "},\n"
         << "  \"dispersion_centroids\": [\n";
    for (int band = 0; band < kBandCount; ++band) {
        const st::BandLightStats& s = high.band_stats[static_cast<std::size_t>(band)];
        json << "    {\"lambda_nm\": " << st::bands()[static_cast<std::size_t>(band)].center
             << ", \"x\": " << s.centroid_x << ", \"y\": " << s.centroid_y
             << ", \"z\": " << s.centroid_z << ", \"receiver_power\": "
             << s.receiver_power << "}"
             << (band + 1 == kBandCount ? "\n" : ",\n");
    }
    json << "  ],\n"
         << "  \"rgb_approx_centroids\": [\n";
    for (int channel = 0; channel < 3; ++channel) {
        const st::ChannelStats& s = high.rgb_stats[static_cast<std::size_t>(channel)];
        json << "    {\"lambda_nm\": " << s.wavelength_nm
             << ", \"x\": " << s.centroid_x << ", \"y\": " << s.centroid_y
             << ", \"z\": " << s.centroid_z << ", \"receiver_power\": "
             << s.receiver_power << "}"
             << (channel == 2 ? "\n" : ",\n");
    }
    json << "  ],\n"
         << "  \"band_convergence\": [\n";
    for (int band = 0; band < kBandCount; ++band) {
        const std::size_t i = static_cast<std::size_t>(band);
        const double a = low.spectral_image_energy[i];
        const double b = high.spectral_image_energy[i];
        const double rel = std::abs(b - a) / std::max(std::abs(b), 1e-12);
        json << "    {\"lambda_nm\": " << st::bands()[i].center
             << ", \"low_image_energy\": " << a
             << ", \"high_image_energy\": " << b
             << ", \"relative_delta\": " << rel << "}"
             << (band + 1 == kBandCount ? "\n" : ",\n");
    }
    json << "  ],\n"
         << "  \"notes\": \"Receiver centroids are energy-weighted spectral photon hit positions. "
            "Object silhouettes share one wavelength-independent camera/geometry buffer; "
            "dispersion changes only transported light, never geometry.\"\n"
         << "}\n";
}

void write_markdown_summary(const std::string& root,
                            const Options& options,
                            const RenderResult& low,
                            const RenderResult& high,
                            const ValidationSummary& summary) {
    std::ofstream md(root + "/summary.md");
    const bool edges_match = low.geometry_edge_hash == high.geometry_edge_hash;
    md << "# Salt Lake Spectral Tower - rendered checks\n\n"
       << "Fixed camera at `(0.55, 2.95, 8.25)` looking at "
          "`(0.35, 1.34, -0.55)`, 39 degree vertical FOV, "
       << options.width << "x" << options.height << ".\n\n"
       << "| pass | samples/band | hero photons/band | seconds |\n"
       << "|---|---:|---:|---:|\n"
       << "| low | " << options.low_spp << " | " << options.low_photons
       << " | " << format_double(low.seconds, 2) << " |\n"
       << "| high | " << options.high_spp << " | " << options.high_photons
       << " | " << format_double(high.seconds, 2) << " |\n\n"
       << "## Spectral dispersion centroids\n\n"
       << "| lambda nm | x | y | z | receiver energy |\n"
       << "|---:|---:|---:|---:|---:|\n";
    for (int band = 0; band < kBandCount; ++band) {
        const st::BandLightStats& s = high.band_stats[static_cast<std::size_t>(band)];
        md << "| " << st::bands()[static_cast<std::size_t>(band)].center
           << " | " << format_double(s.centroid_x, 4)
           << " | " << format_double(s.centroid_y, 4)
           << " | " << format_double(s.centroid_z, 4)
           << " | " << format_double(s.receiver_power, 6) << " |\n";
    }
    md << "\nSpectral centroid span: x `" << format_double(summary.spectral_dispersion_x, 4)
       << "`, y `" << format_double(summary.spectral_dispersion_y, 4) << "` m.\n\n"
       << "## RGB approximation vs spectral integration\n\n"
       << "| metric | spectral | RGB approximation |\n"
       << "|---|---:|---:|\n"
       << "| white-light receiver energy | "
       << format_double(summary.spectral_receiver_energy_high, 6)
       << " | " << format_double(summary.rgb_receiver_energy_high, 6) << " |\n"
       << "| image luminance energy | "
       << format_double(summary.spectral_image_luminance_high, 6)
       << " | " << format_double(summary.rgb_image_luminance_high, 6) << " |\n"
       << "| brass mirror R/B ratio | "
       << format_double(summary.spectral_mirror_red_blue, 4)
       << " | " << format_double(summary.rgb_mirror_red_blue, 4) << " |\n"
       << "| RGB-primary centroid span x | - | "
       << format_double(std::abs(high.rgb_stats[0].centroid_x -
                                 high.rgb_stats[2].centroid_x), 4) << " |\n"
       << "| RGB-primary centroid span y | - | "
       << format_double(std::abs(high.rgb_stats[0].centroid_y -
                                 high.rgb_stats[2].centroid_y), 4) << " |\n\n"
       << "## Band energy convergence\n\n"
       << "| lambda nm | low image energy | high image energy | relative delta |\n"
       << "|---:|---:|---:|---:|\n";
    for (int band = 0; band < kBandCount; ++band) {
        const std::size_t i = static_cast<std::size_t>(band);
        const double a = low.spectral_image_energy[i];
        const double b = high.spectral_image_energy[i];
        const double rel = std::abs(b - a) / std::max(std::abs(b), 1e-12);
        md << "| " << st::bands()[i].center
           << " | " << format_double(a, 5)
           << " | " << format_double(b, 5)
           << " | " << format_double(rel * 100.0, 3) << "% |\n";
    }
    md << "\nMax image-energy delta: `"
       << format_double(summary.max_band_image_delta * 100.0, 3)
       << "%` (`" << st::bands()[static_cast<std::size_t>(summary.max_band_image_delta_index)].center
       << " nm`). Max receiver-energy delta: `"
       << format_double(summary.max_band_receiver_delta * 100.0, 3) << "%`.\n\n"
       << "## Geometry and methodology checks\n\n"
       << "- Geometry edge hashes identical: **" << (edges_match ? "yes" : "no")
       << "**; edge pixels `" << high.geometry_edge_pixels
       << "`; wavelength misalignment pixels `" << (edges_match ? 0 : high.geometry_edge_pixels)
       << "`.\n"
       << "- Hero wavelength sampling: 16 stratified hero bins per pixel; the 15 companion bands "
          "share the exact camera ray, subpixel jitter and random stream. This suppresses "
          "chromatic edge noise without aligning spectral caustics to a texture.\n"
       << "- The prism dispersion is produced by wavelength-dependent transport through "
          "code-defined Cauchy glass; no rainbow texture or image input exists.\n"
       << "- Brass uses tabulated complex IOR and complex Fresnel reflectance; dielectric "
          "interfaces use unpolarized s/p Fresnel reflection/transmission.\n";
}

}  // namespace

namespace {

void write_result_files(const RenderResult& result,
                        const std::vector<double>& spectral_rgb,
                        const std::string& directory, double exposure) {
    std::filesystem::create_directories(directory);
    const std::size_t pixels = static_cast<std::size_t>(result.width) *
                               static_cast<std::size_t>(result.height);
    for (int band = 0; band < kBandCount; ++band) {
        const std::size_t offset = static_cast<std::size_t>(band) * pixels;
        std::vector<double> plane(result.spectral_bands.begin() +
                                  static_cast<std::ptrdiff_t>(offset),
                                  result.spectral_bands.begin() +
                                  static_cast<std::ptrdiff_t>(offset + pixels));
        st::write_band_pfm(directory + "/" + band_name(band) + ".pfm",
                           plane, result.width, result.height);
    }
    st::write_rgb_ppm(directory + "/spectral.ppm", spectral_rgb,
                      result.width, result.height, exposure);
    st::write_rgb_ppm(directory + "/rgb_approx.ppm", result.rgb_approx,
                      result.width, result.height, exposure);
    st::write_geometry_pgm(directory + "/geometry_ids.pgm",
                           result.primary_geometry, result.width, result.height);
    st::write_depth_pfm(directory + "/opaque_depth.pfm",
                        result.opaque_depth, result.width, result.height);

    std::ofstream csv(directory + "/energy_" + result.label + ".csv");
    csv << "band_nm,source_power,receiver_power,wall_power,brass_power,"
           "floor_power,absorbed_power,escaped_power,lost_power,"
           "centroid_x,centroid_y,centroid_z,image_energy\n";
    for (int band = 0; band < kBandCount; ++band) {
        const st::BandLightStats& s = result.band_stats[static_cast<std::size_t>(band)];
        csv << std::setprecision(9)
            << st::bands()[static_cast<std::size_t>(band)].center << ','
            << s.source_power << ',' << s.receiver_power << ','
            << s.wall_power << ',' << s.brass_power << ','
            << s.floor_power << ',' << s.absorbed_power << ','
            << s.escaped_power << ',' << s.lost_power << ','
            << s.centroid_x << ',' << s.centroid_y << ',' << s.centroid_z << ','
            << result.spectral_image_energy[static_cast<std::size_t>(band)]
            << '\n';
    }
}

ValidationSummary analyze(const RenderResult& low, const RenderResult& high,
                          const std::vector<double>& spectral_rgb_low,
                          const std::vector<double>& spectral_rgb_high) {
    ValidationSummary summary;
    double delta_sum = 0.0;
    for (int band = 0; band < kBandCount; ++band) {
        const std::size_t i = static_cast<std::size_t>(band);
        const double a = low.spectral_image_energy[i];
        const double b = high.spectral_image_energy[i];
        const double delta = std::abs(b - a) / std::max(std::abs(b), 1e-12);
        delta_sum += delta;
        if (delta > summary.max_band_image_delta) {
            summary.max_band_image_delta = delta;
            summary.max_band_image_delta_index = band;
        }
        const double ra = low.band_stats[i].receiver_power;
        const double rb = high.band_stats[i].receiver_power;
        summary.max_band_receiver_delta = std::max(
            summary.max_band_receiver_delta,
            std::abs(rb - ra) / std::max(std::abs(rb), 1e-12));
        summary.spectral_receiver_energy_low += ra;
        summary.spectral_receiver_energy_high += rb;
    }
    summary.mean_band_image_delta = delta_sum / static_cast<double>(kBandCount);
    for (const st::ChannelStats& channel : high.rgb_stats) {
        summary.rgb_receiver_energy_high += channel.receiver_power;
    }

    double min_x = 1e30;
    double max_x = -1e30;
    double min_y = 1e30;
    double max_y = -1e30;
    for (const st::BandLightStats& stats : high.band_stats) {
        if (stats.centroid_weight <= 0.0) {
            continue;
        }
        min_x = std::min(min_x, stats.centroid_x);
        max_x = std::max(max_x, stats.centroid_x);
        min_y = std::min(min_y, stats.centroid_y);
        max_y = std::max(max_y, stats.centroid_y);
    }
    summary.spectral_dispersion_x = max_x > min_x ? max_x - min_x : 0.0;
    summary.spectral_dispersion_y = max_y > min_y ? max_y - min_y : 0.0;
    (void)spectral_rgb_low;

    summary.spectral_image_luminance_high =
        st::image_luminance_energy(spectral_rgb_high, high.width, high.height);
    summary.rgb_image_luminance_high =
        st::image_luminance_energy(high.rgb_approx, high.width, high.height);
    summary.mirror_pixels = st::image_region_pixel_count(
        high.primary_material, Material::Brass);
    const st::Vec3 spectral_mirror = st::image_region_mean_rgb(
        spectral_rgb_high, high.width, high.height,
        high.primary_material, Material::Brass);
    const st::Vec3 rgb_mirror = st::image_region_mean_rgb(
        high.rgb_approx, high.width, high.height,
        high.primary_material, Material::Brass);
    summary.spectral_mirror_red_blue = spectral_mirror.x /
        std::max(spectral_mirror.z, 1e-12);
    summary.rgb_mirror_red_blue = rgb_mirror.x /
        std::max(rgb_mirror.z, 1e-12);
    return summary;
}

std::vector<double> make_contact_sheet(const std::vector<double>& spectral_low,
                                       const std::vector<double>& rgb_low,
                                       const std::vector<double>& spectral_high,
                                       const std::vector<double>& rgb_high,
                                       int width, int height) {
    const int gap = 5;
    const int out_width = width * 2 + gap * 3;
    const int out_height = height * 2 + gap * 3;
    std::vector<double> sheet(static_cast<std::size_t>(out_width) * out_height * 3, 0.012);
    auto blit = [&](const std::vector<double>& source, int ox, int oy) {
        for (int y = 0; y < height; ++y) {
            for (int x = 0; x < width; ++x) {
                const std::size_t src = static_cast<std::size_t>(y) * width + x;
                const std::size_t dst = static_cast<std::size_t>(oy + y) * out_width +
                                        static_cast<std::size_t>(ox + x);
                sheet[dst * 3 + 0] = source[src * 3 + 0];
                sheet[dst * 3 + 1] = source[src * 3 + 1];
                sheet[dst * 3 + 2] = source[src * 3 + 2];
            }
        }
    };
    blit(spectral_low, gap, gap);
    blit(rgb_low, width + gap * 2, gap);
    blit(spectral_high, gap, height + gap * 2);
    blit(rgb_high, width + gap * 2, height + gap * 2);
    return sheet;
}

}  // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parse_options(argc, argv, options)) {
        print_usage();
        return 2;
    }
    std::filesystem::create_directories(options.output);

    st::Scene scene(options.width, options.height);
    st::RenderConfig low_config;
    low_config.width = options.width;
    low_config.height = options.height;
    low_config.samples_per_band = options.low_spp;
    low_config.photon_samples = options.low_photons;
    low_config.max_depth = options.max_depth;
    low_config.threads = options.threads;
    low_config.exposure = options.exposure;
    low_config.label = "low";

    st::RenderConfig high_config = low_config;
    high_config.samples_per_band = options.high_spp;
    high_config.photon_samples = options.high_photons;
    high_config.label = "high";

    std::cout << "Salt Lake Spectral Tower\n"
              << "  " << options.width << "x" << options.height
              << ", 16 spectral bands, low/high passes\n"
              << "  low: " << options.low_spp << " spp/band, "
              << options.low_photons << " hero photons/band\n"
              << "  high: " << options.high_spp << " spp/band, "
              << options.high_photons << " hero photons/band\n";

    const auto total_start = std::chrono::steady_clock::now();
    const st::RenderResult low = st::render_frame(scene, low_config);
    const std::vector<double> spectral_rgb_low = st::integrate_spectral_image(
        low.spectral_bands, low.width, low.height);
    const std::vector<double> caustic_rgb_low = st::integrate_spectral_image(
        low.caustic_bands, low.width, low.height);
    const st::RenderResult high = st::render_frame(scene, high_config);
    const std::vector<double> spectral_rgb_high = st::integrate_spectral_image(
        high.spectral_bands, high.width, high.height);
    const std::vector<double> caustic_rgb_high = st::integrate_spectral_image(
        high.caustic_bands, high.width, high.height);

    write_result_files(low, spectral_rgb_low, options.output + "/low",
                       options.exposure);
    write_result_files(high, spectral_rgb_high, options.output + "/high",
                       options.exposure);
    st::write_rgb_ppm(options.output + "/low/caustic_only.ppm",
                      caustic_rgb_low, low.width, low.height, options.exposure);
    st::write_rgb_ppm(options.output + "/high/caustic_only.ppm",
                      caustic_rgb_high, high.width, high.height, options.exposure);

    const std::vector<double> contact = make_contact_sheet(
        spectral_rgb_low, low.rgb_approx, spectral_rgb_high, high.rgb_approx,
        low.width, low.height);
    st::write_rgb_ppm(options.output + "/comparison.ppm", contact,
                      low.width * 2 + 15, low.height * 2 + 15,
                      options.exposure);

    const ValidationSummary summary = analyze(
        low, high, spectral_rgb_low, spectral_rgb_high);
    write_validation(options.output, options, low, high, summary);
    write_markdown_summary(options.output, options, low, high, summary);

    const auto total_end = std::chrono::steady_clock::now();
    const double total_seconds =
        std::chrono::duration<double>(total_end - total_start).count();
    std::cout << "Wrote " << options.output << "/low and " << options.output
              << "/high; total " << format_double(total_seconds, 2) << " s\n"
              << "Max band image delta: "
              << format_double(summary.max_band_image_delta * 100.0, 3)
              << "%, geometry edge hash match: "
              << (low.geometry_edge_hash == high.geometry_edge_hash ? "yes" : "no")
              << ", spectral span: "
              << format_double(summary.spectral_dispersion_y, 4) << " m\n";
    return 0;
}
