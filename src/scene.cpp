#include "scene.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace rad {
namespace {

constexpr unsigned kXNeg = 1u << 0;
constexpr unsigned kXPos = 1u << 1;
constexpr unsigned kYNeg = 1u << 2;
constexpr unsigned kYPos = 1u << 3;
constexpr unsigned kZNeg = 1u << 4;
constexpr unsigned kZPos = 1u << 5;

Vec3 axis(double x, double y, double z) { return {x, y, z}; }

}  // namespace

std::string materialName(MaterialId id) {
    switch (id) {
        case MaterialId::WhiteWall: return "white_wall";
        case MaterialId::CorridorWall: return "corridor_wall";
        case MaterialId::Ceiling: return "ceiling";
        case MaterialId::Floor: return "floor";
        case MaterialId::DoorJamb: return "door_jamb";
        case MaterialId::Cabinet: return "equipment_cabinet";
        case MaterialId::Console: return "control_console";
        case MaterialId::CeilingLamp: return "ceiling_lamp";
        case MaterialId::CorridorLamp: return "corridor_lamp";
        case MaterialId::RedEquipmentLamp: return "red_equipment_lamp";
    }
    return "unknown";
}

void Scene::addMaterial(MaterialId id, const std::string& name,
                        const Rgb& color, const Rgb& emission) {
    const std::size_t index = static_cast<std::size_t>(id);
    if (materials.size() <= index) {
        materials.resize(index + 1);
    }
    materials[index] = Material{name, color, emission};
}

void Scene::reservePatches(std::size_t count) {
    patches.reserve(count);
}

void Scene::addRect(MaterialId id, const Vec3& p0, const Vec3& u, const Vec3& v,
                    double maxEdge) {
    const double lu = length(u);
    const double lv = length(v);
    if (lu < kEpsilon || lv < kEpsilon) {
        return;
    }
    const int nu = std::max(1, static_cast<int>(std::ceil(lu / maxEdge)));
    const int nv = std::max(1, static_cast<int>(std::ceil(lv / maxEdge)));
    const Vec3 du = u / static_cast<double>(nu);
    const Vec3 dv = v / static_cast<double>(nv);
    const Vec3 normal = normalized(cross(du, dv));
    const double area = length(cross(du, dv));
    const Material& mat = material(id);

    for (int iv = 0; iv < nv; ++iv) {
        for (int iu = 0; iu < nu; ++iu) {
            Patch patch;
            patch.id = static_cast<int>(patches.size());
            patch.quad.p0 = p0 + du * static_cast<double>(iu) + dv * static_cast<double>(iv);
            patch.quad.u = du;
            patch.quad.v = dv;
            patch.quad.normal = normal;
            patch.quad.area = area;
            patch.material = id;
            patch.color = mat.color;
            patch.emission = mat.emission;
            patch.area = area;
            patches.push_back(patch);
        }
    }
}

void Scene::addOccluder(const Aabb& box) {
    occluders.push_back(box);
}

void Scene::addBox(const Aabb& box, MaterialId id, unsigned faceMask,
                   bool occlude, double maxEdge) {
    const double x0 = box.lo.x;
    const double y0 = box.lo.y;
    const double z0 = box.lo.z;
    const double x1 = box.hi.x;
    const double y1 = box.hi.y;
    const double z1 = box.hi.z;
    const double dx = x1 - x0;
    const double dy = y1 - y0;
    const double dz = z1 - z0;

    if (faceMask & kXNeg) {
        addRect(id, {x0, y0, z0}, axis(0, 0, dz), axis(0, dy, 0), maxEdge);
    }
    if (faceMask & kXPos) {
        addRect(id, {x1, y0, z0}, axis(0, dy, 0), axis(0, 0, dz), maxEdge);
    }
    if (faceMask & kYNeg) {
        addRect(id, {x0, y0, z0}, axis(dx, 0, 0), axis(0, 0, dz), maxEdge);
    }
    if (faceMask & kYPos) {
        addRect(id, {x0, y1, z0}, axis(0, 0, dz), axis(dx, 0, 0), maxEdge);
    }
    if (faceMask & kZNeg) {
        addRect(id, {x0, y0, z0}, axis(0, dy, 0), axis(dx, 0, 0), maxEdge);
    }
    if (faceMask & kZPos) {
        addRect(id, {x0, y0, z1}, axis(dx, 0, 0), axis(0, dy, 0), maxEdge);
    }
    if (occlude) {
        addOccluder(box);
    }
}

