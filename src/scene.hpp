#pragma once

#include "math.hpp"

#include <cstdint>
#include <vector>

namespace ds {

enum class ShapeKind : uint8_t { Box, Sphere, Quad };
enum class MaterialKind : uint8_t { Wall, Glass, Gold, Wire, Bulb, Smoke };

struct Material {
    Vec3 albedo{0.5f, 0.5f, 0.5f};
    Vec3 emission{0.0f, 0.0f, 0.0f};
    float surfaceTransmittance = 0.0f;
    float reflectivity = 0.0f;
    float smokeSigma = 0.0f;
};

struct Primitive {
    ShapeKind shape = ShapeKind::Box;
    MaterialKind kind = MaterialKind::Wall;
    Material material;
    Vec3 center;
    Vec3 axisU{1.0f, 0.0f, 0.0f};
    Vec3 axisV{0.0f, 1.0f, 0.0f};
    Vec3 axisW{0.0f, 0.0f, 1.0f};
    Vec3 halfExtents{1.0f, 1.0f, 1.0f};
    float radius = 1.0f;
    float halfU = 1.0f;
    float halfV = 1.0f;
    bool shadowCaster = true;
};

struct SurfaceHit {
    float t = kInf;
    Vec3 point;
    Vec3 normal;
    Vec3 geoNormal;
    int primitive = -1;
    MaterialKind kind = MaterialKind::Wall;
    Material material;
};

struct TransmittanceEvent {
    float depth = 0.0f;
    float factor = 1.0f;
    MaterialKind kind = MaterialKind::Wall;
};

struct ShadowRayResult {
    float transmittance = 1.0f;
    bool hitWire = false;
    bool hitGlass = false;
    int glassSurfaces = 0;
    int wireSurfaces = 0;
};

struct SmokeSample {
    float depth = 0.0f;
    float factor = 1.0f;
};

class Scene {
public:
    std::vector<Primitive> primitives;
    Vec3 lightPosition{3.1f, 5.8f, 4.6f};
    Vec3 lightTarget{-0.15f, 1.85f, -3.25f};
    Vec3 lightColor{1.0f, 0.84f, 0.62f};
    float lightIntensity = 14.0f;
    float spotOuterCos = std::cos(degToRad(39.0f));
    float spotInnerCos = std::cos(degToRad(31.0f));

    static Scene makeTheater(float chandelierRotation, uint32_t frameSeed = 0);

    LightCamera lightCamera() const;
    Camera cameraForAngle(float angle) const;

    bool intersectNearest(const Ray& ray, float tMin, float tMax,
                          SurfaceHit& hit) const;
    void collectEvents(const Ray& ray, float maxDepth, int smokeSamples,
                       std::vector<TransmittanceEvent>& events) const;
    ShadowRayResult traceToLight(const Vec3& point, bool analyticSmoke = true) const;
    float smokeTransmittance(const Ray& ray, float maxDepth,
                             int samples) const;
    float smokeOpticalDepth(const Ray& ray, float maxDepth) const;
    float spotAttenuation(const Vec3& point) const;

private:
    bool intersectPrimitive(const Primitive& primitive, const Ray& ray,
                            float tMin, float tMax, float& t,
                            Vec3& normal) const;
    bool boxSegment(const Primitive& primitive, const Ray& ray, float tMin,
                    float tMax, float& t0, float& t1) const;
};

}  // namespace ds
