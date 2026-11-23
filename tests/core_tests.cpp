#include "deep_shadow.hpp"
#include "scene.hpp"
#include "validation.hpp"

#include <cmath>
#include <iostream>
#include <string>
#include <vector>

using namespace ds;

namespace {

int failures = 0;

void expect(bool condition, const std::string& message) {
    if (!condition) {
        std::cerr << "FAIL: " << message << "\n";
        ++failures;
    } else {
        std::cout << "ok: " << message << "\n";
    }
}

}  // namespace

int main() {
    const Scene scene = Scene::makeTheater(0.18f, 7u);
    const LightCamera light = scene.lightCamera();

    double minimumProjectionDot = 1.0;
    bool projectionsSucceed = true;
    double maximumDepthError = 0.0;
    for (int y = 1; y < 8; ++y) {
        for (int x = 1; x < 8; ++x) {
            const Vec3 point{-2.5f + 0.7f * x, 0.4f + 0.5f * y,
                             -3.8f + 0.55f * x};
            Vec2 uv;
            float depth = 0.0f;
            projectionsSucceed =
                projectionsSucceed && light.project(point, uv, depth);
            const Ray reconstructed =
                light.ray(uv.x * 2.0f - 1.0f, 1.0f - uv.y * 2.0f);
            const double alignment =
                dot(reconstructed.direction,
                    normalize(point - scene.lightPosition));
            minimumProjectionDot = std::min(minimumProjectionDot, alignment);
            maximumDepthError =
                std::max(maximumDepthError,
                         std::abs(static_cast<double>(depth) -
                                  length(point - scene.lightPosition)));
        }
    }
    expect(projectionsSucceed, "light projection succeeds for scene points");
    expect(maximumDepthError < 1.0e-4,
           "projected depth is euclidean ray distance");
    expect(minimumProjectionDot > 0.99999,
           "light projection and unprojection agree in both image axes");

    BuildOptions options;
    options.fixedLayers = 6;
    options.adaptiveMaxLayers = 12;
    options.depthBins = 2048;
    options.subrays = 2;
    options.smokeSamples = 6;
    constexpr int resolution = 192;

    DeepShadowMap single;
    DeepShadowMap fixed;
    DeepShadowMap adaptive;
    single.build(scene, light, resolution, resolution, ShadowMode::SingleLayer,
                 options);
    fixed.build(scene, light, resolution, resolution, ShadowMode::FixedLayers,
                options);
    adaptive.build(scene, light, resolution, resolution, ShadowMode::Adaptive,
                   options);

    expect(std::abs(single.stats.averageLayers - 1.0) < 1.0e-9,
           "single-layer mode stores one record per pixel");
    expect(std::abs(fixed.stats.averageLayers - 6.0) < 1.0e-9,
           "fixed mode stores the requested layer count");
    expect(adaptive.stats.averageLayers > 1.0 &&
               adaptive.stats.maxLayers <= options.adaptiveMaxLayers,
           "adaptive mode varies layer count within its cap");
    expect(adaptive.storageBytes() < fixed.storageBytes(),
           "adaptive storage is smaller than fixed storage");

    bool monotonicCurves = true;
    for (const PixelRecord& record : adaptive.pixels) {
        float previous = 1.0f;
        for (int i = 0; i < record.count; ++i) {
            const DeepLayer& layer =
                adaptive.layers[record.offset + static_cast<std::size_t>(i)];
            if (layer.transmittance > previous + 1.0e-6f) {
                monotonicCurves = false;
            }
            previous = layer.transmittance;
        }
    }
    expect(monotonicCurves, "cumulative transmittance never increases with depth");

    const ProbeMetrics singleMetrics =
        measureMapAgainstReference(scene, single, 4);
    const ProbeMetrics adaptiveMetrics =
        measureMapAgainstReference(scene, adaptive, 4);
    expect(adaptiveMetrics.mae < 0.08,
           "adaptive reconstruction stays close to per-ray reference");
    expect(adaptiveMetrics.attenuationMonotonic,
           "mean brightness decreases monotonically with glass blade count");
    expect(adaptiveMetrics.filamentProbes > 20,
           "probe set contains filament shadow samples");
    expect(adaptiveMetrics.retainedFilamentShadows >=
               adaptiveMetrics.filamentProbes * 0.85,
           "thin filament shadows survive deep-map reconstruction");
    expect(adaptiveMetrics.mae <= singleMetrics.mae + 0.02,
           "adaptive depth reconstruction is competitive with single layer");

    bool foundGlassReceiver = false;
    bool foundAttenuatedReceiver = false;
    for (int y = 0; y < 12 && !foundGlassReceiver; ++y) {
        for (int x = 0; x < 16 && !foundGlassReceiver; ++x) {
            const Vec3 receiver{-1.8f + 0.24f * x, 0.4f + 0.30f * y,
                                -0.2f};
            const ShadowRayResult exact = scene.traceToLight(receiver, true);
            foundGlassReceiver = exact.glassSurfaces >= 2;
            foundAttenuatedReceiver = exact.transmittance < 0.95f;
        }
    }
    expect(foundGlassReceiver,
           "receiver ray crosses transparent glass surfaces");
    expect(foundAttenuatedReceiver,
           "glass and smoke attenuate the per-ray reference");

    if (failures != 0) {
        std::cerr << failures << " test(s) failed\n";
        return 1;
    }
    std::cout << "All core tests passed\n";
    return 0;
}
