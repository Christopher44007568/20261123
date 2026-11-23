#pragma once

#include "scene.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace ds {

enum class ShadowMode : uint8_t {
    SingleLayer,
    FixedLayers,
    Adaptive,
};

std::string shadowModeName(ShadowMode mode);

struct DeepLayer {
    float depth = 0.0f;
    float transmittance = 1.0f;
};

struct PixelRecord {
    uint32_t offset = 0;
    uint16_t count = 0;
    uint16_t occupied = 0;
};

struct BuildOptions {
    int subrays = 2;
    int smokeSamples = 8;
    int fixedLayers = 8;
    int adaptiveMaxLayers = 18;
    double adaptiveTolerance = 0.0025;
    int depthBins = 4096;
    float nearDepth = -1.0f;
    float farDepth = -1.0f;
};

struct MapStats {
    ShadowMode mode = ShadowMode::Adaptive;
    int width = 0;
    int height = 0;
    int fixedLayers = 0;
    std::size_t storageBytes = 0;
    double averageLayers = 0.0;
    double averageLayersNonEmpty = 0.0;
    double averageOccupiedLayers = 0.0;
    int maxLayers = 0;
    std::size_t emptyPixels = 0;
    float nearDepth = 0.0f;
    float farDepth = 0.0f;
    double buildMilliseconds = 0.0;
};

class DeepShadowMap {
public:
    ShadowMode mode = ShadowMode::Adaptive;
    int width = 0;
    int height = 0;
    int fixedLayers = 0;
    float nearDepth = 0.0f;
    float farDepth = 0.0f;
    std::vector<PixelRecord> pixels;
    std::vector<DeepLayer> layers;
    MapStats stats;

    void build(const Scene& scene, const LightCamera& light, int mapWidth,
               int mapHeight, ShadowMode shadowMode,
               const BuildOptions& options = {});

    float sample(const Vec2& uv, float receiverDepth) const;
    float sampleWorld(const Scene& scene, const Vec3& point) const;
    float evaluatePixel(int x, int y, float receiverDepth) const;
    std::size_t storageBytes() const;

private:
    const PixelRecord& pixel(int x, int y) const;
    static float evaluateRecord(const PixelRecord& record,
                                const std::vector<DeepLayer>& allLayers,
                                float receiverDepth);
};

}  // namespace ds
