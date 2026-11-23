#pragma once
#include "vec3.h"
#include <vector>
#include <memory>

enum class MatType { Diffuse, Dielectric };

struct Material {
    MatType type = MatType::Diffuse;
    Vec3 albedo{0.8, 0.8, 0.8};
    double gloss = 0.0;   // 0 = pure diffuse look, 1 = glossy (drives photon filter radius)
    double ior = 1.33;
    Vec3 Le{0, 0, 0};     // emission
};

struct Hit {
    double t = 1e30;
    Vec3 p, n;
    int mat = -1;
};

struct Prim {
    int mat = 0;
    virtual ~Prim() = default;
    virtual bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const = 0;
};

// plane with normal n, offset d0 (n.p = d0), clipped to an AABB
struct RectPlane : Prim {
    Vec3 n, bmin, bmax;
    double d0;
    RectPlane(const Vec3& n_, double d0_, const Vec3& mn, const Vec3& mx)
        : n(n_.normalized()), bmin(mn), bmax(mx), d0(d0_) {}
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double dn = d.dot(n);
        if (std::fabs(dn) < 1e-12) return false;
        double t = (d0 - o.dot(n)) / dn;
        if (t < tmin || t > tmax) return false;
        Vec3 p = o + d * t;
        if (p.x < bmin.x - 1e-9 || p.x > bmax.x + 1e-9) return false;
        if (p.y < bmin.y - 1e-9 || p.y > bmax.y + 1e-9) return false;
        if (p.z < bmin.z - 1e-9 || p.z > bmax.z + 1e-9) return false;
        h.t = t; h.p = p; h.n = dn < 0 ? n : -n; h.mat = mat;
        return true;
    }
};

// axis-aligned box (grate slats, pool curbs)
struct BoxAB : Prim {
    Vec3 bmin, bmax;
    BoxAB(const Vec3& mn, const Vec3& mx) : bmin(mn), bmax(mx) {}
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double t0 = tmin, t1 = tmax;
        int axis = -1; double sign = 1;
        const double oa[3] = {o.x, o.y, o.z}, da[3] = {d.x, d.y, d.z};
        const double mn[3] = {bmin.x, bmin.y, bmin.z}, mx[3] = {bmax.x, bmax.y, bmax.z};
        for (int i = 0; i < 3; i++) {
            double inv = 1.0 / da[i];
            double ta = (mn[i] - oa[i]) * inv, tb = (mx[i] - oa[i]) * inv;
            double s = -1.0;
            if (ta > tb) { std::swap(ta, tb); s = 1.0; }
            if (ta > t0) { t0 = ta; axis = i; sign = s; }
            t1 = std::min(t1, tb);
            if (t0 > t1) return false;
        }
        if (axis < 0) return false;
        h.t = t0; h.p = o + d * t0; h.n = Vec3(); h.mat = mat;
        if (axis == 0) h.n = Vec3(sign, 0, 0);
        if (axis == 1) h.n = Vec3(0, sign, 0);
        if (axis == 2) h.n = Vec3(0, 0, sign);
        return true;
    }
};

// vertical cylinder segment (curved chamber wall), axis parallel to y through (cx, cz)
struct CylSeg : Prim {
    double cx, cz, R, y0, y1, halfX;
    CylSeg(double cx_, double cz_, double R_, double y0_, double y1_, double halfX_)
        : cx(cx_), cz(cz_), R(R_), y0(y0_), y1(y1_), halfX(halfX_) {}
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double ox = o.x - cx, oz = o.z - cz;
        double a = d.x * d.x + d.z * d.z;
        if (a < 1e-12) return false;
        double b = 2.0 * (ox * d.x + oz * d.z);
        double c = ox * ox + oz * oz - R * R;
        double disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        double sq = std::sqrt(disc);
        for (double t : {( -b - sq) / (2 * a), (-b + sq) / (2 * a)}) {
            if (t < tmin || t > tmax) continue;
            Vec3 p = o + d * t;
            if (p.y < y0 || p.y > y1) continue;
            if (std::fabs(p.x - cx) > halfX) continue;
            Vec3 n = Vec3(p.x - cx, 0, p.z - cz).normalized();
            if (n.dot(d) > 0) n = -n;
            h.t = t; h.p = p; h.n = n; h.mat = mat;
            return true;
        }
        return false;
    }
};