void Scene::buildShelter() {
    materials.clear();
    patches.clear();
    occluders.clear();

    addMaterial(MaterialId::WhiteWall, "white_wall", {0.76, 0.76, 0.74}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::CorridorWall, "corridor_wall", {0.66, 0.69, 0.68}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::Ceiling, "ceiling", {0.70, 0.70, 0.68}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::Floor, "floor", {0.37, 0.34, 0.30}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::DoorJamb, "door_jamb", {0.43, 0.42, 0.38}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::Cabinet, "equipment_cabinet", {0.17, 0.21, 0.17}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::Console, "control_console", {0.20, 0.20, 0.21}, {0.0, 0.0, 0.0});
    addMaterial(MaterialId::CeilingLamp, "ceiling_lamp", {0.04, 0.04, 0.04}, {52.0, 52.0, 50.0});
    addMaterial(MaterialId::CorridorLamp, "corridor_lamp", {0.04, 0.04, 0.04}, {41.0, 42.0, 45.0});
    addMaterial(MaterialId::RedEquipmentLamp, "red_equipment_lamp",
                {0.04, 0.01, 0.01}, {26.0, 0.9, 0.25});

    // Shell dimensions: a low control hall, a 0.16 m thick portal wall, and
    // a narrow corridor. The two rooms plus the portal are a closed cavity.
    const double x0 = 0.0;
    const double x1 = 7.20;
    const double y0 = 0.0;
    const double y1 = 5.20;
    const double z0 = 0.0;
    const double z1 = 2.40;
    const double wall = 0.16;
    const double cx0 = x1 + wall;
    const double cx1 = 12.0;
    const double cy0 = 1.95;
    const double cy1 = 3.35;
    const double doorY0 = 2.20;
    const double doorY1 = 3.10;
    const double doorZ1 = 2.00;

    reservePatches(1100);

    // Control-hall shell, with the shared wall split around the portal.
    addRect(MaterialId::Floor, {x0, y0, z0}, axis(x1 - x0, 0, 0), axis(0, y1 - y0, 0));
    addRect(MaterialId::Ceiling, {x0, y0, z1}, axis(0, y1 - y0, 0), axis(x1 - x0, 0, 0));
    addRect(MaterialId::WhiteWall, {x0, y0, z0}, axis(0, y1 - y0, 0), axis(0, 0, z1 - z0));
    addRect(MaterialId::WhiteWall, {x0, y0, z0}, axis(0, 0, z1 - z0), axis(x1 - x0, 0, 0));
    addRect(MaterialId::WhiteWall, {x0, y1, z0}, axis(x1 - x0, 0, 0), axis(0, 0, z1 - z0));

    addRect(MaterialId::WhiteWall, {x1, y0, z0},
            axis(0, 0, z1 - z0), axis(0, doorY0 - y0, 0));
    addRect(MaterialId::WhiteWall, {x1, doorY1, z0},
            axis(0, 0, z1 - z0), axis(0, y1 - doorY1, 0));
    addRect(MaterialId::WhiteWall, {x1, doorY0, doorZ1},
            axis(0, 0, z1 - doorZ1), axis(0, doorY1 - doorY0, 0));

    // Portal reveal and floor/ceiling strips.
    addRect(MaterialId::DoorJamb, {x1, doorY0, z0}, axis(0, 0, doorZ1), axis(wall, 0, 0));
    addRect(MaterialId::DoorJamb, {x1, doorY1, z0}, axis(wall, 0, 0), axis(0, 0, doorZ1));
    addRect(MaterialId::DoorJamb, {x1, doorY0, doorZ1},
            axis(0, doorY1 - doorY0, 0), axis(wall, 0, 0));
    addRect(MaterialId::Floor, {x1, doorY0, z0}, axis(wall, 0, 0), axis(0, doorY1 - doorY0, 0), 0.24);

    // Corridor shell and the other side of the portal wall.
    addRect(MaterialId::Floor, {cx0, cy0, z0}, axis(cx1 - cx0, 0, 0), axis(0, cy1 - cy0, 0));
    addRect(MaterialId::Ceiling, {cx0, cy0, z1}, axis(0, cy1 - cy0, 0), axis(cx1 - cx0, 0, 0));
    addRect(MaterialId::CorridorWall, {cx0, cy0, z0},
            axis(0, 0, z1 - z0), axis(cx1 - cx0, 0, 0));
    addRect(MaterialId::CorridorWall, {cx0, cy1, z0},
            axis(cx1 - cx0, 0, 0), axis(0, 0, z1 - z0));
    addRect(MaterialId::CorridorWall, {cx1, cy0, z0},
            axis(0, 0, z1 - z0), axis(0, cy1 - cy0, 0));

    addRect(MaterialId::CorridorWall, {cx0, cy0, z0},
            axis(0, doorY0 - cy0, 0), axis(0, 0, z1 - z0));
    addRect(MaterialId::CorridorWall, {cx0, doorY1, z0},
            axis(0, cy1 - doorY1, 0), axis(0, 0, z1 - z0));
    addRect(MaterialId::CorridorWall, {cx0, doorY0, doorZ1},
            axis(0, doorY1 - doorY0, 0), axis(0, 0, z1 - doorZ1));

    // Add the solid slabs after the cavity surfaces so junction edges are
    // watertight for the visibility test.
    addOccluder({{-0.20, -0.20, z0 - 0.16}, {cx1 + 0.20, y1 + 0.20, z0}});
    addOccluder({{-0.20, -0.20, z1}, {cx1 + 0.20, y1 + 0.20, z1 + 0.16}});
    addOccluder({{x0 - 0.16, y0 - 0.20, z0}, {x0, y1 + 0.20, z1}});
    addOccluder({{x0 - 0.20, y0 - 0.16, z0}, {x1, y0, z1}});
    addOccluder({{x0 - 0.20, y1, z0}, {x1, y1 + 0.16, z1}});
    addOccluder({{x1, y0 - 0.20, z0}, {cx0, doorY0, z1}});
    addOccluder({{x1, doorY1, z0}, {cx0, y1 + 0.20, z1}});
    addOccluder({{x1, doorY0, doorZ1}, {cx0, doorY1, z1}});
    addOccluder({{cx0, cy0 - 0.16, z0}, {cx1, cy0, z1}});
    addOccluder({{cx0, cy1, z0}, {cx1, cy1 + 0.16, z1}});
    addOccluder({{cx1, cy0 - 0.16, z0}, {cx1 + 0.16, cy1 + 0.16, z1}});

    // Cabinet against the left wall, shelf unit against the far wall, and a
    // low console near the portal. Contacting faces are intentionally omitted.
    addBox({{x0, 3.45, z0}, {1.25, 4.45, 1.35}}, MaterialId::Cabinet,
           kXPos | kYNeg | kYPos | kZPos, true, 0.42);
    addBox({{0.45, 4.50, z0}, {1.55, y1, 1.82}}, MaterialId::Cabinet,
           kXNeg | kXPos | kYNeg | kZPos, true, 0.42);
    addBox({{3.60, 1.70, z0}, {5.45, 2.42, 1.02}}, MaterialId::Console,
           kXNeg | kXPos | kYNeg | kYPos | kZPos, true, 0.38);

    // Lamps are thin emissive rectangles just off their mounting surfaces.
    addRect(MaterialId::CeilingLamp, {3.15, 2.38, z1 - 0.012},
            axis(0, 0.46, 0), axis(0.90, 0, 0), 0.28);
    addRect(MaterialId::CorridorLamp, {9.38, 2.51, z1 - 0.012},
            axis(0, 0.28, 0), axis(0.66, 0, 0), 0.28);
    addBox({{4.25, 1.88, 1.02}, {4.37, 2.00, 1.14}},
           MaterialId::RedEquipmentLamp,
           kXNeg | kXPos | kYNeg | kYPos, true, 0.12);

    bounds_ = Aabb{{x0, y0, z0}, {cx1, y1, z1}};
}

}  // namespace rad
