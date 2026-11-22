#include "renderer.hpp"

#include "image.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace ocr {
namespace {

std::uint32_t hashU32(std::uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

struct Rng {
    std::uint32_t state;

    explicit Rng(std::uint32_t seed) : state(hashU32(seed)) {}

    float next() {
        state = state * 1664525u + 1013904223u;
        return static_cast<float>((state >> 8) & 0x00ffffffu) /
               static_cast<float>(0x01000000u);
    }
};

void basisFromNormal(const Vec3& n, Vec3& tangent, Vec3& bitangent) {
    const Vec3 helper =
        std::fabs(n.y) < 0.92f ? Vec3{0.0f, 1.0f, 0.0f}
                               : Vec3{1.0f, 0.0f, 0.0f};
    tangent = normalize(cross(helper, n));
    bitangent = cross(n, tangent);
}

Vec3 cosineHemisphere(const Vec3& n, Rng& rng) {
    const float r1 = rng.next();
    const float r2 = rng.next();
    const float phi = 2.0f * kPi * r1;
    const float radius = std::sqrt(r2);
    Vec3 tangent;
    Vec3 bitangent;
    basisFromNormal(n, tangent, bitangent);
    const float z = std::sqrt(std::max(0.0f, 1.0f - r2));
    return normalize(tangent * (std::cos(phi) * radius) +
                     bitangent * (std::sin(phi) * radius) + n * z);
}

Vec3 perturbDirection(const Vec3& direction, float roughness, Rng& rng) {
    if (roughness <= 1.0e-4f) {
        return direction;
    }
    Vec3 tangent;
    Vec3 bitangent;
    basisFromNormal(direction, tangent, bitangent);
    const float angle = roughness * roughness * 0.9f;
    const float r = angle * std::sqrt(rng.next());
    const float phi = 2.0f * kPi * rng.next();
    return normalize(direction + tangent * (std::cos(phi) * r) +
                     bitangent * (std::sin(phi) * r));
}

float fresnelSchlick(float cosTheta, float f0) {
    const float m = clampf(1.0f - cosTheta, 0.0f, 1.0f);
    return f0 + (1.0f - f0) * m * m * m * m * m;
}

float directVisibility(const Scene& scene, const Vec3& point,
                       const Vec3& normal, const Vec3& lightDir,
                       bool useBvh) {
    if (dot(normal, lightDir) <= 0.0f) {
        return 0.0f;
    }
    const Ray shadowRay{point + normal * 0.012f, lightDir};
    return scene.occluded(shadowRay, 80.0f, useBvh) ? 0.0f : 1.0f;
}

Vec3 shadeDirect(const Scene& scene, const Hit& hit, const Vec3& viewDir,
                 bool useBvh) {
    const Material& mat = scene.material(hit.material);
    const Vec3 lightDir = normalize(Vec3{-0.45f, 0.82f, 0.36f});
    const float ndotl = std::max(0.0f, dot(hit.n, lightDir));
    const float visibility =
        directVisibility(scene, hit.p, hit.n, lightDir, useBvh);
    const Vec3 sun{3.05f, 2.62f, 2.05f};
    const Vec3 diffuse =
        mat.albedo * ((1.0f - mat.metallic) * ndotl * visibility / kPi);

    const Vec3 halfway = normalize(lightDir - viewDir);
    const float ndoth = std::max(0.0f, dot(hit.n, halfway));
    const float shininess = lerpf(12.0f, 900.0f,
                                  (1.0f - mat.roughness) *
                                      (1.0f - mat.roughness));
    const float f0 = lerpf(0.04f, 1.0f, mat.metallic);
    const float fresnel = fresnelSchlick(std::max(0.0f, dot(hit.n, -viewDir)),
                                         f0);
    const Vec3 specular =
        sun * (visibility * std::pow(ndoth, shininess) * fresnel *
               (0.20f + 0.80f * mat.metallic));
    Vec3 color = diffuse * sun + specular;

    for (const PointLight& light : scene.pointLights) {
        if (scene.clip.enabled && !scene.clip.kept(light.position)) {
            continue;
        }
        const Vec3 toLight = light.position - hit.p;
        const float distance = length(toLight);
        if (distance <= 1.0e-4f) {
            continue;
        }
        const Vec3 pointDir = toLight / distance;
        const float localNdotL = std::max(0.0f, dot(hit.n, pointDir));
        if (localNdotL <= 0.0f) {
            continue;
        }
        const Ray shadowRay{hit.p + hit.n * 0.012f, pointDir};
        if (scene.occluded(shadowRay, distance - 0.02f, useBvh)) {
            continue;
        }
        const float attenuation =
            light.intensity /
            (0.35f + 0.16f * distance + 0.10f * distance * distance);
        const Vec3 localHalf = normalize(pointDir - viewDir);
        const float localNdoth =
            std::max(0.0f, dot(hit.n, localHalf));
        color += light.color * attenuation *
                 (mat.albedo * ((1.0f - mat.metallic) * localNdotL / kPi) +
                  Vec3{1.0f, 1.0f, 1.0f} *
                      (std::pow(localNdoth, shininess) * fresnel * 0.16f));
    }
    return color;
}

float ambientOcclusion(const Scene& scene, const Hit& hit, bool useBvh,
                       int samples, Rng& rng) {
    if (samples <= 0) {
        return 1.0f;
    }
    constexpr float radius = 3.0f;
    float blocked = 0.0f;
    for (int i = 0; i < samples; ++i) {
        const Vec3 dir = cosineHemisphere(hit.n, rng);
        const Ray ray{hit.p + hit.n * 0.012f, dir};
        const Hit occluder = scene.intersect(ray, useBvh);
        if (occluder.hit && occluder.t < radius) {
            blocked += 1.0f - clampf(occluder.t / radius, 0.0f, 1.0f);
        }
    }
    return clampf(1.0f - blocked / static_cast<float>(samples), 0.0f, 1.0f);
}

Vec3 shadeSurface(const Scene& scene, const Ray& ray, const Hit& hit,
                  const RenderOptions& options, Rng& rng) {
    const Material& mat = scene.material(hit.material);
    const Vec3 viewDir = normalize(ray.direction);
    const float ao = options.ambientOcclusion
                         ? ambientOcclusion(scene, hit, options.useBvh,
                                            options.aoSamples, rng)
                         : 1.0f;

    Vec3 color = shadeDirect(scene, hit, viewDir, options.useBvh);
    const Vec3 sky = skyColor(hit.n);
    color += mat.albedo * sky * ((0.30f + 0.26f * hit.n.y) *
                                 (0.18f + 0.82f * ao));
    color += mat.albedo * (mat.emissive * 0.32f);

    const float reflective = std::max(mat.reflectivity, mat.metallic * 0.45f);
    if (options.glossyReflection && reflective > 0.02f) {
        Vec3 reflected = normalize(reflect(viewDir, hit.n));
        if (dot(reflected, hit.n) <= 0.0f) {
            reflected = hit.n;
        }
        reflected = perturbDirection(reflected, mat.roughness, rng);
        if (dot(reflected, hit.n) <= 0.001f) {
            reflected = hit.n;
        }
        const Ray reflectionRay{hit.p + hit.n * 0.018f, reflected};
        const Hit reflectionHit = scene.intersect(reflectionRay, options.useBvh);
        Vec3 reflectedColor;
        if (reflectionHit.hit) {
            reflectedColor =
                shadeDirect(scene, reflectionHit, reflected, options.useBvh);
            reflectedColor += scene.material(reflectionHit.material).albedo *
                              skyColor(reflectionHit.n) * 0.22f;
            reflectedColor += scene.material(reflectionHit.material).albedo *
                              scene.material(reflectionHit.material).emissive *
                              0.32f;
        } else {
            reflectedColor = skyColor(reflected);
        }
        const float cosTheta =
            std::max(0.0f, dot(hit.n, -viewDir));
        const float f0 = lerpf(0.04f, 1.0f, mat.metallic);
        const float fresnel = fresnelSchlick(cosTheta, f0);
        const float weight =
            clampf(reflective * (0.30f + 0.70f * fresnel), 0.0f, 0.92f);
        const Vec3 tint = mix(Vec3{1.0f, 1.0f, 1.0f}, mat.albedo,
                              mat.metallic * 0.75f);
        color = color * (1.0f - weight * 0.45f) +
                reflectedColor * tint * weight;
    }
    return color;
}

Vec3 projectPoint(const Camera& camera, const Vec3& point, float& screenX,
                  float& screenY, float& depth) {
    const Vec3 forward = normalize(camera.target - camera.position);
    const Vec3 right = normalize(cross(forward, camera.up));
    const Vec3 trueUp = cross(right, forward);
    const float aspect = static_cast<float>(camera.width) /
                         static_cast<float>(std::max(1, camera.height));
    const float tanHalf = std::tan(camera.verticalFovDegrees * kPi / 360.0f);
    const Vec3 relative = point - camera.position;
    depth = dot(relative, forward);
    if (depth <= 1.0e-4f) {
        return {0.0f, 0.0f, 0.0f};
    }
    const float ndcX = dot(relative, right) / (depth * tanHalf * aspect);
    const float ndcY = dot(relative, trueUp) / (depth * tanHalf);
    screenX = (ndcX * 0.5f + 0.5f) * static_cast<float>(camera.width);
    screenY = (0.5f - ndcY * 0.5f) * static_cast<float>(camera.height);
    return {screenX, screenY, depth};
}

}  // namespace

RenderResult renderScene(const Scene& scene, const Camera& camera,
                         const RenderOptions& options) {
    RenderResult result;
    result.width = options.width;
    result.height = options.height;
    result.camera = camera;
    result.camera.width = options.width;
    result.camera.height = options.height;
    result.pixels.resize(static_cast<std::size_t>(options.width) *
                         options.height);

    for (int y = 0; y < options.height; ++y) {
        for (int x = 0; x < options.width; ++x) {
            const Ray ray = camera.primaryRay(x, y);
            TraceInfo info;
            const Hit hit = scene.intersect(ray, options.useBvh, &info);
            PixelRecord& pixel =
                result.pixels[static_cast<std::size_t>(y) * options.width + x];
            pixel.clipRejections = info.clipRejections;
            pixel.continuedAfterClip = info.continuedAfterClip;
            result.stats.clipRejections += info.clipRejections;
            result.stats.maxClipRejections =
                std::max(result.stats.maxClipRejections, info.clipRejections);
            if (info.continuedAfterClip) {
                ++result.stats.continuationPixels;
            }
            if (!hit.hit) {
                pixel.color = skyColor(ray.direction);
                ++result.stats.skyPixels;
                continue;
            }
            Rng rng(hashU32(static_cast<std::uint32_t>(x) * 1973u +
                            static_cast<std::uint32_t>(y) * 9277u + 17u));
            pixel.hit = true;
            pixel.depth = hit.t;
            pixel.normal = hit.n;
            pixel.material = hit.material;
            pixel.objectId = hit.objectId;
            pixel.primitiveId = hit.primitiveId;
            pixel.isSdf = hit.isSdf;
            pixel.color = shadeSurface(scene, ray, hit, options, rng);
            ++result.stats.hitPixels;
            ++result.stats.materialPixels[hit.material];
        }
    }
    return result;
}

Vec3 toneMap(const Vec3& linearColor) {
    Vec3 c = linearColor * 1.05f;
    c = {std::max(0.0f, c.x), std::max(0.0f, c.y), std::max(0.0f, c.z)};
    const Vec3 numerator{c.x * (2.51f * c.x + 0.03f),
                         c.y * (2.51f * c.y + 0.03f),
                         c.z * (2.51f * c.z + 0.03f)};
    const Vec3 denominator{c.x * (2.43f * c.x + 0.59f) + 0.14f,
                           c.y * (2.43f * c.y + 0.59f) + 0.14f,
                           c.z * (2.43f * c.z + 0.59f) + 0.14f};
    return {clampf(numerator.x / denominator.x, 0.0f, 1.0f),
            clampf(numerator.y / denominator.y, 0.0f, 1.0f),
            clampf(numerator.z / denominator.z, 0.0f, 1.0f)};
}

Vec3 encodeNormal(const Vec3& normal) {
    return normal * 0.5f + Vec3{0.5f, 0.5f, 0.5f};
}

namespace {

bool clipSegment(float& x0, float& y0, float& x1, float& y1,
                 float minX, float minY, float maxX, float maxY) {
    float t0 = 0.0f;
    float t1 = 1.0f;
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const float p[4] = {-dx, dx, -dy, dy};
    const float q[4] = {x0 - minX, maxX - x0, y0 - minY, maxY - y0};
    for (int i = 0; i < 4; ++i) {
        if (std::fabs(p[i]) < 1.0e-8f) {
            if (q[i] < 0.0f) {
                return false;
            }
            continue;
        }
        const float r = q[i] / p[i];
        if (p[i] < 0.0f) {
            t0 = std::max(t0, r);
        } else {
            t1 = std::min(t1, r);
        }
        if (t0 > t1) {
            return false;
        }
    }
    const float ox = x0;
    const float oy = y0;
    x0 = ox + dx * t0;
    y0 = oy + dy * t0;
    x1 = ox + dx * t1;
    y1 = oy + dy * t1;
    return true;
}

void drawLine(ImageRGB& image, float x0, float y0, float x1, float y1,
              const Vec3& color, float alpha) {
    if (!clipSegment(x0, y0, x1, y1, 0.0f, 0.0f,
                     static_cast<float>(image.width - 1),
                     static_cast<float>(image.height - 1))) {
        return;
    }
    const float dx = x1 - x0;
    const float dy = y1 - y0;
    const int steps = std::max(1, static_cast<int>(
                                     std::ceil(std::max(std::fabs(dx),
                                                        std::fabs(dy)))));
    for (int i = 0; i <= steps; ++i) {
        const float t = static_cast<float>(i) / static_cast<float>(steps);
        const int px = static_cast<int>(std::lround(x0 + dx * t));
        const int py = static_cast<int>(std::lround(y0 + dy * t));
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) {
            continue;
        }
        image.at(px, py) = mix(image.at(px, py), color, alpha);
    }
}

void drawProjectedSegment(const Camera& camera, ImageRGB& image,
                          const Vec3& a, const Vec3& b, const Vec3& color,
                          float alpha) {
    float ax = 0.0f;
    float ay = 0.0f;
    float az = 0.0f;
    float bx = 0.0f;
    float by = 0.0f;
    float bz = 0.0f;
    projectPoint(camera, a, ax, ay, az);
    projectPoint(camera, b, bx, by, bz);
    if (az <= 0.0f || bz <= 0.0f) {
        return;
    }
    drawLine(image, ax, ay, bx, by, color, alpha);
}

AABB sceneBounds(const Scene& scene) {
    AABB bounds;
    for (const Triangle& tri : scene.triangles) {
        bounds.include(tri.a);
        bounds.include(tri.b);
        bounds.include(tri.c);
    }
    for (const SdfObject& object : scene.sdfs) {
        bounds.include(object.bounds);
    }
    return bounds;
}

void collectTriangleCutSegments(const Scene& scene,
                                std::vector<std::pair<Vec3, Vec3>>& segments) {
    const Vec3 n = scene.clip.normal;
    const float offset = scene.clip.offset;
    for (const Triangle& tri : scene.triangles) {
        const Vec3 vertices[3] = {tri.a, tri.b, tri.c};
        float d[3] = {dot(n, vertices[0]) - offset,
                      dot(n, vertices[1]) - offset,
                      dot(n, vertices[2]) - offset};
        Vec3 points[3];
        int count = 0;
        for (int edge = 0; edge < 3; ++edge) {
            const int next = (edge + 1) % 3;
            if ((d[edge] < 0.0f && d[next] > 0.0f) ||
                (d[edge] > 0.0f && d[next] < 0.0f)) {
                const float t = d[edge] / (d[edge] - d[next]);
                points[count++] = mix(vertices[edge], vertices[next], t);
            }
        }
        if (count == 2 && lengthSquared(points[0] - points[1]) > 1.0e-8f) {
            segments.emplace_back(points[0], points[1]);
        }
    }
}

void collectSdfCutSegments(
    const Scene& scene, std::vector<std::pair<Vec3, Vec3>>& segments,
    std::vector<std::pair<Vec3, Vec3>>& planeBoundary) {
    if (scene.sdfs.empty()) {
        return;
    }
    const AABB bounds = sceneBounds(scene);
    if (!bounds.valid()) {
        return;
    }
    const Vec3 n = scene.clip.normal;
    const Vec3 sceneCenter = bounds.center();
    const Vec3 planeCenter =
        sceneCenter - n * (dot(n, sceneCenter) - scene.clip.offset);
    Vec3 u;
    Vec3 v;
    basisFromNormal(n, u, v);

    float halfU = 0.0f;
    float halfV = 0.0f;
    for (int i = 0; i < 8; ++i) {
        const Vec3 corner{(i & 1) ? bounds.hi.x : bounds.lo.x,
                          (i & 2) ? bounds.hi.y : bounds.lo.y,
                          (i & 4) ? bounds.hi.z : bounds.lo.z};
        const Vec3 delta = corner - planeCenter;
        halfU = std::max(halfU, std::fabs(dot(delta, u)));
        halfV = std::max(halfV, std::fabs(dot(delta, v)));
    }
    halfU += 1.0f;
    halfV += 1.0f;
    constexpr int gridU = 112;
    constexpr int gridV = 88;
    std::vector<Vec3> points(static_cast<std::size_t>(gridU + 1) *
                             (gridV + 1));
    std::vector<float> values(points.size(), kInf);
    for (int iy = 0; iy <= gridV; ++iy) {
        for (int ix = 0; ix <= gridU; ++ix) {
            const float su = (2.0f * static_cast<float>(ix) /
                                  static_cast<float>(gridU) -
                              1.0f) * halfU;
            const float sv = (2.0f * static_cast<float>(iy) /
                                  static_cast<float>(gridV) -
                              1.0f) * halfV;
            const Vec3 p = planeCenter + u * su + v * sv;
            points[static_cast<std::size_t>(iy) * (gridU + 1) + ix] = p;
            float d = kInf;
            for (const SdfObject& object : scene.sdfs) {
                d = std::min(d, object.distance(p));
            }
            values[static_cast<std::size_t>(iy) * (gridU + 1) + ix] = d;
        }
    }

    auto valueAt = [&](int ix, int iy) {
        return values[static_cast<std::size_t>(iy) * (gridU + 1) + ix];
    };
    auto pointAt = [&](int ix, int iy) {
        return points[static_cast<std::size_t>(iy) * (gridU + 1) + ix];
    };
    auto edgePoint = [&](int ax, int ay, int bx, int by) {
        const float da = valueAt(ax, ay);
        const float db = valueAt(bx, by);
        const float t = da / (da - db);
        return mix(pointAt(ax, ay), pointAt(bx, by), clampf(t, 0.0f, 1.0f));
    };

    for (int iy = 0; iy < gridV; ++iy) {
        for (int ix = 0; ix < gridU; ++ix) {
            const float d00 = valueAt(ix, iy);
            const float d10 = valueAt(ix + 1, iy);
            const float d01 = valueAt(ix, iy + 1);
            const float d11 = valueAt(ix + 1, iy + 1);
            Vec3 edge[4];
            int count = 0;
            if ((d00 < 0.0f) != (d10 < 0.0f)) {
                edge[count++] = edgePoint(ix, iy, ix + 1, iy);
            }
            if ((d10 < 0.0f) != (d11 < 0.0f)) {
                edge[count++] = edgePoint(ix + 1, iy, ix + 1, iy + 1);
            }
            if ((d11 < 0.0f) != (d01 < 0.0f)) {
                edge[count++] = edgePoint(ix + 1, iy + 1, ix, iy + 1);
            }
            if ((d01 < 0.0f) != (d00 < 0.0f)) {
                edge[count++] = edgePoint(ix, iy + 1, ix, iy);
            }
            if (count == 2) {
                segments.emplace_back(edge[0], edge[1]);
            } else if (count == 4) {
                segments.emplace_back(edge[0], edge[1]);
                segments.emplace_back(edge[2], edge[3]);
            }
        }
    }

    const Vec3 corners[4] = {
        planeCenter + u * -halfU + v * -halfV,
        planeCenter + u * halfU + v * -halfV,
        planeCenter + u * halfU + v * halfV,
        planeCenter + u * -halfU + v * halfV};
    for (int i = 0; i < 4; ++i) {
        planeBoundary.emplace_back(corners[i], corners[(i + 1) % 4]);
    }
}

}  // namespace

