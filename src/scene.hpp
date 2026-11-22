#pragma once

#include "math.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace ocr {

struct Material {
    int id = 0;
    std::string name;
    Vec3 albedo{0.5f, 0.5f, 0.5f};
    float metallic = 0.0f;
    float roughness = 0.6f;
    float reflectivity = 0.08f;
    float emissive = 0.0f;
};

struct Triangle {
    Vec3 a;
    Vec3 b;
    Vec3 c;
    Vec3 na;
    Vec3 nb;
    Vec3 nc;
    int material = 0;
    int objectId = -1;
};

enum class SdfKind {
    RoundedBox,
    Ellipsoid,
    PolyCapsule
};

struct SdfObject {
    int objectId = -1;
    int material = 0;
    SdfKind kind = SdfKind::RoundedBox;
    AABB bounds;

    Vec3 center;
    Vec3 halfExtent;
    Vec3 radii;
    float radius = 0.1f;
    Vec3 a;
    Vec3 b;
    std::vector<Vec3> points;

    float distance(const Vec3& p) const;
    Vec3 normalAt(const Vec3& p) const;
    bool intersect(const Ray& ray, float tMin, float tMax,
                   float& tHit) const;
};

struct Hit {
    bool hit = false;
    float t = kInf;
    Vec3 p;
    Vec3 n;
    Vec3 geometricN;
    int material = 0;
    int objectId = -1;
    int primitiveId = -1;
    bool isSdf = false;
};

struct TraceInfo {
    int clipRejections = 0;
    bool continuedAfterClip = false;
};

struct PointLight {
    Vec3 position;
    Vec3 color{1.0f, 0.82f, 0.58f};
    float intensity = 1.0f;
};

struct BvhNode {
    AABB box;
    int left = -1;
    int right = -1;
    int start = 0;
    int count = 0;
};

class Scene {
public:
    std::vector<Material> materials;
    std::vector<Triangle> triangles;
    std::vector<SdfObject> sdfs;
    std::vector<PointLight> pointLights;
    std::vector<BvhNode> nodes;
    std::vector<int> triangleOrder;
    ClipPlane clip;

    void addMaterial(const Material& material);
    void addTriangle(const Vec3& a, const Vec3& b, const Vec3& c,
                     int material, int objectId);
    void addQuad(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d,
                 int material, int objectId);
    void addBox(const Vec3& lo, const Vec3& hi, int material, int objectId);
    void addBeam(const Vec3& a, const Vec3& b, float width,
                 int material, int objectId);
    void addSdf(SdfObject object);
    void addPointLight(const PointLight& light);
    void build();

    Hit intersect(const Ray& ray, bool useBvh,
                  TraceInfo* info = nullptr) const;
    bool occluded(const Ray& ray, float maxDistance, bool useBvh) const;
    const Material& material(int id) const;

    int triangleCountForValidation() const {
        return static_cast<int>(triangles.size());
    }

private:
    Hit firstCandidate(const Ray& ray, float tMin, bool useBvh) const;
    Hit intersectTrianglesBrute(const Ray& ray, float tMin) const;
    Hit intersectBvh(const Ray& ray, float tMin) const;
    void intersectNode(int nodeIndex, const Ray& ray, float tMin,
                       Hit& best) const;
    int buildNode(int start, int count);
};

Scene makeOffshoreScene();

// Stable, luminous palette used only by the material-ID preview channel.
Vec3 materialPreviewColor(int materialId);

}  // namespace ocr
