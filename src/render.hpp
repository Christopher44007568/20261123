#pragma once

#include "deep_shadow.hpp"
#include "image.hpp"

#include <cstddef>

namespace ds {

struct FrameMetrics {
    std::size_t receiverPixels = 0;
    std::size_t litReceiverPixels = 0;
    std::size_t shadowedReceiverPixels = 0;
    double transmittanceMae = 0.0;
    double transmittanceRmse = 0.0;
    double transmittanceP95 = 0.0;
    double referenceMeanTransmittance = 0.0;
    double mapMeanTransmittance = 0.0;
};

struct RenderOutput {
    Image image;
    FrameMetrics metrics;
};

struct RenderSettings {
    int width = 480;
    int height = 320;
    float exposure = 1.35f;
    bool referenceShadows = false;
    uint32_t seed = 0;
};

RenderOutput renderFrame(const Scene& scene, const DeepShadowMap* shadowMap,
                         float cameraAngle, const RenderSettings& settings,
                         bool collectShadowError = true);

}  // namespace ds
