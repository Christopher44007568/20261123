#include "render.hpp"

#include <algorithm>
#include <cmath>
#include <numeric>

namespace ds {
namespace {

constexpr int kMaxCameraDepth = 10;

Vec3 environment(const Vec3& direction) {
    const float t = saturate(direction.y * 0.5f + 0.5f);
    return lerp(Vec3{0.012f, 0.020f, 0.034f}, Vec3{0.060f, 0.078f, 0.094f}, t);
}

Vec3 wallPattern(const Vec3& point, const Vec3& base) {
    const float panelX = std::abs(std::fmod(point.x + 3.0f, 1.5f) - 0.75f);
    const float panelY = std::abs(std::fmod(point.y + 1.0f, 1.25f) - 0.625f);
    const float trimX = 1.0f - smoothstep(0.018f, 0.055f, panelX);
    const float trimY = 1.0f - smoothstep(0.012f, 0.040f, panelY);
    const float trim = std::max(trimX, trimY);
    Vec3 color = base * (0.82f + 0.18f * smoothstep(0.0f, 1.0f, point.y * 0.2f));
    color += Vec3{0.14f, 0.105f, 0.052f} * trim * 0.45f;
    return color;
}

Vec3 floorPattern(const Vec3& point, const Vec3& base) {
    const float gx = std::abs(std::fmod(point.x + 3.0f, 1.2f) - 0.6f);
    const float gz = std::abs(std::fmod(point.z + 2.5f, 1.2f) - 0.6f);
    const float line = std::max(1.0f - smoothstep(0.008f, 0.030f, gx),
                                1.0f - smoothstep(0.008f, 0.030f, gz));
    return base + Vec3{0.055f, 0.047f, 0.030f} * line;
}

struct TraceContext {
    const Scene& scene;
    const DeepShadowMap* shadowMap = nullptr;
    bool referenceShadows = false;
    FrameMetrics* metrics = nullptr;
    std::vector<float>* errors = nullptr;
};

Vec3 traceRadiance(const TraceContext& ctx, const Ray& ray, int depth,
                   bool primary);

void applyBloom(Image& image) {
    Image glow(image.width, image.height);
    for (int y = 0; y < image.height; ++y) {
        for (int x = 0; x < image.width; ++x) {
            const Vec3 source = image.at(x, y);
            const float energy = std::max(0.0f, luminance(source) - 0.85f);
            if (energy <= 0.0f) {
                continue;
            }
            constexpr int radius = 13;
            constexpr float sigma = 5.0f;
            for (int dy = -radius; dy <= radius; ++dy) {
                const int py = y + dy;
                if (py < 0 || py >= image.height) {
                    continue;
                }
                for (int dx = -radius; dx <= radius; ++dx) {
                    const int px = x + dx;
                    if (px < 0 || px >= image.width) {
                        continue;
                    }
                    const float distanceSq =
                        static_cast<float>(dx * dx + dy * dy);
                    const float weight =
                        std::exp(-distanceSq / (2.0f * sigma * sigma));
                    glow.at(px, py) += source * (weight * energy * 0.018f);
                }
            }
        }
    }
    for (std::size_t i = 0; i < image.pixels.size(); ++i) {
        image.pixels[i] += glow.pixels[i];
    }
}

Vec3 shadeReceiver(const TraceContext& ctx, const SurfaceHit& hit,
                   const Ray& ray, bool primary) {
    const Scene& scene = ctx.scene;
    const Vec3 toLight = normalize(scene.lightPosition - hit.point);
    const float normalDotLight = std::max(dot(hit.normal, toLight), 0.0f);
    const float spot = scene.spotAttenuation(hit.point);
    const ShadowRayResult exact = scene.traceToLight(hit.point, true);
    const float referenceT = exact.transmittance;
    const float mapT =
        ctx.shadowMap != nullptr ? ctx.shadowMap->sampleWorld(scene, hit.point)
                                 : referenceT;
    const float shadowT = ctx.referenceShadows ? referenceT : mapT;

    if (primary && ctx.metrics != nullptr && spot * normalDotLight > 1.0e-6f) {
        ++ctx.metrics->receiverPixels;
        ++ctx.metrics->litReceiverPixels;
        ctx.metrics->referenceMeanTransmittance += referenceT;
        ctx.metrics->mapMeanTransmittance += shadowT;
        if (referenceT < 0.985f) {
            ++ctx.metrics->shadowedReceiverPixels;
        }
        if (ctx.errors != nullptr) {
            ctx.errors->push_back(std::abs(mapT - referenceT));
        }
    }

    Vec3 base = hit.material.albedo;
    if (hit.kind == MaterialKind::Wall) {
        base = hit.normal.y > 0.7f ? floorPattern(hit.point, base)
                                   : wallPattern(hit.point, base);
    }
    const Vec3 halfVector = normalize(toLight - ray.direction);
    const float specular = std::pow(
        std::max(dot(hit.normal, halfVector), 0.0f), 48.0f);
    const float rim = std::pow(
        1.0f - std::max(dot(hit.normal, -ray.direction), 0.0f), 4.0f);

    Vec3 radiance = base * Vec3{0.085f, 0.105f, 0.125f};
    radiance += base * scene.lightColor * (spot * normalDotLight * shadowT);
    radiance += scene.lightColor * (specular * shadowT * spot * 0.55f);
    radiance += Vec3{0.035f, 0.065f, 0.080f} * (rim * 0.06f);

    if (primary) {
        const float fog =
            1.0f - std::exp(-scene.smokeOpticalDepth(ray, hit.t));
        radiance = lerp(radiance, Vec3{0.022f, 0.030f, 0.042f},
                        fog * 0.72f);
    }
    return radiance;
}

Vec3 traceRadiance(const TraceContext& ctx, const Ray& ray, int depth,
                   bool primary) {
    if (depth > kMaxCameraDepth) {
        return environment(ray.direction);
    }
    SurfaceHit hit;
    if (!ctx.scene.intersectNearest(ray, 1.0e-4f, kInf, hit)) {
        return environment(ray.direction);
    }

    if (hit.kind == MaterialKind::Glass) {
        const Vec3 inside = hit.point + ray.direction * 1.9e-4f;
        const Ray next{inside, ray.direction};
        const Vec3 through = traceRadiance(ctx, next, depth + 1, false);
        const float cosine =
            std::max(std::abs(dot(ray.direction, hit.normal)), 0.02f);
        const float fresnel =
            hit.material.reflectivity +
            (1.0f - hit.material.reflectivity) *
                std::pow(1.0f - cosine, 5.0f);
        const Vec3 reflected =
            environment(reflect(ray.direction, hit.normal));
        const Vec3 tint{0.84f, 0.95f, 1.0f};
        Vec3 glow = hit.material.albedo *
                    (0.050f + 0.075f * std::pow(1.0f - cosine, 2.0f));
        glow += Vec3{0.018f, 0.036f, 0.052f} *
                std::pow(1.0f - cosine, 2.0f);
        const Vec3 toLight = normalize(ctx.scene.lightPosition - hit.point);
        const float ndl = std::max(dot(hit.normal, toLight), 0.0f);
        const float spot = ctx.scene.spotAttenuation(hit.point);
        const Vec3 halfVector = normalize(toLight - ray.direction);
        glow += ctx.scene.lightColor *
                (0.32f * std::pow(std::max(dot(hit.normal, halfVector), 0.0f),
                                  72.0f));
        glow += ctx.scene.lightColor * (spot * ndl * 0.16f);
        const Primitive& primitive =
            ctx.scene.primitives[static_cast<std::size_t>(hit.primitive)];
        if (primitive.shape == ShapeKind::Box) {
            const Vec3 local = hit.point - primitive.center;
            const float eu = std::abs(dot(local, primitive.axisU)) /
                             std::max(primitive.halfExtents.x, 1.0e-5f);
            const float ev = std::abs(dot(local, primitive.axisV)) /
                             std::max(primitive.halfExtents.y, 1.0e-5f);
            const float edge = smoothstep(0.74f, 0.98f, std::max(eu, ev));
            glow += Vec3{0.20f, 0.38f, 0.50f} *
                    (edge * (0.11f + 0.20f * (1.0f - cosine)));
        }
        return through * tint * (1.0f - fresnel) +
               reflected * (fresnel * 0.42f) + glow;
    }

    if (hit.kind == MaterialKind::Bulb) {
        return hit.material.emission;
    }

    if (hit.kind == MaterialKind::Wire) {
        const Vec3 toLight = normalize(ctx.scene.lightPosition - hit.point);
        const float ndl = std::max(dot(hit.normal, toLight), 0.0f);
        const float spot = ctx.scene.spotAttenuation(hit.point);
        return hit.material.albedo *
                   (Vec3{0.02f, 0.025f, 0.03f} +
                    ctx.scene.lightColor * (spot * ndl * 1.2f)) +
               ctx.scene.lightColor * (ndl * ndl * 0.08f);
    }

    if (hit.kind == MaterialKind::Gold) {
        const Vec3 toLight = normalize(ctx.scene.lightPosition - hit.point);
        const float ndl = std::max(dot(hit.normal, toLight), 0.0f);
        const Vec3 halfVector = normalize(toLight - ray.direction);
        const float specular = std::pow(
            std::max(dot(hit.normal, halfVector), 0.0f), 90.0f);
        const float spot = ctx.scene.spotAttenuation(hit.point);
        return hit.material.albedo *
                   (Vec3{0.075f, 0.052f, 0.026f} +
                    ctx.scene.lightColor * (spot * ndl * 0.55f)) +
               ctx.scene.lightColor * (specular * spot * 1.15f);
    }

    return shadeReceiver(ctx, hit, ray, primary);
}

}  // namespace

RenderOutput renderFrame(const Scene& scene, const DeepShadowMap* shadowMap,
                         float cameraAngle, const RenderSettings& settings,
                         bool collectShadowError) {
    RenderOutput output;
    output.image = Image(settings.width, settings.height);
    FrameMetrics metrics;
    std::vector<float> errors;
    errors.reserve(static_cast<std::size_t>(settings.width) * settings.height);
    TraceContext ctx{scene, shadowMap, settings.referenceShadows, &metrics,
                     &errors};
    const Camera camera = scene.cameraForAngle(cameraAngle);

    for (int y = 0; y < settings.height; ++y) {
        for (int x = 0; x < settings.width; ++x) {
            const float sx =
                (static_cast<float>(x) + 0.5f) /
                    static_cast<float>(settings.width) * 2.0f - 1.0f;
            const float sy =
                1.0f - (static_cast<float>(y) + 0.5f) /
                           static_cast<float>(settings.height) * 2.0f;
            output.image.at(x, y) =
                traceRadiance(ctx, camera.ray(sx, sy), 0, true);
        }
    }
    applyBloom(output.image);

    metrics.transmittanceMae =
        errors.empty()
            ? 0.0
            : std::accumulate(errors.begin(), errors.end(), 0.0) /
                  static_cast<double>(errors.size());
    double squared = 0.0;
    for (float error : errors) {
        squared += static_cast<double>(error) * error;
    }
    metrics.transmittanceRmse =
        errors.empty() ? 0.0
                       : std::sqrt(squared / static_cast<double>(errors.size()));
    if (!errors.empty()) {
        std::vector<float> sorted = errors;
        const std::size_t p95Index = static_cast<std::size_t>(
            static_cast<double>(sorted.size() - 1) * 0.95);
        std::nth_element(sorted.begin(),
                         sorted.begin() +
                             static_cast<std::ptrdiff_t>(p95Index),
                         sorted.end());
        metrics.transmittanceP95 = sorted[p95Index];
    }
    if (metrics.receiverPixels > 0) {
        metrics.referenceMeanTransmittance /=
            static_cast<double>(metrics.receiverPixels);
        metrics.mapMeanTransmittance /= static_cast<double>(metrics.receiverPixels);
    }
    if (!collectShadowError) {
        metrics = FrameMetrics{};
    }
    output.metrics = metrics;
    return output;
}

}  // namespace ds