ImageRGB buildCutPreview(const Scene& scene, const Camera& camera,
                         const RenderResult& render,
                         CutPreviewStats* stats) {
    ImageRGB image(render.width, render.height);
    for (int y = 0; y < render.height; ++y) {
        for (int x = 0; x < render.width; ++x) {
            const PixelRecord& pixel = render.at(x, y);
            const Vec3 base = pixel.hit
                                  ? toneMap(pixel.color * 0.40f)
                                  : toneMap(pixel.color * 0.30f);
            image.at(x, y) = mix(base, Vec3{0.015f, 0.025f, 0.038f}, 0.25f);
        }
    }
    if (!scene.clip.enabled) {
        return image;
    }

    std::vector<std::pair<Vec3, Vec3>> triangleSegments;
    std::vector<std::pair<Vec3, Vec3>> sdfSegments;
    std::vector<std::pair<Vec3, Vec3>> planeBoundary;
    collectTriangleCutSegments(scene, triangleSegments);
    collectSdfCutSegments(scene, sdfSegments, planeBoundary);
    if (stats != nullptr) {
        stats->triangleSegments = static_cast<int>(triangleSegments.size());
        stats->sdfSegments = static_cast<int>(sdfSegments.size());
    }

    for (const auto& segment : triangleSegments) {
        drawProjectedSegment(camera, image, segment.first, segment.second,
                             Vec3{1.0f, 0.30f, 0.035f}, 0.82f);
    }
    for (const auto& segment : sdfSegments) {
        drawProjectedSegment(camera, image, segment.first, segment.second,
                             Vec3{0.02f, 0.95f, 1.0f}, 0.90f);
    }
    for (const auto& segment : planeBoundary) {
        drawProjectedSegment(camera, image, segment.first, segment.second,
                             Vec3{0.92f, 0.15f, 0.95f}, 0.55f);
    }
    return image;
}

}  // namespace ocr
