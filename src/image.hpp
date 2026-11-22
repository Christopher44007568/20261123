#pragma once

#include "math.hpp"

#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <vector>

namespace ocr {

inline void ensureParentDirectory(const std::string& path) {
    const std::size_t slash = path.find_last_of("/\\");
    if (slash == std::string::npos) {
        return;
    }
    std::error_code ec;
    std::filesystem::create_directories(path.substr(0, slash), ec);
}

struct ImageRGB {
    int width = 0;
    int height = 0;
    std::vector<Vec3> pixels;

    ImageRGB() = default;
    ImageRGB(int w, int h) : width(w), height(h),
                             pixels(static_cast<std::size_t>(w) * h) {}

    Vec3& at(int x, int y) {
        return pixels[static_cast<std::size_t>(y) * width + x];
    }
    const Vec3& at(int x, int y) const {
        return pixels[static_cast<std::size_t>(y) * width + x];
    }
};

struct ImageFloat {
    int width = 0;
    int height = 0;
    std::vector<float> values;

    ImageFloat() = default;
    ImageFloat(int w, int h, float initial = 0.0f)
        : width(w), height(h),
          values(static_cast<std::size_t>(w) * h, initial) {}

    float& at(int x, int y) {
        return values[static_cast<std::size_t>(y) * width + x];
    }
    float at(int x, int y) const {
        return values[static_cast<std::size_t>(y) * width + x];
    }
};

struct ImageID {
    int width = 0;
    int height = 0;
    std::vector<std::uint16_t> values;

    ImageID() = default;
    ImageID(int w, int h) : width(w), height(h),
                            values(static_cast<std::size_t>(w) * h, 0) {}

    std::uint16_t& at(int x, int y) {
        return values[static_cast<std::size_t>(y) * width + x];
    }
    std::uint16_t at(int x, int y) const {
        return values[static_cast<std::size_t>(y) * width + x];
    }
};

inline std::uint8_t encodeDisplay(float x) {
    const float v = clampf(x, 0.0f, 1.0f);
    const float srgb = v <= 0.0031308f
                           ? 12.92f * v
                           : 1.055f * std::pow(v, 1.0f / 2.4f) - 0.055f;
    return static_cast<std::uint8_t>(std::lround(srgb * 255.0f));
}

inline bool writePPM(const std::string& path, const ImageRGB& image) {
    ensureParentDirectory(path);
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << "P6\n" << image.width << " " << image.height << "\n255\n";
    for (const Vec3& c : image.pixels) {
        const char rgb[3] = {
            static_cast<char>(encodeDisplay(c.x)),
            static_cast<char>(encodeDisplay(c.y)),
            static_cast<char>(encodeDisplay(c.z))};
        out.write(rgb, 3);
    }
    return static_cast<bool>(out);
}

inline bool writePGM16(const std::string& path, const ImageID& image) {
    ensureParentDirectory(path);
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << "P5\n" << image.width << " " << image.height << "\n65535\n";
    for (std::uint16_t value : image.values) {
        const unsigned char bytes[2] = {
            static_cast<unsigned char>((value >> 8) & 0xffu),
            static_cast<unsigned char>(value & 0xffu)};
        out.write(reinterpret_cast<const char*>(bytes), 2);
    }
    return static_cast<bool>(out);
}

inline bool writeDepthPGM16(const std::string& path, const ImageFloat& depth,
                            float nearDepth, float farDepth) {
    ImageID encoded(depth.width, depth.height);
    for (std::size_t i = 0; i < depth.values.size(); ++i) {
        const float d = depth.values[i];
        if (!(d > 0.0f) || !std::isfinite(d)) {
            encoded.values[i] = 0;
            continue;
        }
        const float normalized =
            1.0f - clampf((d - nearDepth) / (farDepth - nearDepth), 0.0f, 1.0f);
        encoded.values[i] =
            static_cast<std::uint16_t>(std::lround(normalized * 65535.0f));
    }
    return writePGM16(path, encoded);
}

inline bool writePFM(const std::string& path, const ImageFloat& image) {
    ensureParentDirectory(path);
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << "PF\n" << image.width << " " << image.height << "\n-1.0\n";
    for (float v : image.values) {
        out.write(reinterpret_cast<const char*>(&v), sizeof(float));
    }
    return static_cast<bool>(out);
}

}  // namespace ocr
