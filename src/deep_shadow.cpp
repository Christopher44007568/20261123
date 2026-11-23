#include "deep_shadow.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <numeric>

namespace ds {
namespace {

struct CurveKnot {
    float depth = 0.0f;
    float transmittance = 1.0f;
};

using RayCurve = std::vector<TransmittanceEvent>;

float quantizedDepth(float depth, float nearDepth, float farDepth, int bins) {
    if (depth <= nearDepth) {
        return nearDepth;
    }
    if (depth >= farDepth) {
        return farDepth;
    }
    const float scaled =
        (depth - nearDepth) / (farDepth - nearDepth) * static_cast<float>(bins);
    const float bin = std::floor(scaled) + 1.0f;
    return std::min(farDepth, nearDepth + bin * (farDepth - nearDepth) /
                                             static_cast<float>(bins));
}

std::vector<float> uniqueSorted(std::vector<float> values) {
    std::sort(values.begin(), values.end());
    values.erase(std::unique(values.begin(), values.end()), values.end());
    return values;
}

std::vector<float> averageCurve(const std::vector<RayCurve>& curves,
                                const std::vector<float>& depths) {
    std::vector<float> averages(depths.size(), 0.0f);
    if (curves.empty()) {
        std::fill(averages.begin(), averages.end(), 1.0f);
        return averages;
    }
    for (const RayCurve& curve : curves) {
        float transmittance = 1.0f;
        std::size_t eventIndex = 0;
        for (std::size_t i = 0; i < depths.size(); ++i) {
            while (eventIndex < curve.size() &&
                   curve[eventIndex].depth <= depths[i]) {
                transmittance *= curve[eventIndex].factor;
                ++eventIndex;
            }
            averages[i] += transmittance;
        }
    }
    const float inv = 1.0f / static_cast<float>(curves.size());
    for (float& value : averages) {
        value *= inv;
    }
    return averages;
}

int countOccupied(const std::vector<DeepLayer>& layers) {
    int occupied = 0;
    float previous = 1.0f;
    for (const DeepLayer& layer : layers) {
        if (layer.transmittance < previous - 1.0e-5f) {
            ++occupied;
        }
        previous = layer.transmittance;
    }
    return occupied;
}

}  // namespace

std::string shadowModeName(ShadowMode mode) {
    switch (mode) {
        case ShadowMode::SingleLayer:
            return "single";
        case ShadowMode::FixedLayers:
            return "fixed";
        case ShadowMode::Adaptive:
            return "adaptive";
    }
    return "unknown";
}

void DeepShadowMap::build(const Scene& scene, const LightCamera& light,
                          int mapWidth, int mapHeight, ShadowMode shadowMode,
                          const BuildOptions& options) {
    const auto start = std::chrono::steady_clock::now();
    mode = shadowMode;
    width = mapWidth;
    height = mapHeight;
    fixedLayers =
        shadowMode == ShadowMode::FixedLayers ? options.fixedLayers : 0;
    const int subrays = std::max(1, options.subrays);
    const float subrayStep = 1.0f / static_cast<float>(subrays);

    nearDepth = options.nearDepth;
    farDepth = options.farDepth;
    if (nearDepth < 0.0f) {
        nearDepth = 3.0f;
    }
    if (farDepth < 0.0f) {
        const Vec3 wallCenter{0.0f, 2.10f, -7.20f};
        farDepth = length(wallCenter - scene.lightPosition) + 1.6f;
    }
    farDepth = std::max(farDepth, nearDepth + 0.1f);

    pixels.assign(static_cast<std::size_t>(width) * height, PixelRecord{});
    layers.clear();
    layers.reserve(static_cast<std::size_t>(width) * height *
                   static_cast<std::size_t>(
                       shadowMode == ShadowMode::SingleLayer
                           ? 1
                           : shadowMode == ShadowMode::FixedLayers
                                 ? fixedLayers
                                 : 8));

    std::vector<RayCurve> curves(static_cast<std::size_t>(subrays * subrays));
    std::vector<float> candidates;
    candidates.reserve(96);
    std::vector<DeepLayer> pixelLayers;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            candidates.clear();
            for (int sy = 0; sy < subrays; ++sy) {
                for (int sx = 0; sx < subrays; ++sx) {
                    const float px =
                        (static_cast<float>(x) +
                         (static_cast<float>(sx) + 0.5f) * subrayStep) /
                        static_cast<float>(width);
                    const float py =
                        (static_cast<float>(y) +
                         (static_cast<float>(sy) + 0.5f) * subrayStep) /
                        static_cast<float>(height);
                    Ray ray = light.ray(px * 2.0f - 1.0f,
                                        1.0f - py * 2.0f);
                    RayCurve& curve =
                        curves[static_cast<std::size_t>(sy * subrays + sx)];
                    scene.collectEvents(ray, farDepth, options.smokeSamples,
                                        curve);
                    for (const TransmittanceEvent& event : curve) {
                        if (event.depth >= nearDepth && event.depth <= farDepth) {
                            candidates.push_back(quantizedDepth(
                                event.depth, nearDepth, farDepth,
                                options.depthBins));
                        }
                    }
                }
            }
            candidates = uniqueSorted(std::move(candidates));
            pixelLayers.clear();

            if (candidates.empty()) {
                if (shadowMode == ShadowMode::SingleLayer) {
                    pixelLayers.push_back({farDepth, 1.0f});
                } else if (shadowMode == ShadowMode::FixedLayers) {
                    const int count = std::max(1, options.fixedLayers);
                    for (int i = 0; i < count; ++i) {
                        pixelLayers.push_back(
                            {nearDepth + (farDepth - nearDepth) *
                                             static_cast<float>(i + 1) /
                                             static_cast<float>(count),
                             1.0f});
                    }
                }
                PixelRecord& record =
                    pixels[static_cast<std::size_t>(y) * width + x];
                record.offset = static_cast<uint32_t>(layers.size());
                record.count = static_cast<uint16_t>(
                    std::min<std::size_t>(pixelLayers.size(), 65535u));
                record.occupied = 0;
                layers.insert(layers.end(), pixelLayers.begin(),
                              pixelLayers.end());
                continue;
            }

            const std::vector<float> average =
                averageCurve(curves, candidates);
            if (shadowMode == ShadowMode::SingleLayer) {
                float previous = 1.0f;
                double weightedDepth = 0.0;
                double weightSum = 0.0;
                for (std::size_t i = 0; i < candidates.size(); ++i) {
                    const double drop =
                        static_cast<double>(previous - average[i]);
                    if (drop > 1.0e-6) {
                        weightedDepth += drop * candidates[i];
                        weightSum += drop;
                    }
                    previous = average[i];
                }
                if (!average.empty()) {
                    float depth = candidates.front();
                    if (weightSum > 1.0e-8) {
                        depth = static_cast<float>(weightedDepth / weightSum);
                    }
                    depth = quantizedDepth(depth, nearDepth, farDepth,
                                           options.depthBins);
                    pixelLayers.push_back({depth, average.back()});
                }
            } else if (shadowMode == ShadowMode::FixedLayers) {
                const int count = std::max(1, options.fixedLayers);
                std::vector<float> boundaries(static_cast<std::size_t>(count));
                for (int i = 0; i < count; ++i) {
                    boundaries[static_cast<std::size_t>(i)] =
                        nearDepth + (farDepth - nearDepth) *
                                        static_cast<float>(i + 1) /
                                        static_cast<float>(count);
                }
                const std::vector<float> values =
                    averageCurve(curves, boundaries);
                for (int i = 0; i < count; ++i) {
                    pixelLayers.push_back(
                        {boundaries[static_cast<std::size_t>(i)],
                         values[static_cast<std::size_t>(i)]});
                }
            } else {
                std::vector<CurveKnot> knots;
                knots.reserve(candidates.size());
                float previous = 1.0f;
                for (std::size_t i = 0; i < candidates.size(); ++i) {
                    if (average[i] < previous - 1.0e-6f) {
                        knots.push_back({candidates[i], average[i]});
                        previous = average[i];
                    }
                }

                const int maxLayers = std::max(2, options.adaptiveMaxLayers);
                while (knots.size() > 2 &&
                       (static_cast<int>(knots.size()) > maxLayers ||
                        options.adaptiveTolerance > 0.0)) {
                    std::size_t removeIndex = 1;
                    double bestCost = std::numeric_limits<double>::infinity();
                    for (std::size_t i = 1; i + 1 < knots.size(); ++i) {
                        const float leftDepth =
                            knots[i].depth - knots[i - 1].depth;
                        const float rightDepth =
                            knots[i + 1].depth - knots[i].depth;
                        const float span = leftDepth + rightDepth;
                        if (span <= 1.0e-7f) {
                            bestCost = -1.0;
                            removeIndex = i;
                            break;
                        }
                        const double errorLeft =
                            std::abs(static_cast<double>(
                                knots[i - 1].transmittance -
                                knots[i + 1].transmittance)) *
                            leftDepth;
                        const double errorRight =
                            std::abs(static_cast<double>(
                                knots[i].transmittance -
                                knots[i + 1].transmittance)) *
                            rightDepth;
                        const double cost = (errorLeft + errorRight) / span;
                        if (cost < bestCost) {
                            bestCost = cost;
                            removeIndex = i;
                        }
                    }
                    if (static_cast<int>(knots.size()) <= maxLayers &&
                        bestCost > options.adaptiveTolerance) {
                        break;
                    }
                    knots.erase(knots.begin() +
                                static_cast<std::ptrdiff_t>(removeIndex));
                }

                if (knots.empty()) {
                    knots.push_back({candidates.back(), average.back()});
                }
                for (const CurveKnot& knot : knots) {
                    pixelLayers.push_back(
                        {knot.depth, knot.transmittance});
                }
            }

            PixelRecord& record =
                pixels[static_cast<std::size_t>(y) * width + x];
            record.offset = static_cast<uint32_t>(layers.size());
            record.count = static_cast<uint16_t>(
                std::min<std::size_t>(pixelLayers.size(), 65535u));
            record.occupied = static_cast<uint16_t>(countOccupied(pixelLayers));
            layers.insert(layers.end(), pixelLayers.begin(), pixelLayers.end());
        }
    }

    std::size_t totalLayers = 0;
    std::size_t totalLayersNonEmpty = 0;
    std::size_t totalOccupied = 0;
    std::size_t emptyPixels = 0;
    int maximumLayers = 0;
    for (const PixelRecord& record : pixels) {
        totalLayers += record.count;
        if (record.occupied > 0) {
            totalLayersNonEmpty += record.count;
        }
        totalOccupied += record.occupied;
        maximumLayers = std::max(maximumLayers, static_cast<int>(record.count));
        if (record.occupied == 0) {
            ++emptyPixels;
        }
    }
    const auto end = std::chrono::steady_clock::now();
    stats.mode = mode;
    stats.width = width;
    stats.height = height;
    stats.fixedLayers = fixedLayers;
    stats.averageLayers = pixels.empty()
                              ? 0.0
                              : static_cast<double>(totalLayers) /
                                    static_cast<double>(pixels.size());
    stats.averageLayersNonEmpty =
        emptyPixels == pixels.size()
            ? 0.0
            : static_cast<double>(totalLayersNonEmpty) /
                  static_cast<double>(pixels.size() - emptyPixels);
    stats.averageOccupiedLayers =
        pixels.empty() ? 0.0
                       : static_cast<double>(totalOccupied) /
                             static_cast<double>(pixels.size());
    stats.maxLayers = maximumLayers;
    stats.emptyPixels = emptyPixels;
    stats.nearDepth = nearDepth;
    stats.farDepth = farDepth;
    stats.storageBytes = storageBytes();
    stats.buildMilliseconds =
        std::chrono::duration<double, std::milli>(end - start).count();
}

