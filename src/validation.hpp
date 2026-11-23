#pragma once

#include "deep_shadow.hpp"
#include "render.hpp"

#include <cstddef>
#include <vector>

namespace ds {

struct LayerBin {
    int glassBlades = 0;
    std::size_t probes = 0;
    double referenceMeanTransmittance = 0.0;
    double mapMeanTransmittance = 0.0;
};

struct ProbeMetrics {
    std::size_t probes = 0;
    std::size_t litProbes = 0;
    std::size_t shadowedProbes = 0;
    double mae = 0.0;
    double rmse = 0.0;
    double p95 = 0.0;
    double maximum = 0.0;
    double referenceMeanTransmittance = 0.0;
    double mapMeanTransmittance = 0.0;
    double attenuationBandError = 0.0;
    bool attenuationMonotonic = true;
    std::size_t filamentProbes = 0;
    std::size_t retainedFilamentShadows = 0;
    double filamentReferenceMean = 0.0;
    double filamentMapMean = 0.0;
    std::vector<LayerBin> layerBins;
};

struct ModeReport {
    ShadowMode mode = ShadowMode::Adaptive;
    MapStats map;
    FrameMetrics frame;
    ProbeMetrics probes;
};

struct FrameReport {
    int frame = 0;
    float angle = 0.0f;
    FrameMetrics metrics;
    ProbeMetrics probes;
};

ProbeMetrics measureMapAgainstReference(const Scene& scene,
                                        const DeepShadowMap& map,
                                        int gridStride = 1);

}  // namespace ds
