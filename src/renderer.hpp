#pragma once

#include "image.hpp"
#include "math.hpp"
#include "scene.hpp"

#include <cstdint>
#include <unordered_map>
#include <vector>

namespace ocr {

struct PixelRecord {
    bool hit = false;
    float depth = 0.0f;
    Vec3 color;
    Vec3 normal;
    int material = 0;
    int objectId = -1;
    int primitiveId = -1;
    bool isSdf = false;
    int clipRejections = 0;
    bool continuedAfterClip = false;
};

struct RenderStats {
    std::int64_t hitPixels = 0;
    std::int64_t skyPixels = 0;
    std::int64_t clipRejections = 0;
    std::int64_t continuationPixels = 0;
    int maxClipRejections = 0;
    std::unordered_map<int, std::int64_t> materialPixels;
};

struct RenderOptions {
    int width = 640;
    int height = 360;
    bool useBvh = true;
    bool ambientOcclusion = true;
    int aoSamples = 6;
    bool glossyReflection = true;
};

struct RenderResult {
    int width = 0;
    int height = 0;
    Camera camera;
    std::vector<PixelRecord> pixels;
    RenderStats stats;

    const PixelRecord& at(int x, int y) const {
        return pixels[static_cast<std::size_t>(y) * width + x];
    }
};

RenderResult renderScene(const Scene& scene, const Camera& camera,
                         const RenderOptions& options);

Vec3 toneMap(const Vec3& linearColor);
Vec3 encodeNormal(const Vec3& normal);

struct CutPreviewStats {
    int triangleSegments = 0;
    int sdfSegments = 0;
};

ImageRGB buildCutPreview(const Scene& scene, const Camera& camera,
                         const RenderResult& render,
                         CutPreviewStats* stats = nullptr);

}  // namespace ocr
