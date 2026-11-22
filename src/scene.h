#pragma once

#include "math.h"

#include <string>
#include <vector>

namespace rad {

enum class MaterialId {
    WhiteWall,
    CorridorWall,
    Ceiling,
    Floor,
    DoorJamb,
    Cabinet,
    Console,
    CeilingLamp,
    CorridorLamp,
    RedEquipmentLamp
};

struct Material {
    std::string name;
    Rgb color;
    Rgb emission;
};

struct Quad {
    Vec3 p0;
    Vec3 u;
    Vec3 v;
    Vec3 normal;
    double area = 0.0;

    Vec3 point(double uu, double vv) const { return p0 + u * uu + v * vv; }
    Vec3 center() const { return point(0.5, 0.5); }
};

struct Patch {
    int id = -1;
    Quad quad;
    MaterialId material = MaterialId::WhiteWall;
    Rgb color;
    Rgb emission;
    double area = 0.0;

    // Solver state, all values are per unit area.
    Rgb arrived;
    Rgb unshot;
    Rgb direct;

    bool isEmitter() const { return maxChannel(emission) > 0.0; }
    Rgb radiosity() const { return emission + color * arrived; }
};

class Scene {
public:
    std::vector<Material> materials;
    std::vector<Patch> patches;
    std::vector<Aabb> occluders;

    void buildShelter();

    int materialIndex(MaterialId id) const { return static_cast<int>(id); }
    const Material& material(MaterialId id) const { return materials[materialIndex(id)]; }
    const Aabb& bounds() const { return bounds_; }

private:
    Aabb bounds_{Vec3{0.0, 0.0, 0.0}, Vec3{12.0, 5.2, 2.4}};

    void addMaterial(MaterialId id, const std::string& name, const Rgb& color, const Rgb& emission);
    void addRect(MaterialId id, const Vec3& p0, const Vec3& u, const Vec3& v,
                 double maxEdge = 0.48);
    void addBox(const Aabb& box, MaterialId id, unsigned faceMask = 63,
                bool occlude = true, double maxEdge = 0.45);
    void addOccluder(const Aabb& box);
    void reservePatches(std::size_t count);
};

std::string materialName(MaterialId id);

}  // namespace rad
