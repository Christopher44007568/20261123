#pragma once

#include "spectrum.hpp"
#include "vec3.hpp"

#include <cstdint>
#include <vector>

namespace st {

enum class Material : std::uint8_t {
    Salt,
    WhiteWall,
    Brass,
    PrismGlass,
    TubeGlass,
    Water,
    BronzeStand,
    BeamEmitter,
    FillEmitter
};

enum class Medium : std::uint8_t {
    Air,
    PrismGlass,
    TubeGlass,
    Water
};

struct Hit {
    double t = kInf;
    Vec3 point;
    Vec3 normal;
    Vec3 outward_normal;
    Material material = Material::Salt;
    std::uint32_t geometry_id = 0;
    bool front_face = true;
};

struct Triangle {
    Vec3 a;
    Vec3 b;
    Vec3 c;
    Vec3 normal;
    Material material = Material::Salt;
    std::uint32_t geometry_id = 0;
};

struct Box {
    Vec3 lo;
    Vec3 hi;
    Material material = Material::Salt;
    std::uint32_t geometry_id = 0;
};

struct TrianglePrism {
    Vec3 center;
    double side = 1.0;
    double thickness = 1.0;
    Material material = Material::PrismGlass;
    std::uint32_t geometry_id = 0;
};

struct CylinderShell {
    Vec3 center;
    double outer_radius = 1.0;
    double wall_thickness = 0.05;
    double y_min = 0.0;
    double y_max = 1.0;
    Material material = Material::TubeGlass;
    std::uint32_t geometry_id = 0;
};

struct RectEmitter {
    Vec3 center;
    Vec3 axis_u;
    Vec3 axis_v;
    Vec3 normal;
    double half_u = 0.0;
    double half_v = 0.0;
    double radiance = 1.0;
    Material material = Material::FillEmitter;
    std::uint32_t geometry_id = 0;

    double area() const { return 4.0 * half_u * half_v; }
};

struct Camera {
    Vec3 origin;
    Vec3 target;
    Vec3 up{0.0, 1.0, 0.0};
    double vertical_fov_degrees = 40.0;
    int width = 720;
    int height = 405;

    Vec3 forward() const { return normalize(target - origin); }
    Vec3 right() const { return normalize(cross(forward(), up)); }
    Vec3 camera_up() const { return cross(right(), forward()); }
    double pixel_aspect() const {
        return static_cast<double>(width) / static_cast<double>(height);
    }
    double image_plane_half_height() const {
        return std::tan(0.5 * vertical_fov_degrees * kPi / 180.0);
    }
    Vec3 ray_direction(double pixel_x, double pixel_y) const {
        const double u = (2.0 * pixel_x / static_cast<double>(width) - 1.0) *
                         image_plane_half_height() * pixel_aspect();
        const double v = (1.0 - 2.0 * pixel_y / static_cast<double>(height)) *
                         image_plane_half_height();
        return normalize(forward() + right() * u + camera_up() * v);
    }
};

struct SourceLight {
    Vec3 center;
    Vec3 axis;
    Vec3 up;
    Vec3 right;
    double aperture_half_height = 0.01;
    double aperture_half_width = 0.12;
    double cone_half_angle = 0.01;
    int group_id = 0;
};

class Scene {
public:
    Camera camera;
    SourceLight source;
    std::vector<Triangle> triangles;
    std::vector<Box> boxes;
    std::vector<TrianglePrism> prisms;
    std::vector<CylinderShell> tubes;
    std::vector<RectEmitter> emitters;

    explicit Scene(int width, int height);

    bool intersect(const Vec3& origin, const Vec3& direction,
                   double t_min, double t_max, Hit& hit,
                   bool include_emitters) const;
    bool occluded(const Vec3& origin, const Vec3& direction,
                  double t_min, double t_max) const;

    const RectEmitter& fill_light() const;
    const RectEmitter& beam_light() const;
    Vec3 environment(const Vec3& direction) const;

private:
    std::uint32_t next_geometry_id_ = 1;
    std::size_t fill_light_index_ = 0;
    std::size_t beam_light_index_ = 0;

    void add_triangle(const Vec3& a, const Vec3& b, const Vec3& c,
                      Material material, const Vec3& desired_normal);
    void add_quad(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d,
                  Material material, const Vec3& desired_normal);
    void build_architecture();
    void build_optics();
};

bool material_is_dielectric(Material material);
bool material_has_volume(Material material);
double material_ior(Material material, double lambda_nm);
Medium material_medium(Material material);
Vec3 material_absorption(Material material, double lambda_nm);
double material_albedo(Material material, double lambda_nm);
double material_roughness(Material material);

}  // namespace st
