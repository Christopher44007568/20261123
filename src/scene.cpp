#include "scene.hpp"

#include <algorithm>
#include <cmath>

namespace ds {
namespace {

Primitive makeBox(const Vec3& center, const Vec3& axisU, const Vec3& axisV,
                  const Vec3& axisW, const Vec3& halfExtents, MaterialKind kind,
                  const Material& material) {
    Primitive p;
    p.shape = ShapeKind::Box;
    p.kind = kind;
    p.material = material;
    p.center = center;
    p.axisU = normalize(axisU);
    p.axisV = normalize(axisV);
    p.axisW = normalize(axisW);
    p.halfExtents = halfExtents;
    return p;
}

Primitive makeSphere(const Vec3& center, float radius, MaterialKind kind,
                     const Material& material) {
    Primitive p;
    p.shape = ShapeKind::Sphere;
    p.kind = kind;
    p.material = material;
    p.center = center;
    p.radius = radius;
    return p;
}

Material wallMaterial() {
    Material m;
    m.albedo = {0.105f, 0.138f, 0.136f};
    m.reflectivity = 0.04f;
    return m;
}

Material glassMaterial(float tint) {
    Material m;
    m.albedo = {0.56f, 0.82f, 0.98f};
    m.surfaceTransmittance = tint;
    m.reflectivity = 0.18f;
    return m;
}

Material goldMaterial() {
    Material m;
    m.albedo = {0.86f, 0.58f, 0.20f};
    m.reflectivity = 0.72f;
    return m;
}

Material wireMaterial() {
    Material m;
    m.albedo = {0.28f, 0.22f, 0.13f};
    m.surfaceTransmittance = 0.035f;
    m.reflectivity = 0.45f;
    return m;
}

Material bulbMaterial() {
    Material m;
    m.albedo = {1.0f, 0.72f, 0.36f};
    m.emission = {3.2f, 1.30f, 0.42f};
    return m;
}

Material smokeMaterial(float sigma) {
    Material m;
    m.albedo = {0.46f, 0.58f, 0.72f};
    m.smokeSigma = sigma;
    return m;
}

}  // namespace

LightCamera Scene::lightCamera() const {
    LightCamera camera;
    camera.position = lightPosition;
    camera.target = lightTarget;
    camera.up = {0.0f, 1.0f, 0.0f};
    camera.verticalFov = degToRad(63.0f);
    camera.aspect = 1.0f;
    return camera;
}

Camera Scene::cameraForAngle(float angle) const {
    Camera camera;
    const float radius = 5.50f;
    const float orbitY = 2.95f + 0.06f * std::sin(angle * 1.7f);
    camera.position = {
        radius * std::sin(angle),
        orbitY,
        radius * std::cos(angle),
    };
    camera.target = {0.0f, 2.10f, 0.0f};
    camera.up = {0.0f, 1.0f, 0.0f};
    camera.verticalFov = degToRad(54.0f);
    return camera;
}

Scene Scene::makeTheater(float chandelierRotation, uint32_t frameSeed) {
    Scene scene;
    const Vec3 up{0.0f, 1.0f, 0.0f};
    const Material glass = glassMaterial(0.82f);
    const Material gold = goldMaterial();
    const Material wire = wireMaterial();
    const Material bulb = bulbMaterial();

    Primitive wall;
    wall.shape = ShapeKind::Quad;
    wall.kind = MaterialKind::Wall;
    wall.material = wallMaterial();
    wall.center = {0.0f, 2.20f, -7.20f};
    wall.axisU = {1.0f, 0.0f, 0.0f};
    wall.axisV = {0.0f, 1.0f, 0.0f};
    wall.axisW = {0.0f, 0.0f, 1.0f};
    wall.halfU = 10.0f;
    wall.halfV = 5.2f;
    wall.shadowCaster = false;
    scene.primitives.push_back(wall);

    Primitive leftWall;
    leftWall.shape = ShapeKind::Quad;
    leftWall.kind = MaterialKind::Wall;
    leftWall.material = wallMaterial();
    leftWall.center = {-9.5f, 2.20f, 0.5f};
    leftWall.axisU = {0.0f, 0.0f, 1.0f};
    leftWall.axisV = {0.0f, 1.0f, 0.0f};
    leftWall.axisW = {-1.0f, 0.0f, 0.0f};
    leftWall.halfU = 7.7f;
    leftWall.halfV = 5.2f;
    leftWall.shadowCaster = false;
    scene.primitives.push_back(leftWall);

    Primitive rightWall;
    rightWall.shape = ShapeKind::Quad;
    rightWall.kind = MaterialKind::Wall;
    rightWall.material = wallMaterial();
    rightWall.center = {9.5f, 2.20f, 0.5f};
    rightWall.axisU = {0.0f, 0.0f, 1.0f};
    rightWall.axisV = {0.0f, 1.0f, 0.0f};
    rightWall.axisW = {1.0f, 0.0f, 0.0f};
    rightWall.halfU = 7.7f;
    rightWall.halfV = 5.2f;
    rightWall.shadowCaster = false;
    scene.primitives.push_back(rightWall);

    Primitive frontWall;
    frontWall.shape = ShapeKind::Quad;
    frontWall.kind = MaterialKind::Wall;
    frontWall.material = wallMaterial();
    frontWall.center = {0.0f, 2.20f, 7.80f};
    frontWall.axisU = {1.0f, 0.0f, 0.0f};
    frontWall.axisV = {0.0f, 1.0f, 0.0f};
    frontWall.axisW = {0.0f, 0.0f, -1.0f};
    frontWall.halfU = 9.5f;
    frontWall.halfV = 5.2f;
    frontWall.shadowCaster = false;
    scene.primitives.push_back(frontWall);

    Primitive floor;
    floor.shape = ShapeKind::Quad;
    floor.kind = MaterialKind::Wall;
    floor.material.albedo = {0.055f, 0.070f, 0.075f};
    floor.center = {0.0f, -0.85f, 0.5f};
    floor.axisU = {1.0f, 0.0f, 0.0f};
    floor.axisV = {0.0f, 0.0f, 1.0f};
    floor.axisW = {0.0f, 1.0f, 0.0f};
    floor.halfU = 9.6f;
    floor.halfV = 7.4f;
    floor.shadowCaster = false;
    scene.primitives.push_back(floor);

    Primitive stem = makeBox({0.0f, 2.35f, 0.0f}, {1.0f, 0.0f, 0.0f}, up,
                             {0.0f, 0.0f, 1.0f}, {0.050f, 1.75f, 0.050f},
                             MaterialKind::Gold, gold);
    scene.primitives.push_back(stem);

    struct Tier {
        float y;
        float radius;
        int count;
        float phase;
        float length;
        float width;
        float tilt;
    };
    const Tier tiers[] = {
        {0.82f, 0.38f, 6, 0.00f, 0.62f, 0.145f, 0.92f},
        {1.55f, 0.82f, 9, 0.22f, 0.78f, 0.175f, 0.78f},
        {2.28f, 0.78f, 9, 0.00f, 0.76f, 0.168f, 0.68f},
        {3.00f, 0.62f, 8, 0.19f, 0.70f, 0.155f, 0.58f},
        {3.66f, 0.38f, 6, 0.34f, 0.54f, 0.132f, 0.48f},
    };

    int tierIndex = 0;
    for (const Tier& tier : tiers) {
        for (int shell = 0; shell < 2; ++shell) {
            const int bladeCount = tier.count + (shell == 0 ? 2 : 3);
            const float ringRadius = tier.radius * (1.0f - 0.41f * shell);
            const float bladeLength = tier.length * (shell == 0 ? 1.0f : 0.76f);
            const float bladeWidth = tier.width * (shell == 0 ? 1.15f : 0.92f);
            const float shellPhase =
                tier.phase + (shell == 0 ? 0.0f : kPi / bladeCount);
            const float bladeY = tier.y + (shell == 0 ? 0.0f : 0.035f);
            for (int j = 0; j < bladeCount; ++j) {
                const float theta =
                    chandelierRotation + shellPhase +
                    2.0f * kPi * static_cast<float>(j) /
                        static_cast<float>(bladeCount);
                const Vec3 radial{std::cos(theta), 0.0f, std::sin(theta)};
                const Vec3 tangent{-std::sin(theta), 0.0f, std::cos(theta)};
                const float tiltSign = ((j + tierIndex + shell) & 1) ? -1.0f : 1.0f;
                const Vec3 faceNormal = normalize(
                    radial * (tier.tilt * tiltSign) +
                    up * (1.0f - 0.18f * tier.tilt));
                const Vec3 widthAxis = normalize(cross(up, faceNormal));
                const Vec3 lengthAxis = normalize(cross(widthAxis, faceNormal));
                const Vec3 center = radial * ringRadius + up * bladeY;
                Primitive blade =
                    makeBox(center, widthAxis, lengthAxis, faceNormal,
                            {bladeWidth * 0.5f, bladeLength * 0.5f, 0.010f},
                            MaterialKind::Glass, glass);
                scene.primitives.push_back(blade);

                if (shell == 0) {
                    const Vec3 spokeStart = radial * 0.08f + up * bladeY;
                    const Vec3 spokeEnd =
                        radial * (ringRadius + bladeLength * 0.42f) +
                        up * bladeY;
                    const float spokeLength = length(spokeEnd - spokeStart);
                    Primitive spoke =
                        makeBox((spokeStart + spokeEnd) * 0.5f, radial, tangent,
                                up, {spokeLength * 0.5f, 0.0045f, 0.0045f},
                                MaterialKind::Wire, wire);
                    scene.primitives.push_back(spoke);
                }
            }
        }
        ++tierIndex;
    }

    for (int j = 0; j < 14; ++j) {
        const float theta =
            chandelierRotation + 2.0f * kPi * static_cast<float>(j) / 14.0f;
        const Vec3 radial =
            Vec3{std::cos(theta), 0.0f, std::sin(theta)} * 0.96f;
        const Vec3 top = radial + up * 3.75f;
        const Vec3 bottom = radial + up * 0.72f;
        const float halfLength = length(top - bottom) * 0.5f;
        Primitive chain = makeBox((top + bottom) * 0.5f, {1.0f, 0.0f, 0.0f},
                                  up, {0.0f, 0.0f, 1.0f},
                                  {0.0032f, halfLength, 0.0032f},
                                  MaterialKind::Wire, wire);
        scene.primitives.push_back(chain);
    }

    for (int j = 0; j < 12; ++j) {
        const float theta =
            chandelierRotation + 2.0f * kPi * (static_cast<float>(j) + 0.5f) / 12.0f;
        const Vec3 radial{std::cos(theta), 0.0f, std::sin(theta)};
        const Vec3 center = radial * 0.53f + up * (0.45f +
                            0.10f * std::sin(static_cast<float>(j) * 2.1f));
        scene.primitives.push_back(makeSphere(
            center, 0.045f + 0.010f * static_cast<float>(j % 3),
            MaterialKind::Glass, glass));
    }

    for (int j = 0; j < 9; ++j) {
        const float theta =
            chandelierRotation + 2.0f * kPi * static_cast<float>(j) / 9.0f + 0.14f;
        const Vec3 radial{std::cos(theta), 0.0f, std::sin(theta)};
        const Vec3 center = radial * 0.94f + up * (2.48f +
                            0.08f * static_cast<float>(j % 2));
        scene.primitives.push_back(
            makeSphere(center, 0.040f, MaterialKind::Bulb, bulb));
    }

    Primitive smokeA;
    smokeA.shape = ShapeKind::Box;
    smokeA.kind = MaterialKind::Smoke;
    smokeA.material = smokeMaterial(0.052f);
    smokeA.center = {0.18f, 2.18f, -0.48f};
    smokeA.halfExtents = {2.05f, 1.72f, 0.78f};
    scene.primitives.push_back(smokeA);

    Primitive smokeB;
    smokeB.shape = ShapeKind::Box;
    smokeB.kind = MaterialKind::Smoke;
    smokeB.material = smokeMaterial(0.075f);
    smokeB.center = {-0.45f, 1.60f, -1.30f};
    smokeB.halfExtents = {1.42f, 0.92f, 0.44f};
    scene.primitives.push_back(smokeB);

    const float seedJitter = 0.035f * hashToUnit(frameSeed + 17u);
    for (int j = 0; j < 7; ++j) {
        Primitive bead = makeSphere(
            {0.12f * std::cos(chandelierRotation + j) + seedJitter,
             0.55f + 0.47f * static_cast<float>(j),
             0.12f * std::sin(chandelierRotation + j)},
            0.026f, MaterialKind::Glass, glass);
        scene.primitives.push_back(bead);
    }
    return scene;
}

bool Scene::boxSegment(const Primitive& primitive, const Ray& ray, float tMin,
                       float tMax, float& t0, float& t1) const {
    const Vec3 rel = ray.origin - primitive.center;
    const Vec3 localOrigin{dot(rel, primitive.axisU), dot(rel, primitive.axisV),
                           dot(rel, primitive.axisW)};
    const Vec3 localDir{dot(ray.direction, primitive.axisU),
                        dot(ray.direction, primitive.axisV),
                        dot(ray.direction, primitive.axisW)};
    const float origins[3] = {localOrigin.x, localOrigin.y, localOrigin.z};
    const float dirs[3] = {localDir.x, localDir.y, localDir.z};
    const float halves[3] = {primitive.halfExtents.x, primitive.halfExtents.y,
                             primitive.halfExtents.z};

    t0 = tMin;
    t1 = tMax;
    for (int axis = 0; axis < 3; ++axis) {
        if (std::abs(dirs[axis]) < 1.0e-9f) {
            if (origins[axis] < -halves[axis] || origins[axis] > halves[axis]) {
                return false;
            }
            continue;
        }
        const float inv = 1.0f / dirs[axis];
        float nearT = (-halves[axis] - origins[axis]) * inv;
        float farT = (halves[axis] - origins[axis]) * inv;
        if (nearT > farT) {
            std::swap(nearT, farT);
        }
        t0 = std::max(t0, nearT);
        t1 = std::min(t1, farT);
        if (t0 > t1) {
            return false;
        }
    }
    return true;
}

bool Scene::intersectPrimitive(const Primitive& primitive, const Ray& ray,
                               float tMin, float tMax, float& t,
                               Vec3& normal) const {
    if (primitive.shape == ShapeKind::Box) {
        float t0 = 0.0f;
        float t1 = 0.0f;
        if (!boxSegment(primitive, ray, tMin, tMax, t0, t1)) {
            return false;
        }
        t = t0 >= tMin ? t0 : t1;
        if (t < tMin || t > tMax) {
            return false;
        }
        const Vec3 local = ray.at(t) - primitive.center;
        const float x = dot(local, primitive.axisU);
        const float y = dot(local, primitive.axisV);
        const float z = dot(local, primitive.axisW);
        const float ax = std::abs(x) - primitive.halfExtents.x;
        const float ay = std::abs(y) - primitive.halfExtents.y;
        const float az = std::abs(z) - primitive.halfExtents.z;
        if (ax >= ay && ax >= az) {
            normal = primitive.axisU * (x >= 0.0f ? 1.0f : -1.0f);
        } else if (ay >= az) {
            normal = primitive.axisV * (y >= 0.0f ? 1.0f : -1.0f);
        } else {
            normal = primitive.axisW * (z >= 0.0f ? 1.0f : -1.0f);
        }
        return true;
    }

    if (primitive.shape == ShapeKind::Sphere) {
        const Vec3 oc = ray.origin - primitive.center;
        const float a = dot(ray.direction, ray.direction);
        const float b = dot(oc, ray.direction);
        const float c = dot(oc, oc) - primitive.radius * primitive.radius;
        const float discrim = b * b - a * c;
        if (discrim < 0.0f) {
            return false;
        }
        const float root = std::sqrt(discrim);
        float nearT = (-b - root) / a;
        float farT = (-b + root) / a;
        if (nearT < tMin) {
            nearT = farT;
        }
        if (nearT < tMin || nearT > tMax) {
            return false;
        }
        t = nearT;
        normal = normalize(ray.at(t) - primitive.center);
        return true;
    }

    const float denom = dot(ray.direction, primitive.axisW);
    if (std::abs(denom) < 1.0e-8f) {
        return false;
    }
    const float planeT = dot(primitive.center - ray.origin, primitive.axisW) / denom;
    if (planeT < tMin || planeT > tMax) {
        return false;
    }
    const Vec3 point = ray.at(planeT);
    const Vec3 rel = point - primitive.center;
    if (std::abs(dot(rel, primitive.axisU)) > primitive.halfU ||
        std::abs(dot(rel, primitive.axisV)) > primitive.halfV) {
        return false;
    }
    t = planeT;
    normal = denom < 0.0f ? primitive.axisW : -primitive.axisW;
    return true;
}

bool Scene::intersectNearest(const Ray& ray, float tMin, float tMax,
                             SurfaceHit& hit) const {
    hit.t = tMax;
    bool found = false;
    for (int i = 0; i < static_cast<int>(primitives.size()); ++i) {
        const Primitive& primitive = primitives[static_cast<size_t>(i)];
        if (primitive.kind == MaterialKind::Smoke) {
            continue;
        }
        float t = 0.0f;
        Vec3 normal;
        if (intersectPrimitive(primitive, ray, tMin, hit.t, t, normal)) {
            found = true;
            hit.t = t;
            hit.point = ray.at(t);
            hit.geoNormal = normal;
            hit.normal = dot(normal, ray.direction) > 0.0f ? -normal : normal;
            hit.primitive = i;
            hit.kind = primitive.kind;
            hit.material = primitive.material;
        }
    }
    return found;
}

void Scene::collectEvents(const Ray& ray, float maxDepth, int smokeSamples,
                          std::vector<TransmittanceEvent>& events) const {
    events.clear();
    for (const Primitive& primitive : primitives) {
        if (primitive.kind == MaterialKind::Smoke) {
            if (smokeSamples <= 0) {
                continue;
            }
            float t0 = 0.0f;
            float t1 = 0.0f;
            if (!boxSegment(primitive, ray, 0.0f, maxDepth, t0, t1)) {
                continue;
            }
            t0 = std::max(t0, 0.0f);
            t1 = std::min(t1, maxDepth);
            const float segmentLength = t1 - t0;
            if (segmentLength <= 1.0e-6f) {
                continue;
            }
            const float step = segmentLength / static_cast<float>(smokeSamples);
            const float factor =
                std::exp(-primitive.material.smokeSigma * step);
            for (int s = 0; s < smokeSamples; ++s) {
                events.push_back({t0 + (static_cast<float>(s) + 0.5f) * step,
                                  factor, MaterialKind::Smoke});
            }
            continue;
        }
        if (!primitive.shadowCaster || primitive.kind == MaterialKind::Wall) {
            continue;
        }

        if (primitive.shape == ShapeKind::Box) {
            float t0 = 0.0f;
            float t1 = 0.0f;
            if (!boxSegment(primitive, ray, 0.0f, maxDepth, t0, t1)) {
                continue;
            }
            if (t0 > maxDepth || t1 < 0.0f) {
                continue;
            }
            if (primitive.kind == MaterialKind::Glass) {
                events.push_back(
                    {t0, primitive.material.surfaceTransmittance,
                     MaterialKind::Glass});
                if (t1 <= maxDepth) {
                    events.push_back(
                        {t1, primitive.material.surfaceTransmittance,
                         MaterialKind::Glass});
                }
            } else if (primitive.kind == MaterialKind::Wire) {
                events.push_back(
                    {t0, primitive.material.surfaceTransmittance,
                     MaterialKind::Wire});
                if (t1 <= maxDepth) {
                    events.push_back(
                        {t1, primitive.material.surfaceTransmittance,
                         MaterialKind::Wire});
                }
            } else {
                events.push_back({t0, 0.05f, primitive.kind});
            }
            continue;
        }

        if (primitive.shape == ShapeKind::Sphere) {
            const Vec3 oc = ray.origin - primitive.center;
            const float b = dot(oc, ray.direction);
            const float c = dot(oc, oc) - primitive.radius * primitive.radius;
            const float discrim = b * b - c;
            if (discrim < 0.0f) {
                continue;
            }
            const float root = std::sqrt(discrim);
            const float t0 = -b - root;
            const float t1 = -b + root;
            if (t1 < 0.0f || t0 > maxDepth) {
                continue;
            }
            if (primitive.kind == MaterialKind::Glass) {
                if (t0 >= 0.0f) {
                    events.push_back(
                        {t0, primitive.material.surfaceTransmittance,
                         MaterialKind::Glass});
                }
                if (t1 <= maxDepth) {
                    events.push_back(
                        {t1, primitive.material.surfaceTransmittance,
                         MaterialKind::Glass});
                }
            } else {
                events.push_back({std::max(t0, 0.0f), 0.04f, primitive.kind});
            }
        }
    }
    std::sort(events.begin(), events.end(),
              [](const TransmittanceEvent& a, const TransmittanceEvent& b) {
                  return a.depth < b.depth;
              });
}

float Scene::smokeOpticalDepth(const Ray& ray, float maxDepth) const {
    float opticalDepth = 0.0f;
    for (const Primitive& primitive : primitives) {
        if (primitive.kind != MaterialKind::Smoke) {
            continue;
        }
        float t0 = 0.0f;
        float t1 = 0.0f;
        if (!boxSegment(primitive, ray, 0.0f, maxDepth, t0, t1)) {
            continue;
        }
        t0 = std::max(t0, 0.0f);
        t1 = std::min(t1, maxDepth);
        if (t1 > t0) {
            opticalDepth += primitive.material.smokeSigma * (t1 - t0);
        }
    }
    return opticalDepth;
}

float Scene::smokeTransmittance(const Ray& ray, float maxDepth,
                                int samples) const {
    if (samples <= 0) {
        return std::exp(-smokeOpticalDepth(ray, maxDepth));
    }
    float transmittance = 1.0f;
    for (const Primitive& primitive : primitives) {
        if (primitive.kind != MaterialKind::Smoke) {
            continue;
        }
        float t0 = 0.0f;
        float t1 = 0.0f;
        if (!boxSegment(primitive, ray, 0.0f, maxDepth, t0, t1)) {
            continue;
        }
        t0 = std::max(t0, 0.0f);
        t1 = std::min(t1, maxDepth);
        if (t1 > t0) {
            transmittance *= std::exp(
                -primitive.material.smokeSigma * (t1 - t0));
        }
    }
    return transmittance;
}

ShadowRayResult Scene::traceToLight(const Vec3& point, bool analyticSmoke) const {
    ShadowRayResult result;
    const Vec3 delta = lightPosition - point;
    const float distance = length(delta);
    if (distance <= 1.0e-5f) {
        return result;
    }
    const Ray ray{point, delta / distance};
    std::vector<TransmittanceEvent> events;
    collectEvents(ray, distance, analyticSmoke ? 0 : 12, events);
    for (const TransmittanceEvent& event : events) {
        result.transmittance *= event.factor;
        if (event.kind == MaterialKind::Glass) {
            result.hitGlass = true;
            ++result.glassSurfaces;
        } else if (event.kind == MaterialKind::Wire) {
            result.hitWire = true;
            ++result.wireSurfaces;
        }
    }
    if (analyticSmoke) {
        result.transmittance *= std::exp(-smokeOpticalDepth(ray, distance));
    }
    if (result.transmittance < 0.0f) {
        result.transmittance = 0.0f;
    }
    return result;
}

float Scene::spotAttenuation(const Vec3& point) const {
    const Vec3 toPoint = point - lightPosition;
    const float distanceSq = std::max(lengthSq(toPoint), 1.0e-4f);
    const Vec3 axis = normalize(lightTarget - lightPosition);
    const float cosine = dot(toPoint / std::sqrt(distanceSq), axis);
    const float cone = smoothstep(spotOuterCos, spotInnerCos, cosine);
    return lightIntensity * cone / distanceSq;
}

}  // namespace ds