// bent pipe: tube of radius r swept along a circular arc in a plane parallel to XY.
// arc center a, radius R, angles [th0, th1]. Exact distance to clamped arc -> sphere traced.
struct ArcPipe : Prim {
    Vec3 a;      // arc center (z fixed: ring lies in plane z = a.z)
    double R, r, th0, th1;
    ArcPipe(const Vec3& a_, double R_, double r_, double th0_, double th1_)
        : a(a_), R(R_), r(r_), th0(th0_), th1(th1_) {}
    double sdf(const Vec3& p) const {
        double px = p.x - a.x, py = p.y - a.y;
        double th = std::atan2(py, px);
        th = std::max(th0, std::min(th1, th));
        Vec3 c(a.x + R * std::cos(th), a.y + R * std::sin(th), a.z);
        return (p - c).length() - r;
    }
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double t = std::max(tmin, 1e-4);
        for (int i = 0; i < 256 && t < tmax; i++) {
            Vec3 p = o + d * t;
            double dist = sdf(p);
            if (dist < 1e-4) {
                Vec3 n = (p - Vec3(a.x + R * std::cos(std::max(th0, std::min(th1, std::atan2(p.y - a.y, p.x - a.x)))),
                                   a.y + R * std::sin(std::max(th0, std::min(th1, std::atan2(p.y - a.y, p.x - a.x)))),
                                   a.z)).normalized();
                if (n.dot(d) > 0) n = -n;
                h.t = t; h.p = p; h.n = n; h.mat = mat;
                return true;
            }
            t += dist * 0.9;
        }
        return false;
    }
};

// planar parallelogram (used for the tilted light panel)
struct Rect : Prim {
    Vec3 corner, u, v, n;
    Rect(const Vec3& c, const Vec3& u_, const Vec3& v_) : corner(c), u(u_), v(v_) {
        n = u.cross(v).normalized();
    }
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double dn = d.dot(n);
        if (std::fabs(dn) < 1e-12) return false;
        double t = (corner - o).dot(n) / dn;
        if (t < tmin || t > tmax) return false;
        Vec3 p = o + d * t - corner;
        double uu = u.dot(u), vv = v.dot(v), uv = u.dot(v);
        double pu = p.dot(u), pv = p.dot(v);
        double det = uu * vv - uv * uv;
        double s = (pu * vv - pv * uv) / det, q = (pv * uu - pu * uv) / det;
        if (s < 0 || s > 1 || q < 0 || q > 1) return false;
        h.t = t; h.p = o + d * t; h.n = dn < 0 ? n : -n; h.mat = mat;
        return true;
    }
};

// wavy water sheet: y = base + height(x,z), clipped to rect, two-sided dielectric
struct WaterSheet : Prim {
    double base, x0, x1, z0, z1;
    WaterSheet(double b, double x0_, double x1_, double z0_, double z1_)
        : base(b), x0(x0_), x1(x1_), z0(z0_), z1(z1_) {}
    static double hfn(double x, double z) {
        return 0.063 * std::sin(2.3 * x + 1.1) * std::cos(1.9 * z - 0.4)
             + 0.042 * std::sin(3.7 * x - 2.6 * z + 0.8)
             + 0.025 * std::cos(5.1 * z + 1.7 * x);
    }
    double height(double x, double z) const { return base + hfn(x, z); }
    Vec3 normalAt(double x, double z) const {
        double e = 1e-3;
        double dx = (hfn(x + e, z) - hfn(x - e, z)) / (2 * e);
        double dz = (hfn(x, z + e) - hfn(x, z - e)) / (2 * e);
        return Vec3(-dx, 1.0, -dz).normalized();
    }
    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const override {
        double t = std::max(tmin, 1e-4);
        double fPrev = 0;
        bool first = true;
        double tPrev = t;
        for (int i = 0; i < 200 && t < tmax; i++) {
            Vec3 p = o + d * t;
            if (p.x < x0 - 0.3 || p.x > x1 + 0.3 || p.z < z0 - 0.3 || p.z > z1 + 0.3) {
                t += 0.05; first = true; continue;
            }
            double f = p.y - height(p.x, p.z);
            if (!first && f * fPrev < 0) {
                double lo = tPrev, hi = t;
                for (int k = 0; k < 24; k++) {
                    double mid = 0.5 * (lo + hi);
                    Vec3 pm = o + d * mid;
                    ((pm.y - height(pm.x, pm.z)) * fPrev < 0 ? hi : lo) = mid;
                }
                double th = 0.5 * (lo + hi);
                Vec3 ph = o + d * th;
                if (ph.x < x0 || ph.x > x1 || ph.z < z0 || ph.z > z1) return false;
                Vec3 n = normalAt(ph.x, ph.z);
                if (n.dot(d) > 0) n = -n;
                h.t = th; h.p = ph; h.n = n; h.mat = mat;
                return true;
            }
            fPrev = f; first = false; tPrev = t;
            t += std::max(0.015, std::fabs(f) * 0.5);
        }
        return false;
    }
};

struct Light {
    Vec3 corner, u, v, n;  // rectangle: corner + s*u + t*v, s,t in [0,1]
    Vec3 Le{0, 0, 0};
    double area() const { return u.cross(v).length(); }
    Vec3 sample(RNG& rng) const { return corner + u * rng.next() + v * rng.next(); }
};

struct Scene {
    std::vector<std::unique_ptr<Prim>> prims;
    std::vector<Material> mats;
    Light light;
    int lightPrim = -1;

    bool intersect(const Vec3& o, const Vec3& d, double tmin, double tmax, Hit& h) const {
        bool any = false;
        for (const auto& p : prims)
            if (p->intersect(o, d, tmin, tmax, h)) { tmax = h.t; any = true; }
        return any;
    }
    bool occluded(const Vec3& a, const Vec3& b) const {
        Vec3 d = b - a;
        double dist = d.length();
        Hit h;
        return intersect(a + d / dist * EPS, d / dist, EPS, dist - 1e-4, h);
    }
};

