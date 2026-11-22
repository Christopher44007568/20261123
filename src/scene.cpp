#include "scene.hpp"

#include <algorithm>
#include <cmath>
#include <functional>
#include <numeric>

namespace ocr {
namespace {

bool intersectTriangle(const Triangle& tri, const Ray& ray, float tMin,
                       float tMax, float& tHit, Vec3& bary) {
    const Vec3 edge1 = tri.b - tri.a;
    const Vec3 edge2 = tri.c - tri.a;
    const Vec3 pvec = cross(ray.direction, edge2);
    const float det = dot(edge1, pvec);
    if (std::fabs(det) < 1.0e-8f) {
        return false;
    }
    const float invDet = 1.0f / det;
    const Vec3 tvec = ray.origin - tri.a;
    const float u = dot(tvec, pvec) * invDet;
    if (u < -1.0e-5f || u > 1.0f + 1.0e-5f) {
        return false;
    }
    const Vec3 qvec = cross(tvec, edge1);
    const float v = dot(ray.direction, qvec) * invDet;
    if (v < -1.0e-5f || u + v > 1.0f + 1.0e-5f) {
        return false;
    }
    const float t = dot(edge2, qvec) * invDet;
    if (t <= tMin || t >= tMax) {
        return false;
    }
    tHit = t;
    bary = {1.0f - u - v, u, v};
    return true;
}

float hitTieEpsilon(float t) {
    return 2.0e-5f * (1.0f + std::fabs(t));
}

bool preferredHit(float t, bool isSdf, int primitiveId, const Hit& best) {
    if (!best.hit) {
        return true;
    }
    const float epsilon = hitTieEpsilon(std::min(t, best.t));
    if (t < best.t - epsilon) {
        return true;
    }
    if (t > best.t + epsilon) {
        return false;
    }
    // Coplanar and near-coplanar surfaces are common on the platform.
    // Resolve ties by kind and primitive index, never by traversal order.
    if (isSdf != best.isSdf) {
        return !isSdf;
    }
    return primitiveId < best.primitiveId;
}

float sdRoundedBox(const Vec3& p, const Vec3& c, const Vec3& half,
                   float radius) {
    const Vec3 qv = Vec3{std::fabs(p.x - c.x), std::fabs(p.y - c.y),
                         std::fabs(p.z - c.z)} - half;
    const Vec3 outside{std::max(qv.x, 0.0f), std::max(qv.y, 0.0f),
                       std::max(qv.z, 0.0f)};
    return length(outside) +
           std::min(std::max(qv.x, std::max(qv.y, qv.z)), 0.0f) - radius;
}

float sdEllipsoid(const Vec3& p, const Vec3& c, const Vec3& radii) {
    const Vec3 q = (p - c) / radii;
    const float k0 = length(q);
    if (k0 < 1.0e-8f) {
        return -std::min(radii.x, std::min(radii.y, radii.z));
    }
    const Vec3 q2 = q / radii;
    const float k1 = length(q2);
    return k1 > 1.0e-8f ? k0 * (k0 - 1.0f) / k1 : -1.0e-4f;
}

float sdCapsule(const Vec3& p, const Vec3& a, const Vec3& b, float radius) {
    const Vec3 pa = p - a;
    const Vec3 ba = b - a;
    const float denom = std::max(dot(ba, ba), 1.0e-10f);
    const float h = clampf(dot(pa, ba) / denom, 0.0f, 1.0f);
    return length(pa - ba * h) - radius;
}

float rayAt(const Ray& ray, float t, int axis) {
    return ray.origin[axis] + ray.direction[axis] * t;
}

}  // namespace

float SdfObject::distance(const Vec3& p) const {
    switch (kind) {
        case SdfKind::RoundedBox:
            return sdRoundedBox(p, center, halfExtent, radius);
        case SdfKind::Ellipsoid:
            return sdEllipsoid(p, center, radii);
        case SdfKind::PolyCapsule: {
            float best = kInf;
            if (points.size() == 1) {
                return length(p - points.front()) - radius;
            }
            for (std::size_t i = 1; i < points.size(); ++i) {
                best = std::min(best, sdCapsule(p, points[i - 1],
                                                points[i], radius));
            }
            return best;
        }
    }
    return kInf;
}

Vec3 SdfObject::normalAt(const Vec3& p) const {
    const float e = 0.004f;
    const Vec3 dx{e, 0.0f, 0.0f};
    const Vec3 dy{0.0f, e, 0.0f};
    const Vec3 dz{0.0f, 0.0f, e};
    const Vec3 gradient{
        distance(p + dx) - distance(p - dx),
        distance(p + dy) - distance(p - dy),
        distance(p + dz) - distance(p - dz)};
    return normalize(gradient);
}

bool SdfObject::intersect(const Ray& ray, float tMin, float tMax,
                          float& tHit) const {
    if (!bounds.valid()) {
        return false;
    }
    float boxEnter = 0.0f;
    if (!bounds.intersects(ray, tMin, tMax, boxEnter)) {
        return false;
    }
    float t = std::max(tMin, boxEnter) + 2.0e-4f;
    float prev = distance({rayAt(ray, t, 0), rayAt(ray, t, 1),
                           rayAt(ray, t, 2)});
    if (std::fabs(prev) <= 2.0e-4f) {
        tHit = t;
        return true;
    }

    for (int iteration = 0; iteration < 768; ++iteration) {
        const float step = clampf(std::fabs(prev) * 0.72f, 0.006f, 0.55f);
        const float nextT = t + step;
        if (nextT > tMax) {
            return false;
        }
        const Vec3 nextP{rayAt(ray, nextT, 0), rayAt(ray, nextT, 1),
                         rayAt(ray, nextT, 2)};
        const float next = distance(nextP);
        if (std::fabs(next) <= 5.0e-5f) {
            tHit = nextT;
            return true;
        }
        if ((prev < 0.0f && next > 0.0f) ||
            (prev > 0.0f && next < 0.0f)) {
            float lo = t;
            float hi = nextT;
            float flo = prev;
            for (int binary = 0; binary < 32; ++binary) {
                const float mid = 0.5f * (lo + hi);
                const Vec3 midP{rayAt(ray, mid, 0), rayAt(ray, mid, 1),
                                rayAt(ray, mid, 2)};
                const float fm = distance(midP);
                if ((flo < 0.0f && fm > 0.0f) ||
                    (flo > 0.0f && fm < 0.0f)) {
                    hi = mid;
                } else {
                    lo = mid;
                    flo = fm;
                }
            }
            tHit = 0.5f * (lo + hi);
            return true;
        }
        t = nextT;
        prev = next;
    }
    return false;
}

void Scene::addMaterial(const Material& material) {
    materials.push_back(material);
}

void Scene::addTriangle(const Vec3& a, const Vec3& b, const Vec3& c,
                        int material, int objectId) {
    Vec3 n = normalize(cross(b - a, c - a));
    if (!std::isfinite(n.x) || !std::isfinite(n.y) || !std::isfinite(n.z)) {
        n = {0.0f, 1.0f, 0.0f};
    }
    triangles.push_back({a, b, c, n, n, n, material, objectId});
}

void Scene::addQuad(const Vec3& a, const Vec3& b, const Vec3& c,
                    const Vec3& d, int material, int objectId) {
    addTriangle(a, b, c, material, objectId);
    addTriangle(a, c, d, material, objectId);
}

void Scene::addBox(const Vec3& lo, const Vec3& hi, int material,
                   int objectId) {
    const Vec3 p000{lo.x, lo.y, lo.z};
    const Vec3 p100{hi.x, lo.y, lo.z};
    const Vec3 p110{hi.x, hi.y, lo.z};
    const Vec3 p010{lo.x, hi.y, lo.z};
    const Vec3 p001{lo.x, lo.y, hi.z};
    const Vec3 p101{hi.x, lo.y, hi.z};
    const Vec3 p111{hi.x, hi.y, hi.z};
    const Vec3 p011{lo.x, hi.y, hi.z};

    addQuad(p000, p010, p110, p100, material, objectId);
    addQuad(p001, p101, p111, p011, material, objectId);
    addQuad(p000, p001, p011, p010, material, objectId);
    addQuad(p100, p110, p111, p101, material, objectId);
    addQuad(p000, p100, p101, p001, material, objectId);
    addQuad(p010, p011, p111, p110, material, objectId);
}

void Scene::addBeam(const Vec3& a, const Vec3& b, float width,
                    int material, int objectId) {
    const Vec3 axis = normalize(b - a);
    Vec3 helper{0.0f, 1.0f, 0.0f};
    if (std::fabs(dot(axis, helper)) > 0.94f) {
        helper = {1.0f, 0.0f, 0.0f};
    }
    const Vec3 u = normalize(cross(axis, helper)) * (width * 0.5f);
    const Vec3 v = normalize(cross(axis, u)) * (width * 0.5f);
    const Vec3 corners[4] = {a - u - v, a + u - v, a + u + v, a - u + v};
    const Vec3 farCorners[4] = {b - u - v, b + u - v, b + u + v, b - u + v};
    for (int i = 0; i < 4; ++i) {
        const int j = (i + 1) % 4;
        addQuad(corners[i], farCorners[i], farCorners[j], corners[j],
                material, objectId);
    }
    addQuad(corners[0], corners[1], corners[2], corners[3],
            material, objectId);
    addQuad(farCorners[0], farCorners[3], farCorners[2], farCorners[1],
            material, objectId);
}

void Scene::addSdf(SdfObject object) {
    sdfs.push_back(std::move(object));
}

void Scene::addPointLight(const PointLight& light) {
    pointLights.push_back(light);
}

void Scene::build() {
    triangleOrder.resize(triangles.size());
    std::iota(triangleOrder.begin(), triangleOrder.end(), 0);
    nodes.clear();
    if (!triangles.empty()) {
        nodes.reserve(triangles.size() * 2);
        buildNode(0, static_cast<int>(triangles.size()));
    }
}

int Scene::buildNode(int start, int count) {
    const int nodeIndex = static_cast<int>(nodes.size());
    nodes.push_back({});

    AABB box;
    AABB centroidBox;
    for (int i = start; i < start + count; ++i) {
        const Triangle& tri = triangles[triangleOrder[i]];
        box.include(tri.a);
        box.include(tri.b);
        box.include(tri.c);
        const Vec3 centroid = (tri.a + tri.b + tri.c) / 3.0f;
        centroidBox.include(centroid);
    }

    BvhNode& node = nodes[nodeIndex];
    node.box = box;
    if (count <= 4) {
        node.start = start;
        node.count = count;
        return nodeIndex;
    }

    const Vec3 extent = centroidBox.extent();
    int axis = 0;
    if (extent.y > extent.x && extent.y >= extent.z) {
        axis = 1;
    } else if (extent.z > extent.x && extent.z > extent.y) {
        axis = 2;
    }
    const int mid = start + count / 2;
    std::nth_element(triangleOrder.begin() + start,
                     triangleOrder.begin() + mid,
                     triangleOrder.begin() + start + count,
                     [&](int lhs, int rhs) {
                         const Triangle& a = triangles[lhs];
                         const Triangle& b = triangles[rhs];
                         const float ca =
                             (a.a[axis] + a.b[axis] + a.c[axis]) / 3.0f;
                         const float cb =
                             (b.a[axis] + b.b[axis] + b.c[axis]) / 3.0f;
                         return ca < cb || (ca == cb && lhs < rhs);
                     });
    const int left = buildNode(start, mid - start);
    const int right = buildNode(mid, start + count - mid);
    nodes[nodeIndex].left = left;
    nodes[nodeIndex].right = right;
    nodes[nodeIndex].count = 0;
    return nodeIndex;
}

Hit Scene::intersectTrianglesBrute(const Ray& ray, float tMin) const {
    Hit best;
    for (std::size_t i = 0; i < triangles.size(); ++i) {
        float t = 0.0f;
        Vec3 bary;
        const float tMax = best.hit ? best.t + hitTieEpsilon(best.t) : kInf;
        if (intersectTriangle(triangles[i], ray, tMin, tMax, t, bary) &&
            preferredHit(t, false, static_cast<int>(i), best)) {
            const Triangle& tri = triangles[i];
            const Vec3 p = ray.origin + ray.direction * t;
            Vec3 n = normalize(tri.na * bary.x + tri.nb * bary.y +
                               tri.nc * bary.z);
            if (dot(n, ray.direction) > 0.0f) {
                n = -n;
            }
            best.hit = true;
            best.t = t;
            best.p = p;
            best.n = n;
            best.geometricN = n;
            best.material = tri.material;
            best.objectId = tri.objectId;
            best.primitiveId = static_cast<int>(i);
            best.isSdf = false;
        }
    }
    return best;
}

void Scene::intersectNode(int nodeIndex, const Ray& ray, float tMin,
                          Hit& best) const {
    const BvhNode& node = nodes[nodeIndex];
    float boxHit = 0.0f;
    const float nodeTMax =
        best.hit ? best.t + hitTieEpsilon(best.t) : kInf;
    if (!node.box.intersects(ray, tMin, nodeTMax, boxHit)) {
        return;
    }
    if (node.left < 0) {
        for (int i = node.start; i < node.start + node.count; ++i) {
            const int triIndex = triangleOrder[i];
            const Triangle& tri = triangles[triIndex];
            float t = 0.0f;
            Vec3 bary;
            const float tMax =
                best.hit ? best.t + hitTieEpsilon(best.t) : kInf;
            if (intersectTriangle(tri, ray, tMin, tMax, t, bary) &&
                preferredHit(t, false, triIndex, best)) {
                const Vec3 p = ray.origin + ray.direction * t;
                Vec3 n = normalize(tri.na * bary.x + tri.nb * bary.y +
                                   tri.nc * bary.z);
                if (dot(n, ray.direction) > 0.0f) {
                    n = -n;
                }
                best.hit = true;
                best.t = t;
                best.p = p;
                best.n = n;
                best.geometricN = n;
                best.material = tri.material;
                best.objectId = tri.objectId;
                best.primitiveId = triIndex;
                best.isSdf = false;
            }
        }
        return;
    }

    float leftHit = 0.0f;
    float rightHit = 0.0f;
    const float childTMax =
        best.hit ? best.t + hitTieEpsilon(best.t) : kInf;
    const bool hitLeft =
        nodes[node.left].box.intersects(ray, tMin, childTMax, leftHit);
    const bool hitRight =
        nodes[node.right].box.intersects(ray, tMin, childTMax, rightHit);
    if (hitLeft && hitRight) {
        if (leftHit <= rightHit) {
            intersectNode(node.left, ray, tMin, best);
            intersectNode(node.right, ray, tMin, best);
        } else {
            intersectNode(node.right, ray, tMin, best);
            intersectNode(node.left, ray, tMin, best);
        }
    } else if (hitLeft) {
        intersectNode(node.left, ray, tMin, best);
    } else if (hitRight) {
        intersectNode(node.right, ray, tMin, best);
    }
}

Hit Scene::intersectBvh(const Ray& ray, float tMin) const {
    Hit best;
    if (!nodes.empty()) {
        intersectNode(0, ray, tMin, best);
    }
    return best;
}

Hit Scene::firstCandidate(const Ray& ray, float tMin, bool useBvh) const {
    Hit best = useBvh ? intersectBvh(ray, tMin)
                      : intersectTrianglesBrute(ray, tMin);

    for (std::size_t i = 0; i < sdfs.size(); ++i) {
        const SdfObject& object = sdfs[i];
        float t = 0.0f;
        const float tMax = best.hit ? best.t + hitTieEpsilon(best.t) : kInf;
        if (!object.intersect(ray, tMin, tMax, t)) {
            continue;
        }
        if (!preferredHit(t, true, static_cast<int>(i), best)) {
            continue;
        }
        const Vec3 p = ray.origin + ray.direction * t;
        Vec3 n = object.normalAt(p);
        if (dot(n, ray.direction) > 0.0f) {
            n = -n;
        }
        best.hit = true;
        best.t = t;
        best.p = p;
        best.n = n;
        best.geometricN = n;
        best.material = object.material;
        best.objectId = object.objectId;
        best.primitiveId = static_cast<int>(i);
        best.isSdf = true;
    }
    return best;
}

Hit Scene::intersect(const Ray& ray, bool useBvh, TraceInfo* info) const {
    float tMin = 2.0e-4f;
    for (int attempt = 0; attempt < 512; ++attempt) {
        Hit candidate = firstCandidate(ray, tMin, useBvh);
        if (!candidate.hit) {
            return {};
        }
        if (clip.kept(candidate.p)) {
            if (info != nullptr && info->clipRejections > 0) {
                info->continuedAfterClip = true;
            }
            return candidate;
        }
        if (info != nullptr) {
            ++info->clipRejections;
        }
        // The clipping plane filters completed hits only. Advancing tMin lets
        // the same BVH/SDF structures reveal the next surface behind a
        // removed one without rebuilding geometry or disturbing hit order.
        tMin = candidate.t + std::max(2.0e-4f, candidate.t * 1.0e-5f);
    }
    return {};
}

bool Scene::occluded(const Ray& ray, float maxDistance, bool useBvh) const {
    const Hit hit = intersect(ray, useBvh);
    return hit.hit && hit.t < maxDistance;
}

const Material& Scene::material(int id) const {
    static const Material fallback{0, "unknown", {0.8f, 0.0f, 0.8f}};
    for (const Material& m : materials) {
        if (m.id == id) {
            return m;
        }
    }
    return fallback;
}

Vec3 materialPreviewColor(int materialId) {
    if (materialId == 0) {
        return {0.018f, 0.022f, 0.03f};
    }
    const float hue = std::fmod(static_cast<float>(materialId) * 0.6180339f +
                                    0.11f, 1.0f);
    const float saturation = 0.68f;
    const float value = 0.96f;
    const float sector = hue * 6.0f;
    const int i = static_cast<int>(std::floor(sector)) % 6;
    const float f = sector - std::floor(sector);
    const float p = value * (1.0f - saturation);
    const float q = value * (1.0f - f * saturation);
    const float t = value * (1.0f - (1.0f - f) * saturation);
    switch (i) {
        case 0: return {value, t, p};
        case 1: return {q, value, p};
        case 2: return {p, value, t};
        case 3: return {p, q, value};
        case 4: return {t, p, value};
        default: return {value, p, q};
    }
}

namespace {

void addMaterials(Scene& scene) {
    scene.addMaterial({1, "platform_deck", {0.24f, 0.30f, 0.33f},
                       0.55f, 0.38f, 0.20f});
    scene.addMaterial({2, "structural_steel", {0.11f, 0.15f, 0.17f},
                       0.72f, 0.30f, 0.16f});
    scene.addMaterial({3, "safety_yellow", {0.86f, 0.52f, 0.035f},
                       0.30f, 0.48f, 0.14f});
    scene.addMaterial({4, "transformer_cladding", {0.50f, 0.59f, 0.63f},
                       0.58f, 0.38f, 0.23f});
    scene.addMaterial({5, "transformer_tank", {0.48f, 0.215f, 0.065f},
                       0.64f, 0.35f, 0.28f});
    scene.addMaterial({6, "glass", {0.16f, 0.43f, 0.52f},
                       0.08f, 0.075f, 0.72f});
    scene.addMaterial({7, "corridor_floor", {0.53f, 0.43f, 0.28f},
                       0.12f, 0.52f, 0.10f});
    scene.addMaterial({8, "cable_tray", {0.47f, 0.53f, 0.55f},
                       0.78f, 0.28f, 0.24f});
    scene.addMaterial({9, "cable_black", {0.022f, 0.028f, 0.030f},
                       0.05f, 0.56f, 0.08f});
    scene.addMaterial({10, "seawater", {0.018f, 0.25f, 0.34f},
                       0.12f, 0.10f, 0.62f});
    scene.addMaterial({11, "concrete", {0.34f, 0.33f, 0.29f},
                       0.02f, 0.82f, 0.035f});
    scene.addMaterial({12, "control_module", {0.68f, 0.70f, 0.65f},
                       0.32f, 0.48f, 0.15f});
    scene.addMaterial({13, "curved_glass", {0.10f, 0.48f, 0.60f},
                       0.12f, 0.055f, 0.80f});
    scene.addMaterial({14, "cable_red", {0.58f, 0.045f, 0.025f},
                       0.02f, 0.50f, 0.07f});
    scene.addMaterial({15, "cable_orange", {0.88f, 0.31f, 0.025f},
                       0.02f, 0.48f, 0.07f});
    scene.addMaterial({16, "cable_blue", {0.025f, 0.13f, 0.48f},
                       0.02f, 0.50f, 0.07f});
    scene.addMaterial({17, "seabed", {0.12f, 0.15f, 0.13f},
                       0.0f, 0.96f, 0.01f});
    scene.addMaterial({18, "interior_light", {1.0f, 0.78f, 0.46f},
                       0.0f, 0.52f, 0.04f, 5.0f});
    scene.addMaterial({19, "railing", {0.78f, 0.60f, 0.13f},
                       0.54f, 0.27f, 0.28f});
    scene.addMaterial({20, "interior_equipment", {0.055f, 0.065f, 0.072f},
                       0.45f, 0.34f, 0.16f});
    scene.addMaterial({21, "walkway_grating", {0.20f, 0.235f, 0.225f},
                       0.38f, 0.63f, 0.09f});
    scene.addMaterial({22, "foam_marks", {0.72f, 0.84f, 0.84f},
                       0.0f, 0.70f, 0.03f});
}

AABB sdfBounds(const Vec3& center, const Vec3& totalHalf) {
    AABB box;
    box.include(center - totalHalf);
    box.include(center + totalHalf);
    return box;
}

AABB polylineBounds(const std::vector<Vec3>& points, float radius) {
    AABB box;
    for (const Vec3& p : points) {
        box.include(p - Vec3{radius, radius, radius});
        box.include(p + Vec3{radius, radius, radius});
    }
    return box;
}

void addWater(Scene& scene) {
    const int cellsX = 28;
    const int cellsZ = 22;
    const float x0 = -36.0f;
    const float x1 = 36.0f;
    const float z0 = -30.0f;
    const float z1 = 30.0f;
    auto wave = [](float x, float z) {
        return -0.10f + 0.075f * std::sin(x * 0.26f + z * 0.11f) *
                            std::cos(z * 0.31f - x * 0.04f);
    };
    auto point = [&](int ix, int iz) {
        const float x = lerpf(x0, x1, ix / static_cast<float>(cellsX));
        const float z = lerpf(z0, z1, iz / static_cast<float>(cellsZ));
        return Vec3{x, wave(x, z), z};
    };
    for (int iz = 0; iz < cellsZ; ++iz) {
        for (int ix = 0; ix < cellsX; ++ix) {
            const Vec3 p00 = point(ix, iz);
            const Vec3 p10 = point(ix + 1, iz);
            const Vec3 p01 = point(ix, iz + 1);
            const Vec3 p11 = point(ix + 1, iz + 1);
            scene.addQuad(p00, p01, p11, p10, 10, 12);
        }
    }
    scene.addBox({-38.0f, -5.5f, -32.0f},
                 {38.0f, -4.9f, 32.0f}, 17, 13);
}

void addPlatform(Scene& scene) {
    scene.addBox({-21.0f, 3.95f, -13.0f},
                 {21.0f, 4.60f, 13.0f}, 1, 1);

    scene.addBox({-21.2f, 3.30f, -13.2f},
                 {21.2f, 3.96f, -12.55f}, 2, 2);
    scene.addBox({-21.2f, 3.30f, 12.55f},
                 {21.2f, 3.96f, 13.2f}, 2, 2);
    scene.addBox({-21.2f, 3.30f, -13.0f},
                 {-20.55f, 3.96f, 13.0f}, 2, 2);
    scene.addBox({20.55f, 3.30f, -13.0f},
                 {21.2f, 3.96f, 13.0f}, 2, 2);

    for (float z : {-9.0f, -4.5f, 0.0f, 4.5f, 9.0f}) {
        scene.addBox({-20.4f, 3.34f, z - 0.18f},
                     {20.4f, 3.94f, z + 0.18f}, 2, 2);
    }
    for (float x : {-17.0f, -8.5f, 0.0f, 8.5f, 17.0f}) {
        scene.addBox({x - 0.22f, 2.76f, -12.5f},
                     {x + 0.22f, 3.36f, 12.5f}, 2, 2);
    }

    const Vec3 legPositions[] = {
        {-17.0f, 0.0f, -10.0f}, {17.0f, 0.0f, -10.0f},
        {-17.0f, 0.0f, 10.0f},  {17.0f, 0.0f, 10.0f},
        {0.0f, 0.0f, -10.0f},   {0.0f, 0.0f, 10.0f}};
    for (const Vec3& p : legPositions) {
        scene.addBox({p.x - 1.35f, -3.0f, p.z - 1.35f},
                     {p.x + 1.35f, 1.25f, p.z + 1.35f}, 11, 14);
        scene.addBox({p.x - 0.62f, 1.20f, p.z - 0.62f},
                     {p.x + 0.62f, 4.05f, p.z + 0.62f}, 2, 3);
    }
    scene.addBeam({-17.0f, 2.35f, -10.0f}, {0.0f, 3.05f, -10.0f},
                  0.32f, 2, 2);
    scene.addBeam({0.0f, 3.05f, -10.0f}, {17.0f, 2.35f, -10.0f},
                  0.32f, 2, 2);
    scene.addBeam({-17.0f, 2.35f, 10.0f}, {0.0f, 3.05f, 10.0f},
                  0.32f, 2, 2);
    scene.addBeam({0.0f, 3.05f, 10.0f}, {17.0f, 2.35f, 10.0f},
                  0.32f, 2, 2);
    scene.addBeam({-17.0f, 1.65f, -10.0f}, {-10.5f, 3.15f, 10.0f},
                  0.24f, 2, 2);
    scene.addBeam({17.0f, 1.65f, -10.0f}, {10.5f, 3.15f, 10.0f},
                  0.24f, 2, 2);

    auto addRailingRun = [&](const Vec3& a, const Vec3& b, int posts) {
        for (int i = 0; i <= posts; ++i) {
            const float t = static_cast<float>(i) / static_cast<float>(posts);
            const Vec3 p = mix(a, b, t);
            scene.addBeam(p, p + Vec3{0.0f, 1.55f, 0.0f},
                          0.075f, 19, 4);
        }
        scene.addBeam(a + Vec3{0.0f, 1.48f, 0.0f},
                      b + Vec3{0.0f, 1.48f, 0.0f}, 0.075f, 19, 4);
        scene.addBeam(a + Vec3{0.0f, 0.76f, 0.0f},
                      b + Vec3{0.0f, 0.76f, 0.0f}, 0.055f, 19, 4);
    };
    addRailingRun({20.72f, 4.62f, -12.5f},
                  {20.72f, 4.62f, 12.5f}, 8);
    addRailingRun({-20.72f, 4.62f, -12.5f},
                  {-20.72f, 4.62f, 12.5f}, 8);
    addRailingRun({-20.5f, 4.62f, 12.72f},
                  {20.5f, 4.62f, 12.72f}, 10);
}

void addTransformerCabin(Scene& scene) {
    const float x0 = -13.2f;
    const float x1 = -2.0f;
    const float z0 = -4.8f;
    const float z1 = 4.2f;
    const float y0 = 4.60f;
    const float y1 = 11.20f;

    scene.addBox({x0, y0, z0}, {x1, y0 + 0.16f, z1}, 2, 5);
    scene.addBox({x0, y0, z0}, {x1, y1, z0 + 0.16f}, 4, 5);
    scene.addBox({x0, y0, z0}, {x0 + 0.16f, y1, z1}, 4, 5);
    scene.addBox({x0, y0, z1 - 0.16f}, {x1, y1, z1}, 4, 5);
    scene.addBox({x0, y1 - 0.16f, z0}, {x1, y1, z1}, 4, 5);

    // East wall around the corridor doorway.
    scene.addBox({x1 - 0.16f, y0, z0}, {x1, y1, 0.25f}, 4, 5);
    scene.addBox({x1 - 0.16f, y0, 3.90f}, {x1, y1, z1}, 4, 5);
    scene.addBox({x1 - 0.16f, y0, 0.25f},
                 {x1, 7.35f, 3.90f}, 4, 5);
    scene.addBox({x1 - 0.16f, 10.14f, 0.25f},
                 {x1, y1, 3.90f}, 4, 5);

    for (float x : {x0 + 0.25f, -11.2f, -9.1f, -6.9f, -4.8f, x1 - 0.25f}) {
        scene.addBox({x - 0.08f, y0 + 0.1f, z1 - 0.05f},
                     {x + 0.08f, y1 - 0.05f, z1 + 0.09f}, 2, 5);
        scene.addBox({x - 0.08f, y0 + 0.1f, z0 - 0.09f},
                     {x + 0.08f, y1 - 0.05f, z0 + 0.05f}, 2, 5);
    }
    for (float y : {6.25f, 8.55f, 10.75f}) {
        scene.addBox({x0 - 0.09f, y - 0.07f, z0},
                     {x0 + 0.05f, y + 0.07f, z1}, 2, 5);
        scene.addBox({x1 - 0.05f, y - 0.07f, z0},
                     {x1 + 0.09f, y + 0.07f, z1}, 2, 5);
    }

    const float tankLo[] = {-11.75f, -7.55f};
    for (int i = 0; i < 2; ++i) {
        const float tx0 = tankLo[i];
        const float tx1 = tx0 + 3.45f;
        scene.addBox({tx0, 5.10f, -2.85f},
                     {tx1, 8.95f, 1.65f}, 5, 6);
        scene.addBox({tx0 + 0.18f, 8.90f, -2.65f},
                     {tx1 - 0.18f, 9.18f, 1.45f}, 4, 6);
        for (float z : {-2.55f, -1.3f, 0.0f, 1.25f}) {
            scene.addBox({tx0 - 0.15f, 5.55f, z - 0.07f},
                         {tx0 + 0.08f, 8.45f, z + 0.07f}, 4, 6);
        }
        for (float z : {-1.7f, 0.1f}) {
            scene.addBox({tx0 + 0.9f, 9.16f, z - 0.30f},
                         {tx0 + 1.18f, 10.12f, z + 0.30f}, 4, 6);
            scene.addBox({tx0 + 2.15f, 9.16f, z - 0.30f},
                         {tx0 + 2.43f, 10.12f, z + 0.30f}, 4, 6);
        }
        scene.addBox({tx0 + 0.55f, 9.16f, 0.95f},
                     {tx1 - 0.55f, 9.42f, 1.20f}, 20, 6);
    }
    scene.addBox({-11.0f, 10.93f, 3.75f},
                 {-3.5f, 11.00f, 3.90f}, 18, 6);
    scene.addBox({-12.2f, 4.85f, -4.25f},
                 {-10.9f, 5.65f, -3.60f}, 20, 6);
    scene.addBox({-4.2f, 4.85f, -4.25f},
                 {-2.9f, 5.65f, -3.60f}, 20, 6);

    scene.addBox({x0 - 0.12f, 11.15f, z0 - 0.12f},
                 {x1 + 0.12f, 11.48f, z1 + 0.12f}, 2, 5);
    scene.addPointLight({{-7.6f, 10.55f, 1.1f},
                         {1.0f, 0.80f, 0.54f}, 4.8f});

    SdfObject shroud;
    shroud.objectId = 20;
    shroud.material = 13;
    shroud.kind = SdfKind::RoundedBox;
    shroud.center = {-7.65f, 12.02f, -0.36f};
    shroud.halfExtent = {5.02f, 0.02f, 3.18f};
    shroud.radius = 0.64f;
    shroud.bounds = sdfBounds(
        shroud.center, shroud.halfExtent + Vec3{0.64f, 0.64f, 0.64f});
    scene.addSdf(shroud);
}

void addCorridor(Scene& scene) {
    const float x0 = -2.0f;
    const float x1 = 10.2f;
    const float z0 = 0.28f;
    const float z1 = 3.92f;
    const float floorY = 7.12f;

    for (float x : {0.3f, 4.2f, 8.1f}) {
        scene.addBeam({x, 4.62f, 0.70f}, {x, floorY - 0.18f, 0.70f},
                      0.28f, 2, 7);
        scene.addBeam({x, 4.62f, 3.48f}, {x, floorY - 0.18f, 3.48f},
                      0.28f, 2, 7);
    }
    scene.addBox({x0, floorY, z0}, {x1, floorY + 0.24f, z1}, 7, 7);

    scene.addBox({x0, floorY + 0.24f, z0},
                 {x1, 10.15f, z0 + 0.12f}, 6, 8);
    scene.addBox({x0, floorY + 0.24f, z1 - 0.12f},
                 {x1, 10.15f, z1}, 6, 8);
    scene.addBox({x0, floorY + 0.24f, z0},
                 {x0 + 0.12f, 10.15f, z1}, 6, 8);
    scene.addBox({x1 - 0.12f, floorY + 0.24f, z0},
                 {x1, 10.15f, z1}, 6, 8);

    for (float x : {-1.75f, 0.55f, 2.85f, 5.15f, 7.45f, 9.75f}) {
        scene.addBox({x - 0.07f, floorY + 0.22f, z0 - 0.04f},
                     {x + 0.07f, 10.18f, z0 + 0.09f}, 19, 7);
        scene.addBox({x - 0.07f, floorY + 0.22f, z1 - 0.09f},
                     {x + 0.07f, 10.18f, z1 + 0.04f}, 19, 7);
    }
    scene.addBox({x0, 10.10f, z0}, {x1, 10.28f, z0 + 0.10f}, 19, 7);
    scene.addBox({x0, 10.10f, z1 - 0.10f}, {x1, 10.28f, z1}, 19, 7);

    scene.addBox({1.0f, floorY + 0.24f, 2.65f},
                 {2.45f, floorY + 0.82f, 3.42f}, 20, 7);
    scene.addBox({5.25f, floorY + 0.24f, 2.65f},
                 {6.75f, floorY + 0.82f, 3.42f}, 20, 7);
    scene.addBox({2.0f, 9.02f, 1.72f}, {8.6f, 9.16f, 1.98f}, 18, 7);
    scene.addBeam({0.0f, floorY + 1.0f, 0.58f},
                  {9.5f, floorY + 1.0f, 0.58f}, 0.055f, 19, 7);
    scene.addPointLight({{4.0f, 9.72f, 1.65f},
                         {1.0f, 0.84f, 0.60f}, 4.2f});

    SdfObject canopy;
    canopy.objectId = 21;
    canopy.material = 13;
    canopy.kind = SdfKind::RoundedBox;
    canopy.center = {4.10f, 10.50f, 2.10f};
    canopy.halfExtent = {5.98f, 0.02f, 1.48f};
    canopy.radius = 0.54f;
    canopy.bounds = sdfBounds(
        canopy.center, canopy.halfExtent + Vec3{0.54f, 0.54f, 0.54f});
    scene.addSdf(canopy);
}

void addControlModule(Scene& scene) {
    const float x0 = 10.20f;
    const float x1 = 18.20f;
    const float z0 = -2.80f;
    const float z1 = 4.75f;
    const float y0 = 4.60f;
    const float y1 = 10.85f;

    scene.addBox({x0, y0, z0}, {x1, y0 + 0.18f, z1}, 2, 9);
    scene.addBox({x0, y0, z0}, {x1, y1, z0 + 0.16f}, 12, 9);
    scene.addBox({x1 - 0.16f, y0, z0}, {x1, y1, z1}, 12, 9);
    scene.addBox({x0, y0, z1 - 0.16f}, {x1, y1, z1}, 12, 9);
    scene.addBox({x0, y1 - 0.16f, z0}, {x1, y1, z1}, 12, 9);

    // West wall with corridor opening.
    scene.addBox({x0, y0, z0}, {x0 + 0.16f, y1, 0.28f}, 12, 9);
    scene.addBox({x0, y0, 3.92f}, {x0 + 0.16f, y1, z1}, 12, 9);
    scene.addBox({x0, y0, 0.28f}, {x0 + 0.16f, 7.36f, 3.92f}, 12, 9);
    scene.addBox({x0, 10.34f, 0.28f}, {x0 + 0.16f, y1, 3.92f}, 12, 9);

    for (float x : {10.55f, 12.35f, 14.15f, 15.95f, 17.75f}) {
        scene.addBox({x - 0.08f, y0 + 0.1f, z1 - 0.04f},
                     {x + 0.08f, y1 - 0.06f, z1 + 0.09f}, 2, 9);
    }
    for (float y : {6.15f, 7.75f, 9.35f}) {
        scene.addBox({x0, y - 0.06f, z1 - 0.04f},
                     {x1, y + 0.06f, z1 + 0.08f}, 2, 9);
    }

    scene.addBox({11.2f, 4.85f, -1.9f},
                 {13.1f, 7.25f, 0.55f}, 20, 9);
    scene.addBox({14.0f, 4.85f, -1.9f},
                 {15.9f, 7.45f, 0.55f}, 20, 9);
    scene.addBox({16.1f, 4.85f, -1.9f},
                 {17.55f, 6.55f, 0.55f}, 20, 9);
    scene.addBox({11.2f, 9.58f, -1.70f},
                 {16.9f, 9.72f, -1.42f}, 18, 9);
    scene.addBox({14.1f, 10.69f, 0.8f},
                 {15.0f, 10.90f, 2.1f}, 2, 9);
    scene.addBox({16.4f, 10.69f, -0.2f},
                 {17.1f, 10.90f, 0.8f}, 2, 9);
    scene.addBox({14.35f, 4.62f, 4.55f},
                 {15.45f, 7.55f, 4.80f}, 12, 9);
    scene.addPointLight({{14.2f, 9.43f, 0.3f},
                         {1.0f, 0.84f, 0.62f}, 3.8f});
}

void addCableTray(Scene& scene) {
    const float xa = 19.15f;
    const float xb = 19.95f;
    const float z0 = -9.2f;
    const float z1 = 9.7f;
    const float trayY = 5.52f;

    for (float z : {-8.4f, -4.2f, 0.0f, 4.2f, 8.4f}) {
        scene.addBeam({xa - 0.05f, 4.63f, z}, {xa - 0.05f, trayY - 0.10f, z},
                      0.16f, 8, 10);
        scene.addBeam({xb + 0.05f, 4.63f, z}, {xb + 0.05f, trayY - 0.10f, z},
                      0.16f, 8, 10);
        scene.addBeam({xa - 0.35f, 4.62f, z}, {xa + 0.25f, trayY - 0.12f, z},
                      0.10f, 3, 10);
    }
    scene.addBeam({xa, trayY, z0}, {xa, trayY, z1}, 0.09f, 8, 10);
    scene.addBeam({xb, trayY, z0}, {xb, trayY, z1}, 0.09f, 8, 10);
    scene.addBeam({xa, trayY + 0.20f, z0}, {xa, trayY + 0.20f, z1},
                  0.07f, 8, 10);
    scene.addBeam({xb, trayY + 0.20f, z0}, {xb, trayY + 0.20f, z1},
                  0.07f, 8, 10);
    for (float z = z0 + 0.2f; z <= z1; z += 0.55f) {
        scene.addBox({xa - 0.05f, trayY - 0.10f, z - 0.045f},
                     {xb + 0.05f, trayY - 0.02f, z + 0.045f}, 8, 10);
    }

    const int cableMaterials[] = {14, 15, 16, 9};
    for (int cable = 0; cable < 4; ++cable) {
        std::vector<Vec3> points;
        const float x = 19.30f + 0.16f * static_cast<float>(cable);
        for (int i = 0; i <= 12; ++i) {
            const float t = static_cast<float>(i) / 12.0f;
            const float z = lerpf(z0 + 0.25f, z1 - 0.35f, t);
            const float sag =
                0.075f * std::sin(t * kPi * 4.0f + cable * 0.8f);
            points.push_back({x, trayY + 0.075f - std::fabs(sag),
                              z});
        }
        points.push_back({x, trayY + 0.52f, z1 + 0.05f});
        points.push_back({x, 7.25f, 10.05f});
        points.push_back({x, 10.10f + 0.16f * cable, 10.32f});

        SdfObject wire;
        wire.objectId = 31 + cable;
        wire.material = cableMaterials[cable];
        wire.kind = SdfKind::PolyCapsule;
        wire.radius = 0.072f;
        wire.points = points;
        wire.bounds = polylineBounds(points, wire.radius + 0.01f);
        scene.addSdf(wire);
    }
}

void addGantry(Scene& scene) {
    scene.addBeam({19.55f, 4.60f, 10.30f}, {19.55f, 13.70f, 10.30f},
                  0.34f, 2, 11);
    scene.addBeam({18.50f, 12.70f, 10.30f}, {20.80f, 12.70f, 10.30f},
                  0.22f, 2, 11);
    scene.addBeam({18.50f, 11.45f, 10.30f}, {20.80f, 11.45f, 10.30f},
                  0.18f, 2, 11);
    for (float x : {18.55f, 19.15f, 19.85f, 20.55f}) {
        scene.addBeam({x, 11.45f, 10.30f}, {x, 12.62f, 10.30f},
                      0.08f, 4, 11);
        scene.addBox({x - 0.12f, 11.28f, 10.10f},
                     {x + 0.12f, 11.47f, 10.50f}, 4, 11);
    }
}

}  // namespace

Scene makeOffshoreScene() {
    Scene scene;
    addMaterials(scene);
    addWater(scene);
    addPlatform(scene);
    addTransformerCabin(scene);
    addCorridor(scene);
    addControlModule(scene);
    addCableTray(scene);
    addGantry(scene);
    scene.build();
    return scene;
}

}  // namespace ocr
