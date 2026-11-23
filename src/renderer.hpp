#pragma once

#include "scene.hpp"

#include <array>
#include <cstdint>
#include <string>
#include <vector>

namespace st {

struct RenderConfig {
    int width = 720;
    int height = 405;
    int samples_per_band = 12;
    int photon_samples = 48000;
    int max_depth = 12;
    int threads = 0;
    double exposure = 1.50;
    std::string label = "high";
};

struct BandLightStats {
    double wavelength_nm = 0.0;
    double source_power = 0.0;
    double receiver_power = 0.0;
    double wall_power = 0.0;
    double brass_power = 0.0;
    double floor_power = 0.0;
    double absorbed_power = 0.0;
    double escaped_power = 0.0;
    double lost_power = 0.0;
    double centroid_x = 0.0;
    double centroid_y = 0.0;
    double centroid_z = 0.0;
    double centroid_weight = 0.0;
    double deposition_radius_sum = 0.0;
    std::uint64_t received_photons = 0;
    std::uint64_t traced_photons = 0;
};

struct ChannelStats {
    double wavelength_nm = 0.0;
    double centroid_x = 0.0;
    double centroid_y = 0.0;
    double centroid_z = 0.0;
    double centroid_weight = 0.0;
    double receiver_power = 0.0;
};

struct RenderResult {
    int width = 0;
    int height = 0;
    std::string label;
    double seconds = 0.0;
    double exposure = 1.0;
    std::array<BandLightStats, kBandCount> band_stats{};
    std::array<ChannelStats, 3> rgb_stats{};
    std::vector<double> spectral_bands;
    std::vector<double> caustic_bands;
    std::vector<double> rgb_approx;
    std::vector<double> caustic_energy;
    std::vector<float> opaque_depth;
    std::vector<std::uint8_t> primary_material;
    std::vector<std::uint32_t> primary_geometry;
    std::uint64_t geometry_edge_pixels = 0;
    std::uint64_t geometry_edge_hash = 0;
    std::array<double, kBandCount> spectral_image_energy{};
    std::array<double, 3> rgb_image_energy{};
};

RenderResult render_frame(const Scene& scene, const RenderConfig& config);

std::vector<double> integrate_spectral_image(const std::vector<double>& bands,
                                             int width, int height);
double image_luminance_energy(const std::vector<double>& rgb, int width, int height);
Vec3 image_region_mean_rgb(const std::vector<double>& rgb, int width, int height,
                           const std::vector<std::uint8_t>& mask,
                           Material material);
std::uint64_t image_region_pixel_count(const std::vector<std::uint8_t>& mask,
                                       Material material);

void write_band_pfm(const std::string& path, const std::vector<double>& image,
                    int width, int height);
void write_rgb_ppm(const std::string& path, const std::vector<double>& rgb,
                   int width, int height, double exposure);
void write_geometry_pgm(const std::string& path,
                        const std::vector<std::uint32_t>& geometry,
                        int width, int height);
void write_depth_pfm(const std::string& path, const std::vector<float>& depth,
                     int width, int height);

}  // namespace st