// Underground seawater sluice chamber. All geometry is generated in code.
inline Scene buildSluiceScene() {
    Scene sc;
    auto addMat = [&](Material m) { sc.mats.push_back(m); return (int)sc.mats.size() - 1; };
    auto add = [&](Prim* p, int m) { p->mat = m; sc.prims.emplace_back(p); return (int)sc.prims.size() - 1; };

    Material concrete{MatType::Diffuse, {0.42, 0.44, 0.42}, 0.0, 1.33, {0, 0, 0}};
    Material dampWall{MatType::Diffuse, {0.34, 0.38, 0.36}, 0.05, 1.33, {0, 0, 0}};
    Material basinMat{MatType::Diffuse, {0.50, 0.54, 0.49}, 0.0, 1.33, {0, 0, 0}};
    Material pipeMat{MatType::Diffuse, {0.70, 0.72, 0.74}, 0.85, 1.33, {0, 0, 0}};
    Material grateMat{MatType::Diffuse, {0.10, 0.10, 0.11}, 0.3, 1.33, {0, 0, 0}};
    Material waterMat{MatType::Dielectric, {0.985, 0.995, 1.0}, 0.0, 1.33, {0, 0, 0}};
    Material lightMat{MatType::Diffuse, {0, 0, 0}, 0.0, 1.33, {28.0, 28.4, 28.8}};

    int mConcrete = addMat(concrete), mDamp = addMat(dampWall), mBasin = addMat(basinMat);
    int mPipe = addMat(pipeMat), mGrate = addMat(grateMat), mWater = addMat(waterMat);
    int mLight = addMat(lightMat);

    const double X = 4.5, Z = 4.5, H = 5.0;
    // room floor / ceiling / side walls
    add(new RectPlane({0, 1, 0}, 0, {-X, -0.1, -Z}, {X, 0.1, Z}), mConcrete);
    add(new RectPlane({0, -1, 0}, -H, {-X, H - 0.1, -Z}, {X, H + 0.1, Z}), mConcrete);
    add(new RectPlane({1, 0, 0}, -X, {-X - 0.1, 0, -Z}, {-X + 0.1, H, Z}), mDamp);
    add(new RectPlane({-1, 0, 0}, -X, {X - 0.1, 0, -Z}, {X + 0.1, H, Z}), mDamp);
    add(new RectPlane({0, 0, -1}, -Z, {-X, 0, Z - 0.1}, {X, H, Z + 0.1}), mDamp);
    // concave curved back wall (cylinder segment)
    add(new CylSeg(0, -9.5, 6.0, 0.0, H, 3.6), mDamp);
    // pool basin floor (receives refracted caustics) and curbs
    add(new RectPlane({0, 1, 0}, 0.05, {-2.6, 0, -2.2}, {2.6, 0.1, 2.2}), mBasin);
    add(new BoxAB({-2.75, 0, -2.35}, {-2.6, 0.16, 2.35}), mConcrete);
    add(new BoxAB({2.6, 0, -2.35}, {2.75, 0.16, 2.35}), mConcrete);
    add(new BoxAB({-2.75, 0, -2.35}, {2.75, 0.16, -2.2}), mConcrete);
    add(new BoxAB({-2.75, 0, 2.2}, {2.75, 0.16, 2.35}), mConcrete);
    // wavy water surface
    add(new WaterSheet(0.9, -2.6, 2.6, -2.2, 2.2), mWater);
    // bent pipe elbow mounted in front of the curved wall, right side
    add(new ArcPipe({2.0, 2.9, -3.2}, 0.95, 0.24, 0.0, 1.9), mPipe);
    // metal grate: slats along z, spaced along x, at y = 3.0
    for (int i = 0; i < 9; i++) {
        double x = -2.0 + i * 0.5;
        add(new BoxAB({x - 0.07, 2.96, -2.2}, {x + 0.07, 3.04, 2.2}), mGrate);
    }
    // baffle slab: blocks direct light toward the curved wall so the wall is
    // lit mainly by water caustics and indirect light
    add(new BoxAB({-X, 3.15, -Z}, {X, 3.30, 1.0}), mConcrete);
    // tilted light panel aimed at the far edge of the pool, so that beams
    // crossing the grate reflect off the wavy water onto the curved wall
    Vec3 lc(0.0, 3.8, 2.6), target(0.0, 0.9, -1.0);
    Vec3 ldir = (target - lc).normalized();
    Vec3 lu(3.6, 0, 0);
    Vec3 lv = ldir.cross(lu).normalized() * 2.4;
    sc.light.corner = lc - lu * 0.5 - lv * 0.5;
    sc.light.u = lu;
    sc.light.v = lv;
    sc.light.n = ldir;
    sc.light.Le = sc.mats[mLight].Le;
    sc.lightPrim = add(new Rect(sc.light.corner, lu, lv), mLight);
    return sc;
}
