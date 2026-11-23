#pragma once

#include "math.hpp"

#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

namespace ds {

struct Image {
    int width = 0;
    int height = 0;
    std::vector<Vec3> pixels;

    Image() = default;
    Image(int w, int h) : width(w), height(h),
                          pixels(static_cast<std::size_t>(w) * h) {}

    Vec3& at(int x, int y) {
        return pixels[static_cast<std::size_t>(y) * width + x];
    }
    const Vec3& at(int x, int y) const {
        return pixels[static_cast<std::size_t>(y) * width + x];
    }

    void add(int x, int y, const Vec3& color) { at(x, y) += color; }
};

inline Vec3 toneMap(const Vec3& color, float exposure) {
    Vec3 c = color * exposure;
    c = Vec3{c.x / (1.0f + c.x), c.y / (1.0f + c.y), c.z / (1.0f + c.z)};
    return {
        std::pow(saturate(c.x), 1.0f / 2.2f),
        std::pow(saturate(c.y), 1.0f / 2.2f),
        std::pow(saturate(c.z), 1.0f / 2.2f),
    };
}

inline bool savePPM(const Image& image, const std::string& path,
                    float exposure = 1.0f) {
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << "P6\n" << image.width << " " << image.height << "\n255\n";
    for (const Vec3& color : image.pixels) {
        const Vec3 mapped = toneMap(color, exposure);
        const unsigned char rgb[3] = {
            static_cast<unsigned char>(std::lround(saturate(mapped.x) * 255.0f)),
            static_cast<unsigned char>(std::lround(saturate(mapped.y) * 255.0f)),
            static_cast<unsigned char>(std::lround(saturate(mapped.z) * 255.0f)),
        };
        out.write(reinterpret_cast<const char*>(rgb), 3);
    }
    return static_cast<bool>(out);
}

inline Image makeContactSheet(const std::vector<Image>& images, int columns,
                              int gap = 4) {
    if (images.empty()) {
        return {};
    }
    const int cellW = images.front().width;
    const int cellH = images.front().height;
    const int rows =
        (static_cast<int>(images.size()) + columns - 1) / columns;
    Image sheet(columns * cellW + (columns - 1) * gap,
                rows * cellH + (rows - 1) * gap);
    for (Vec3& pixel : sheet.pixels) {
        pixel = {0.015f, 0.020f, 0.028f};
    }
    for (std::size_t i = 0; i < images.size(); ++i) {
        const int cellX = static_cast<int>(i) % columns;
        const int cellY = static_cast<int>(i) / columns;
        const int ox = cellX * (cellW + gap);
        const int oy = cellY * (cellH + gap);
        const Image& image = images[i];
        for (int y = 0; y < std::min(cellH, image.height); ++y) {
            for (int x = 0; x < std::min(cellW, image.width); ++x) {
                sheet.at(ox + x, oy + y) = image.at(x, y);
            }
        }
    }
    return sheet;
}

}  // namespace ds
