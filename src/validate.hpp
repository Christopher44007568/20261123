#pragma once

#include "image.hpp"
#include "renderer.hpp"
#include "scene.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace ocr {

struct MaterialProbe {
    std::string label;
    int x = -1;
    int y = -1;
    int material = 0;
    int objectId = -1;
    int primitiveId = -1;
    bool isSdf = false;
    float depth = 0.0f;
    Vec3 color;
    Vec3 normal;
};

struct ChannelValidation {
    std::int64_t pixels = 0;
    std::int64_t materialIdsMatched = 0;
    std::int64_t materialsMatched = 0;
    std::int64_t depthsMatched = 0;
    std::int64_t normalsMatched = 0;
    std::int64_t colorsMatched = 0;
    std::int64_t hitPixels = 0;
    std::int64_t skyPixels = 0;
    std::vector<MaterialProbe> probes;
};

struct ReferenceComparison {
    int width = 0;
    int height = 0;
    std::int64_t exactPixels = 0;
    std::int64_t bothMissPixels = 0;
    std::int64_t hitPresenceMismatches = 0;
    std::int64_t materialMismatches = 0;
    std::int64_t firstHitMismatches = 0;
    std::int64_t depthMismatches = 0;
    double maxDepthError = 0.0;
    std::vector<MaterialProbe> mismatchExamples;

    bool pass() const {
        return hitPresenceMismatches == 0 && materialMismatches == 0 &&
               firstHitMismatches == 0 && depthMismatches == 0;
    }
};

ChannelValidation validateChannels(const RenderResult& render);

bool writeChannels(const std::string& outputDirectory,
                   const RenderResult& render,
                   const ImageRGB& cutPreview, const Scene& scene,
                   const CutPreviewStats& previewStats,
                   ChannelValidation* validation = nullptr);

ReferenceComparison compareRenders(const RenderResult& bvh,
                                   const RenderResult& brute);

bool writeReferenceOutputs(const std::string& outputDirectory,
                           const RenderResult& bvh,
                           const RenderResult& brute,
                           const ImageRGB& brutePreview,
                           const Scene& scene,
                           const CutPreviewStats& previewStats,
                           const ReferenceComparison& comparison);

std::string escapeJson(const std::string& value);

}  // namespace ocr
