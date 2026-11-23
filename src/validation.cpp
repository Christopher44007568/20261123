#include "validation.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace ds {
namespace {

void addGrid(std::vector<Vec3>& points, int nx, int ny, float x0, float x1,
             float y0, float y1, float fixedCoordinate, int axis,
             int stride) {
    const int step = std::max(1, stride);
    for (int iy = 0; iy < ny; iy += step) {
        const float v = ny <= 1 ? 0.5f
                               : static_cast<float>(iy) / static_cast<float>(ny - 1);
        for (int ix = 0; ix < nx; ix += step) {
            const float u =
                nx <= 1 ? 0.5f
                        : static_cast<float>(ix) / static_cast<float>(nx - 1);
            const float a = lerp(x0, x1, u);
            const float b = lerp(y0, y1, v);
            if (axis == 0) {
                points.push_back({a, b, fixedCoordinate});
            } else if (axis == 1) {
                points.push_back({fixedCoordinate, b, a});
            } else {
                points.push_back({a, fixedCoordinate, b});
            }
        }
    }
}

std::vector<Vec3> makeProbePoints(int stride) {
    std::vector<Vec3> points;
    points.reserve(16000);
    addGrid(points, 76, 38, -5.2f, 5.2f, 0.0f, 5.4f, -7.15f, 0, stride);
    const float depths[] = {0.90f, 0.45f, 0.00f, -0.45f, -0.90f, -1.55f,
                            -2.40f, -3.40f};
    for (float depth : depths) {
        addGrid(points, 38, 24, -2.35f, 2.35f, 0.15f, 4.55f, depth, 0,
                stride);
    }
    addGrid(points, 48, 28, -4.2f, 4.2f, -4.0f, 3.5f, -0.82f, 2, stride);
    return points;
}

}  // namespace

ProbeMetrics measureMapAgainstReference(const Scene& scene,
                                        const DeepShadowMap& map,
                                        int gridStride) {
    ProbeMetrics metrics;
    metrics.layerBins.resize(9);
    for (int i = 0; i < 9; ++i) {
        metrics.layerBins[static_cast<std::size_t>(i)].glassBlades = i;
    }
    const std::vector<Vec3> points = makeProbePoints(gridStride);
    std::vector<float> errors;
    errors.reserve(points.size());
    double referenceSum = 0.0;
    double mapSum = 0.0;

    for (const Vec3& point : points) {
        if (scene.spotAttenuation(point) <= 1.0e-8f) {
            continue;
        }
        ++metrics.probes;
        const ShadowRayResult exact = scene.traceToLight(point, true);
        const float mapT = map.sampleWorld(scene, point);
        const float error = std::abs(mapT - exact.transmittance);
        errors.push_back(error);
        referenceSum += exact.transmittance;
        mapSum += mapT;
        if (exact.transmittance < 0.985f) {
            ++metrics.shadowedProbes;
        }

        const int blades = std::clamp(exact.glassSurfaces / 2, 0, 8);
        LayerBin& bin = metrics.layerBins[static_cast<std::size_t>(blades)];
        ++bin.probes;
        bin.referenceMeanTransmittance += exact.transmittance;
        bin.mapMeanTransmittance += mapT;

        if (exact.hitWire && exact.transmittance < 0.60f) {
            ++metrics.filamentProbes;
            metrics.filamentReferenceMean += exact.transmittance;
            metrics.filamentMapMean += mapT;
            if (mapT < 0.90f) {
                ++metrics.retainedFilamentShadows;
            }
        }
    }

    metrics.litProbes = metrics.probes;
    if (!errors.empty()) {
        metrics.mae =
            std::accumulate(errors.begin(), errors.end(), 0.0) /
            static_cast<double>(errors.size());
        double squared = 0.0;
        for (float error : errors) {
            squared += static_cast<double>(error) * error;
        }
        metrics.rmse =
            std::sqrt(squared / static_cast<double>(errors.size()));
        std::vector<float> sorted = errors;
        const std::size_t p95Index = static_cast<std::size_t>(
            static_cast<double>(sorted.size() - 1) * 0.95);
        std::nth_element(sorted.begin(),
                         sorted.begin() +
                             static_cast<std::ptrdiff_t>(p95Index),
                         sorted.end());
        metrics.p95 = sorted[p95Index];
        metrics.maximum = *std::max_element(sorted.begin(), sorted.end());
    }
    if (metrics.probes > 0) {
        metrics.referenceMeanTransmittance =
            referenceSum / static_cast<double>(metrics.probes);
        metrics.mapMeanTransmittance = mapSum / static_cast<double>(metrics.probes);
    }
    if (metrics.filamentProbes > 0) {
        metrics.filamentReferenceMean /=
            static_cast<double>(metrics.filamentProbes);
        metrics.filamentMapMean /= static_cast<double>(metrics.filamentProbes);
    }

    double previousMean = 2.0;
    for (LayerBin& bin : metrics.layerBins) {
        if (bin.probes == 0) {
            continue;
        }
        bin.referenceMeanTransmittance /= static_cast<double>(bin.probes);
        bin.mapMeanTransmittance /= static_cast<double>(bin.probes);
        metrics.attenuationBandError =
            std::max(metrics.attenuationBandError,
                     std::abs(bin.mapMeanTransmittance -
                              bin.referenceMeanTransmittance));
        if (bin.probes >= 20 && bin.mapMeanTransmittance > previousMean + 0.015) {
            metrics.attenuationMonotonic = false;
        }
        if (bin.probes >= 20) {
            previousMean = bin.mapMeanTransmittance;
        }
    }
    return metrics;
}

}  // namespace ds
