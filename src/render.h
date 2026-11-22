#pragma once

#include "solver.h"

#include <cstdint>
#include <string>
#include <vector>

namespace rad {

enum class ViewMode {
    FirstPass,
    Converged,
    IndirectOnly
};

struct Image {
    int width = 0;
    int height = 0;
    std::vector<std::uint8_t> rgb;
};

struct Camera {
    Vec3 position{0.75, 0.95, 1.55};
    Vec3 target{6.25, 2.65, 1.12};
    Vec3 up{0.0, 0.0, 1.0};
    double verticalFovDegrees = 66.0;
};

const char* viewName(ViewMode mode);
double recommendedExposure(const std::vector<Patch>& converged);
Image renderView(const Scene& scene, const std::vector<Patch>& firstPass,
                 const std::vector<Patch>& converged, ViewMode mode,
                 int width, int height, double exposure, const Camera& camera);

bool writeBmp(const std::string& path, const Image& image);
bool writePpm(const std::string& path, const Image& image);
std::string ansiPreview(const Image& image, int columns, int rows);

}  // namespace rad