const PixelRecord& DeepShadowMap::pixel(int x, int y) const {
    const int cx = std::clamp(x, 0, width - 1);
    const int cy = std::clamp(y, 0, height - 1);
    return pixels[static_cast<std::size_t>(cy) * width + cx];
}

float DeepShadowMap::evaluateRecord(
    const PixelRecord& record, const std::vector<DeepLayer>& allLayers,
    float receiverDepth) {
    if (record.count == 0) {
        return 1.0f;
    }
    const std::size_t offset = record.offset;
    const std::size_t count = record.count;
    if (offset + count > allLayers.size()) {
        return 1.0f;
    }
    if (receiverDepth < allLayers[offset].depth) {
        return 1.0f;
    }
    float transmittance = 1.0f;
    for (std::size_t i = 0; i < count; ++i) {
        const DeepLayer& layer = allLayers[offset + i];
        if (layer.depth > receiverDepth) {
            break;
        }
        transmittance = layer.transmittance;
    }
    return transmittance;
}

float DeepShadowMap::evaluatePixel(int x, int y, float receiverDepth) const {
    if (width <= 0 || height <= 0 || pixels.empty()) {
        return 1.0f;
    }
    return evaluateRecord(pixel(x, y), layers, receiverDepth);
}

float DeepShadowMap::sample(const Vec2& uv, float receiverDepth) const {
    if (width <= 0 || height <= 0 || uv.x < 0.0f || uv.x > 1.0f ||
        uv.y < 0.0f || uv.y > 1.0f) {
        return 1.0f;
    }
    const float px = uv.x * static_cast<float>(width) - 0.5f;
    const float py = uv.y * static_cast<float>(height) - 0.5f;
    const int x0 = static_cast<int>(std::floor(px));
    const int y0 = static_cast<int>(std::floor(py));
    const float fx = px - static_cast<float>(x0);
    const float fy = py - static_cast<float>(y0);

    const float t00 = evaluatePixel(x0, y0, receiverDepth);
    const float t10 = evaluatePixel(x0 + 1, y0, receiverDepth);
    const float t01 = evaluatePixel(x0, y0 + 1, receiverDepth);
    const float t11 = evaluatePixel(x0 + 1, y0 + 1, receiverDepth);
    const float top = lerp(t00, t10, fx);
    const float bottom = lerp(t01, t11, fx);
    return lerp(top, bottom, fy);
}

float DeepShadowMap::sampleWorld(const Scene& scene, const Vec3& point) const {
    const LightCamera light = scene.lightCamera();
    Vec2 uv;
    float depth = 0.0f;
    if (!light.project(point, uv, depth)) {
        return 1.0f;
    }
    return sample(uv, depth);
}

std::size_t DeepShadowMap::storageBytes() const {
    return pixels.size() * sizeof(PixelRecord) +
           layers.size() * sizeof(DeepLayer) + sizeof(*this);
}

}  // namespace ds
