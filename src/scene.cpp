#include "scene.hpp"

#include <algorithm>
#include <array>
#include <cmath>

namespace st {

bool material_is_dielectric(Material material) {
    return material == Material::PrismGlass ||
           material == Material::TubeGlass ||
           material == Material::Water;
}

bool material_has_volume(Material material) {
    return material_is_dielectric(material);
}

double material_ior(Material material, double lambda_nm) {
    switch (material) {
        case Material::PrismGlass:
            return prism_ior(lambda_nm);
        case Material::TubeGlass:
            return tube_glass_ior(lambda_nm);
        case Material::Water:
            return water_ior(lambda_nm);
        default:
            return 1.0;
    }
}

Medium material_medium(Material material) {
    switch (material) {
        case Material::PrismGlass:
            return Medium::PrismGlass;
        case Material::TubeGlass:
            return Medium::TubeGlass;
        case Material::Water:
            return Medium::Water;
        default:
            return Medium::Air;
    }
}

Vec3 material_absorption(Material material, double lambda_nm) {
    if (material == Material::PrismGlass) {
        return prism_absorption(lambda_nm);
    }
    if (material == Material::Water) {
        return water_absorption(lambda_nm);
    }
    if (material == Material::TubeGlass) {
        return prism_absorption(lambda_nm) * 0.65;
    }
    return Vec3(0.0, 0.0, 0.0);
}

double material_albedo(Material material, double lambda_nm) {
    const double t = saturate((lambda_nm - 400.0) / 320.0);
    switch (material) {
        case Material::Salt:
            return 0.80 + 0.025 * (1.0 - t);
        case Material::WhiteWall:
            return 0.925 + 0.020 * (1.0 - t);
        case Material::BronzeStand:
            return 0.14;
        case Material::BeamEmitter:
        case Material::FillEmitter:
            return 1.0;
        case Material::Brass:
        case Material::PrismGlass:
        case Material::TubeGlass:
        case Material::Water:
            return 0.0;
    }
    return 0.0;
}

double material_roughness(Material material) {
    if (material == Material::Brass) {
        return 0.105;
    }
    return 1.0;
}

Scene::Scene(int width, int height) {
    camera.origin = Vec3(0.55, 2.95, 8.25);
    camera.target = Vec3(0.35, 1.34, -0.55);
    camera.vertical_fov_degrees = 39.0;
    camera.width = width;
    camera.height = height;

    build_architecture();
    build_optics();
}

void Scene::add_triangle(const Vec3& a, const Vec3& b, const Vec3& c,
                         Material material, const Vec3& desired_normal) {
    Vec3 v1 = b;
    Vec3 v2 = c;
    Vec3 n = normalize(cross(v1 - a, v2 - a));
    if (dot(n, desired_normal) < 0.0) {
        std::swap(v1, v2);
        n = -n;
    }
    triangles.push_back({a, v1, v2, n, material, next_geometry_id_++});
}

void Scene::add_quad(const Vec3& a, const Vec3& b, const Vec3& c, const Vec3& d,
                     Material material, const Vec3& desired_normal) {
    const std::uint32_t group = next_geometry_id_++;
    Vec3 n = normalize(cross(b - a, c - a));
    if (dot(n, desired_normal) < 0.0) {
        triangles.push_back({a, d, c, -n, material, group});
        triangles.push_back({a, c, b, -n, material, group});
    } else {
        triangles.push_back({a, b, c, n, material, group});
        triangles.push_back({a, c, d, n, material, group});
    }
}

void Scene::build_architecture() {
    boxes.push_back({
        Vec3(-8.0, -0.16, -6.6),
        Vec3(8.0, 0.0, 8.0),
        Material::Salt,
        next_geometry_id_++
    });

    const Vec3 wall_axis(2.20, 0.0, -41.30);
    const double wall_radius = 40.00;
    const double angle_lo = -0.130;
    const double angle_hi = 0.130;
    const double y_lo = 0.0;
    const double y_hi = 4.20;
    const int segments = 72;

    auto arc_point = [&](double angle, double y) {
        return Vec3(wall_axis.x + wall_radius * std::sin(angle), y,
                    wall_axis.z + wall_radius * std::cos(angle));
    };
    for (int i = 0; i < segments; ++i) {
        const double a0 = angle_lo + (angle_hi - angle_lo) *
                           static_cast<double>(i) / static_cast<double>(segments);
        const double a1 = angle_lo + (angle_hi - angle_lo) *
                           static_cast<double>(i + 1) / static_cast<double>(segments);
        const Vec3 p00 = arc_point(a0, y_lo);
        const Vec3 p10 = arc_point(a1, y_lo);
        const Vec3 p11 = arc_point(a1, y_hi);
        const Vec3 p01 = arc_point(a0, y_hi);
        const double am = 0.5 * (a0 + a1);
        const Vec3 outward(std::sin(am), 0.0, std::cos(am));
        add_quad(p00, p10, p11, p01, Material::WhiteWall, outward);
    }

    const Vec3 mirror_center(2.95, 1.20, -0.03);
    const Vec3 mirror_u = normalize(Vec3(0.60, 0.0, 0.80));
    const Vec3 mirror_v(0.0, 1.0, 0.0);
    const Vec3 mirror_n = normalize(cross(mirror_u, mirror_v));
    const Vec3 ma = mirror_center - mirror_u * 0.45 - mirror_v * 0.82;
    const Vec3 mb = mirror_center + mirror_u * 0.45 - mirror_v * 0.82;
    const Vec3 mc = mirror_center + mirror_u * 0.45 + mirror_v * 0.82;
    const Vec3 md = mirror_center - mirror_u * 0.45 + mirror_v * 0.82;
    add_quad(ma, mb, mc, md, Material::Brass, mirror_n);
    add_quad(ma - mirror_n * 0.025, mb - mirror_n * 0.025,
             mc - mirror_n * 0.025, md - mirror_n * 0.025,
             Material::Brass, -mirror_n);

    boxes.push_back({
        Vec3(-2.96, 0.0, -0.24),
        Vec3(-1.74, 1.30, 1.30),
        Material::BronzeStand,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(-1.18, 0.0, -0.69),
        Vec3(-0.32, 0.37, 0.19),
        Material::BronzeStand,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(2.84, 0.0, -0.20),
        Vec3(3.06, 0.38, 0.16),
        Material::BronzeStand,
        next_geometry_id_++
    });

    RectEmitter fill;
    fill.center = Vec3(0.35, 4.22, 1.90);
    fill.axis_u = Vec3(1.0, 0.0, 0.0);
    fill.axis_v = Vec3(0.0, 0.0, 1.0);
    fill.normal = Vec3(0.0, -1.0, 0.0);
    fill.half_u = 2.40;
    fill.half_v = 1.65;
    fill.radiance = 0.36;
    fill.material = Material::FillEmitter;
    fill.geometry_id = next_geometry_id_++;
    fill_light_index_ = emitters.size();
    emitters.push_back(fill);
}

void Scene::build_optics() {
    const double prism_y0 = 1.34;
    const double prism_y1 = 2.56;
    const Vec3 prism_center(-2.35, 0.0, 0.40);
    const double apex_angle = 25.0 * kPi / 180.0;
    const double triangle_height = 1.0;
    const double half_base = triangle_height * std::tan(0.5 * apex_angle);
    const double centroid_drop = triangle_height / 3.0;
    const double rotation = -27.5 * kPi / 180.0;
    const double cr = std::cos(rotation);
    const double sr = std::sin(rotation);
    auto rotate_xz = [&](double x, double z) {
        return Vec3(cr * x - sr * z, 0.0, sr * x + cr * z);
    };
    const Vec3 local0 = rotate_xz(-half_base, -centroid_drop);
    const Vec3 local1 = rotate_xz(half_base, -centroid_drop);
    const Vec3 local2 = rotate_xz(0.0, triangle_height - centroid_drop);
    const Vec3 a0(prism_center.x + local0.x, prism_y0, prism_center.z + local0.z);
    const Vec3 a1(prism_center.x + local0.x, prism_y1, prism_center.z + local0.z);
    const Vec3 b0(prism_center.x + local1.x, prism_y0, prism_center.z + local1.z);
    const Vec3 b1(prism_center.x + local1.x, prism_y1, prism_center.z + local1.z);
    const Vec3 c0(prism_center.x + local2.x, prism_y0, prism_center.z + local2.z);
    const Vec3 c1(prism_center.x + local2.x, prism_y1, prism_center.z + local2.z);
    const std::uint32_t prism_group = next_geometry_id_++;
    const std::size_t prism_start = triangles.size();
    const std::array<Vec3, 3> base2d{local0, local1, local2};
    const std::array<Vec3, 3> bottom{a0, b0, c0};
    const std::array<Vec3, 3> top{a1, b1, c1};
    for (int i = 0; i < 3; ++i) {
        const int j = (i + 1) % 3;
        const Vec3 edge = base2d[static_cast<std::size_t>(j)] -
                          base2d[static_cast<std::size_t>(i)];
        Vec3 outward = normalize(Vec3(edge.z, 0.0, -edge.x));
        const Vec3 midpoint = 0.5 * (base2d[static_cast<std::size_t>(i)] +
                                     base2d[static_cast<std::size_t>(j)]);
        if (dot(outward, Vec3(midpoint.x, 0.0, midpoint.z)) < 0.0) {
            outward = -outward;
        }
        add_quad(bottom[static_cast<std::size_t>(i)],
                 bottom[static_cast<std::size_t>(j)],
                 top[static_cast<std::size_t>(j)],
                 top[static_cast<std::size_t>(i)],
                 Material::PrismGlass, outward);
    }
    add_triangle(a0, b0, c0, Material::PrismGlass, Vec3(0.0, -1.0, 0.0));
    add_triangle(a1, b1, c1, Material::PrismGlass, Vec3(0.0, 1.0, 0.0));
    for (std::size_t i = prism_start; i < triangles.size(); ++i) {
        triangles[i].geometry_id = prism_group;
    }

    CylinderShell tube;
    tube.center = Vec3(-0.75, 0.0, -0.32);
    tube.outer_radius = 0.42;
    tube.wall_thickness = 0.055;
    tube.y_min = 0.37;
    tube.y_max = 2.32;
    tube.geometry_id = next_geometry_id_++;
    tubes.push_back(tube);

    boxes.push_back({
        Vec3(0.515, 0.55, -1.35),
        Vec3(0.605, 2.00, 0.35),
        Material::Water,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(0.475, 0.49, -1.40),
        Vec3(0.645, 0.55, 0.40),
        Material::BronzeStand,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(0.475, 1.98, -1.40),
        Vec3(0.645, 2.04, 0.40),
        Material::BronzeStand,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(0.475, 0.55, -1.40),
        Vec3(0.645, 2.00, -1.345),
        Material::BronzeStand,
        next_geometry_id_++
    });
    boxes.push_back({
        Vec3(0.475, 0.55, 0.345),
        Vec3(0.645, 2.00, 0.40),
        Material::BronzeStand,
        next_geometry_id_++
    });

    source.center = Vec3(-5.08, 1.875, 0.40);
    source.axis = normalize(Vec3(-2.75, 1.72, 0.40) - source.center);
    source.right = normalize(cross(source.axis, Vec3(0.0, 1.0, 0.0)));
    source.up = normalize(cross(source.right, source.axis));
    source.aperture_half_height = 0.012;
    source.aperture_half_width = 0.060;
    source.cone_half_angle = 0.0090;
    source.group_id = static_cast<int>(next_geometry_id_++);

    RectEmitter beam;
    beam.center = source.center;
    beam.axis_u = source.right;
    beam.axis_v = source.up;
    beam.normal = -source.axis;
    beam.half_u = source.aperture_half_width;
    beam.half_v = source.aperture_half_height;
    beam.radiance = 22.0;
    beam.material = Material::BeamEmitter;
    beam.geometry_id = static_cast<std::uint32_t>(source.group_id);
    beam_light_index_ = emitters.size();
    emitters.push_back(beam);
}

const RectEmitter& Scene::fill_light() const {
    return emitters[fill_light_index_];
}

const RectEmitter& Scene::beam_light() const {
    return emitters[beam_light_index_];
}

Vec3 Scene::environment(const Vec3& direction) const {
    const double up = saturate(direction.y * 0.5 + 0.5);
    const double horizon = std::exp(-10.0 * direction.y * direction.y);
    return Vec3(0.010 + 0.018 * up + 0.008 * horizon,
                0.014 + 0.022 * up + 0.010 * horizon,
                0.018 + 0.026 * up + 0.012 * horizon);
}

namespace {

void orient_hit(Hit& hit, const Vec3& direction, const Vec3& outward) {
    hit.outward_normal = normalize(outward);
    hit.front_face = dot(direction, hit.outward_normal) < 0.0;
    hit.normal = hit.front_face ? hit.outward_normal : -hit.outward_normal;
}

bool intersect_triangle(const Triangle& tri, const Vec3& origin,
                        const Vec3& direction, double t_min, double t_max,
                        Hit& hit) {
    const Vec3 e1 = tri.b - tri.a;
    const Vec3 e2 = tri.c - tri.a;
    const Vec3 pvec = cross(direction, e2);
    const double det = dot(e1, pvec);
    if (std::abs(det) < 1e-12) {
        return false;
    }
    const double inv_det = 1.0 / det;
    const Vec3 tvec = origin - tri.a;
    const double u = dot(tvec, pvec) * inv_det;
    if (u < -1e-7 || u > 1.0 + 1e-7) {
        return false;
    }
    const Vec3 qvec = cross(tvec, e1);
    const double v = dot(direction, qvec) * inv_det;
    if (v < -1e-7 || u + v > 1.0 + 1e-7) {
        return false;
    }
    const double t = dot(e2, qvec) * inv_det;
    if (t < t_min || t > t_max) {
        return false;
    }
    hit.t = t;
    hit.point = origin + direction * t;
    hit.material = tri.material;
    hit.geometry_id = tri.geometry_id;
    orient_hit(hit, direction, tri.normal);
    return true;
}

bool intersect_box(const Box& box, const Vec3& origin, const Vec3& direction,
                   double t_min, double t_max, Hit& hit) {
    double t0 = -kInf;
    double t1 = kInf;
    const double o[3] = {origin.x, origin.y, origin.z};
    const double d[3] = {direction.x, direction.y, direction.z};
    const double lo[3] = {box.lo.x, box.lo.y, box.lo.z};
    const double hi[3] = {box.hi.x, box.hi.y, box.hi.z};
    for (int axis = 0; axis < 3; ++axis) {
        if (std::abs(d[axis]) < 1e-14) {
            if (o[axis] < lo[axis] || o[axis] > hi[axis]) {
                return false;
            }
            continue;
        }
        const double inv = 1.0 / d[axis];
        double near_t = (lo[axis] - o[axis]) * inv;
        double far_t = (hi[axis] - o[axis]) * inv;
        if (near_t > far_t) {
            std::swap(near_t, far_t);
        }
        t0 = std::max(t0, near_t);
        t1 = std::min(t1, far_t);
        if (t0 > t1) {
            return false;
        }
    }
    double t = t0;
    if (t < t_min) {
        t = t1;
    }
    if (t < t_min || t > t_max) {
        return false;
    }
    const Vec3 p = origin + direction * t;
    const double px[3] = {p.x, p.y, p.z};
    int face_axis = 0;
    double face_dist = kInf;
    for (int axis = 0; axis < 3; ++axis) {
        const double dl = std::abs(px[axis] - lo[axis]);
        const double dh = std::abs(px[axis] - hi[axis]);
        if (dl < face_dist) {
            face_dist = dl;
            face_axis = axis;
        }
        if (dh < face_dist) {
            face_dist = dh;
            face_axis = axis;
        }
    }
    Vec3 outward(0.0, 0.0, 0.0);
    const double dl = std::abs(px[face_axis] - lo[face_axis]);
    const double dh = std::abs(px[face_axis] - hi[face_axis]);
    if (dl <= dh) {
        if (face_axis == 0) outward.x = -1.0;
        if (face_axis == 1) outward.y = -1.0;
        if (face_axis == 2) outward.z = -1.0;
    } else {
        if (face_axis == 0) outward.x = 1.0;
        if (face_axis == 1) outward.y = 1.0;
        if (face_axis == 2) outward.z = 1.0;
    }
    hit.t = t;
    hit.point = p;
    hit.material = box.material;
    hit.geometry_id = box.geometry_id;
    orient_hit(hit, direction, outward);
    return true;
}

bool intersect_cylinder_shell(const CylinderShell& tube, const Vec3& origin,
                              const Vec3& direction, double t_min, double t_max,
                              Hit& hit) {
    bool found = false;
    double best_t = t_max;
    Hit best;

    const double ox = origin.x - tube.center.x;
    const double oz = origin.z - tube.center.z;
    const double dx = direction.x;
    const double dz = direction.z;
    const double a = dx * dx + dz * dz;
    if (a > 1e-14) {
        const double b = 2.0 * (ox * dx + oz * dz);
        const double inner_radius = tube.outer_radius - tube.wall_thickness;
        for (int side = 0; side < 2; ++side) {
            const double r = side == 0 ? tube.outer_radius : inner_radius;
            const double c = ox * ox + oz * oz - r * r;
            double t0 = 0.0;
            double t1 = 0.0;
            if (!solve_quadratic(a, b, c, t0, t1)) {
                continue;
            }
            for (double t : {t0, t1}) {
                if (t < t_min || t > best_t) {
                    continue;
                }
                const Vec3 p = origin + direction * t;
                if (p.y < tube.y_min - 1e-8 || p.y > tube.y_max + 1e-8) {
                    continue;
                }
                Vec3 radial(p.x - tube.center.x, 0.0, p.z - tube.center.z);
                radial = normalize(radial);
                if (side == 1) {
                    radial = -radial;
                }
                best_t = t;
                best = {};
                best.t = t;
                best.point = p;
                best.material = tube.material;
                best.geometry_id = tube.geometry_id;
                orient_hit(best, direction, radial);
                found = true;
            }
        }
    }

    if (std::abs(direction.y) > 1e-14) {
        const double inner_radius = tube.outer_radius - tube.wall_thickness;
        for (int cap = 0; cap < 2; ++cap) {
            const double y = cap == 0 ? tube.y_min : tube.y_max;
            const double t = (y - origin.y) / direction.y;
            if (t < t_min || t > best_t) {
                continue;
            }
            const Vec3 p = origin + direction * t;
            const double rr = (p.x - tube.center.x) * (p.x - tube.center.x) +
                              (p.z - tube.center.z) * (p.z - tube.center.z);
            if (rr < inner_radius * inner_radius ||
                rr > tube.outer_radius * tube.outer_radius) {
                continue;
            }
            const Vec3 outward(0.0, cap == 0 ? -1.0 : 1.0, 0.0);
            best_t = t;
            best = {};
            best.t = t;
            best.point = p;
            best.material = tube.material;
            best.geometry_id = tube.geometry_id;
            orient_hit(best, direction, outward);
            found = true;
        }
    }
    if (found) {
        hit = best;
    }
    return found;
}

bool intersect_emitter(const RectEmitter& emitter, const Vec3& origin,
                       const Vec3& direction, double t_min, double t_max,
                       Hit& hit) {
    const double denom = dot(direction, emitter.normal);
    if (denom >= -1e-12) {
        return false;
    }
    const double t = dot(emitter.center - origin, emitter.normal) / denom;
    if (t < t_min || t > t_max) {
        return false;
    }
    const Vec3 p = origin + direction * t;
    const Vec3 q = p - emitter.center;
    const double u = dot(q, normalize(emitter.axis_u));
    const double v = dot(q, normalize(emitter.axis_v));
    if (std::abs(u) > emitter.half_u || std::abs(v) > emitter.half_v) {
        return false;
    }
    hit.t = t;
    hit.point = p;
    hit.material = emitter.material;
    hit.geometry_id = emitter.geometry_id;
    orient_hit(hit, direction, emitter.normal);
    return true;
}

}  // namespace

bool Scene::intersect(const Vec3& origin, const Vec3& direction,
                      double t_min, double t_max, Hit& hit,
                      bool include_emitters) const {
    Hit best;
    double closest = t_max;
    Hit candidate;
    for (const Triangle& tri : triangles) {
        if (intersect_triangle(tri, origin, direction, t_min, closest, candidate) &&
            candidate.t < closest) {
            closest = candidate.t;
            best = candidate;
        }
    }
    for (const Box& box : boxes) {
        if (intersect_box(box, origin, direction, t_min, closest, candidate) &&
            candidate.t < closest) {
            closest = candidate.t;
            best = candidate;
        }
    }
    for (const CylinderShell& tube : tubes) {
        if (intersect_cylinder_shell(tube, origin, direction, t_min, closest, candidate) &&
            candidate.t < closest) {
            closest = candidate.t;
            best = candidate;
        }
    }
    if (include_emitters) {
        for (const RectEmitter& emitter : emitters) {
            if (intersect_emitter(emitter, origin, direction, t_min, closest, candidate) &&
                candidate.t < closest) {
                closest = candidate.t;
                best = candidate;
            }
        }
    }
    if (closest < t_max) {
        hit = best;
        return true;
    }
    return false;
}

bool Scene::occluded(const Vec3& origin, const Vec3& direction,
                     double t_min, double t_max) const {
    Hit hit;
    for (const Triangle& tri : triangles) {
        if (material_is_dielectric(tri.material)) {
            continue;
        }
        if (intersect_triangle(tri, origin, direction, t_min, t_max, hit)) {
            return true;
        }
    }
    for (const Box& box : boxes) {
        if (material_is_dielectric(box.material)) {
            continue;
        }
        if (intersect_box(box, origin, direction, t_min, t_max, hit)) {
            return true;
        }
    }
    for (const CylinderShell& tube : tubes) {
        if (material_is_dielectric(tube.material)) {
            continue;
        }
        if (intersect_cylinder_shell(tube, origin, direction, t_min, t_max, hit)) {
            return true;
        }
    }
    return false;
}

}  // namespace st
