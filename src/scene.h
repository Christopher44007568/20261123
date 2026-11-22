#pragma once
#include <cmath>
#include <memory>
#include <vector>
#include "vec.h"
#include "texture.h"

inline double hash2(int x, int y) {
    unsigned h = (unsigned)x * 374761393u + (unsigned)y * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    return ((h ^ (h >> 16)) & 0xffffff) / double(0xffffff);
}

inline double smoothNoise(double u, double v, double freq) {
    double fu = u * freq, fv = v * freq;
    int x0 = (int)std::floor(fu), y0 = (int)std::floor(fv);
    double tx = fu - x0, ty = fv - y0;
    tx = tx * tx * (3 - 2 * tx);
    ty = ty * ty * (3 - 2 * ty);
    double a = hash2(x0, y0), b = hash2(x0 + 1, y0);
    double c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

// High-density rock strata: warped fine bands plus grain speckle.
inline Vec3 rockStrata(double u, double v) {
    double warp = 0.35 * smoothNoise(u, v, 6.0) + 0.12 * smoothNoise(u, v, 18.0);
    double band = std::sin((v + warp * 0.15) * 150.0);
    double t = 0.5 + 0.5 * band;
    t = t * t * (3 - 2 * t);
    Vec3 dark(0.32, 0.27, 0.22), light(0.78, 0.70, 0.58);
    Vec3 c = dark * (1 - t) + light * t;
    double grain = hash2((int)(u * 512), (int)(v * 512));
    return c * (0.85 + 0.3 * grain);
}

// Far-wall fine print: rows of glyph-like cells, deliberately near-Nyquist.
inline Vec3 fineText(double u, double v) {
    int row = (int)std::floor(v * 64.0);
    double inRow = v * 64.0 - row;
    Vec3 paper(0.82, 0.80, 0.74), ink(0.12, 0.11, 0.10);
    if (inRow < 0.25 || inRow > 0.8) return paper;
    int cell = (int)std::floor(u * 110.0);
    double inCell = u * 110.0 - cell;
    if (inCell < 0.12 || inCell > 0.9) return paper;
    double h = hash2(cell, row);
    int seg = (int)std::floor(inRow * 3.0);
    bool on = hash2(cell * 3 + seg, row * 7) < 0.55 + 0.2 * h;
    return on ? ink : paper;
}

// Museum placard: border plus a few medium-frequency text bars.
inline Vec3 placard(double u, double v) {
    Vec3 paper(0.88, 0.86, 0.80), ink(0.15, 0.13, 0.12);
    if (u < 0.04 || u > 0.96 || v < 0.05 || v > 0.95) return ink;
    for (int i = 0; i < 4; i++) {
        double y0 = 0.18 + i * 0.18;
        if (v > y0 && v < y0 + 0.07) {
            double len = 0.5 + 0.35 * hash2(i, 99);
            if (u > 0.1 && u < 0.1 + len) {
                int cell = (int)std::floor(u * 40.0);
                if (hash2(cell, i * 31) < 0.7) return ink;
            }
        }
    }
    return paper;
}

// Ore sample: mottled mineral with bright crystals.
inline Vec3 ore(double u, double v) {
    double n = 0.6 * smoothNoise(u, v, 8.0) + 0.3 * smoothNoise(u, v, 24.0) +
               0.1 * smoothNoise(u, v, 64.0);
    Vec3 base(0.30, 0.26, 0.30), vein(0.62, 0.55, 0.38);
    double m = 0.5 + 0.5 * std::sin(n * 14.0);
    Vec3 c = base * (1 - m * 0.6) + vein * (m * 0.6);
    if (hash2((int)(u * 256), (int)(v * 256)) > 0.985) c = Vec3(0.95, 0.92, 0.80);
    return c;
}

struct Hit {
    double t = 1e30;
    Vec3 p, n;
    double u = 0, v = 0;
    int tex = -1, obj = -1;
};

struct Geom {
    int tex = 0, obj = 0;
    virtual ~Geom() = default;
    virtual bool intersect(const Ray& r, Hit& h) const = 0;
};

// Plane with a tangent frame; optional rectangular uv bounds for quads.
struct PlaneGeom : Geom {
    Vec3 p0, n, eu, ev;
    double su = 1, sv = 1;
    bool bounded = false;
    double umin = 0, umax = 0, vmin = 0, vmax = 0;
    PlaneGeom(Vec3 p0_, Vec3 n_, Vec3 eu_, double su_, double sv_)
        : p0(p0_), n(n_.normalized()), eu(eu_.normalized()), su(su_), sv(sv_) {
        ev = n.cross(eu).normalized();
    }
    bool intersect(const Ray& r, Hit& h) const override {
        double dn = r.d.dot(n);
        if (std::fabs(dn) < 1e-12) return false;
        double t = (p0 - r.o).dot(n) / dn;
        if (t < 1e-6 || t >= h.t) return false;
        Vec3 p = r.at(t);
        double u = (p - p0).dot(eu) * su;
        double v = (p - p0).dot(ev) * sv;
        if (bounded && (u < umin || u > umax || v < vmin || v > vmax)) return false;
        h.t = t; h.p = p; h.n = n; h.u = u; h.v = v;
        h.tex = tex; h.obj = obj;
        return true;
    }
};

// Vertical cylinder section: the curved glass display case.
struct CylinderGeom : Geom {
    double cx = 0, cz = 0, r = 1, y0 = 0, y1 = 1;
    double uRepeat = 4.0, sv = 1.0;
    bool intersect(const Ray& ray, Hit& h) const override {
        double ox = ray.o.x - cx, oz = ray.o.z - cz;
        double a = ray.d.x * ray.d.x + ray.d.z * ray.d.z;
        if (a < 1e-14) return false;
        double b = 2 * (ox * ray.d.x + oz * ray.d.z);
        double c = ox * ox + oz * oz - r * r;
        double disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        double sq = std::sqrt(disc);
        for (double t : {(-b - sq) / (2 * a), (-b + sq) / (2 * a)}) {
            if (t < 1e-6 || t >= h.t) continue;
            Vec3 p = ray.at(t);
            if (p.y < y0 || p.y > y1) continue;
            double theta = std::atan2(p.z - cz, p.x - cx);
            h.t = t; h.p = p;
            h.n = Vec3(p.x - cx, 0, p.z - cz) / r;
            h.u = theta / (2 * M_PI) * uRepeat;
            h.v = (p.y - y0) * sv;
            h.tex = tex; h.obj = obj;
            return true;
        }
        return false;
    }
};

struct SphereGeom : Geom {
    Vec3 c;
    double r = 1;
    bool intersect(const Ray& ray, Hit& h) const override {
        Vec3 oc = ray.o - c;
        double b = oc.dot(ray.d);
        double cc = oc.dot(oc) - r * r;
        double disc = b * b - cc;
        if (disc < 0) return false;
        double t = -b - std::sqrt(disc);
        if (t < 1e-6 || t >= h.t) return false;
        Vec3 p = ray.at(t);
        Vec3 n = (p - c) / r;
        h.t = t; h.p = p; h.n = n;
        h.u = (std::atan2(n.z, n.x) + M_PI) / (2 * M_PI) * 2.0;
        h.v = std::acos(clampd(n.y, -1.0, 1.0)) / M_PI;
        h.tex = tex; h.obj = obj;
        return true;
    }
};

enum TexId { TEX_ROCK = 0, TEX_TEXT = 1, TEX_PLACARD = 2, TEX_ORE = 3 };
enum ObjId { OBJ_FLOOR = 0, OBJ_CASE = 1, OBJ_WALL = 2, OBJ_ORE = 3, OBJ_LABEL = 4 };

struct Scene {
    std::vector<Texture> textures;
    std::vector<std::unique_ptr<Geom>> geoms;

    bool intersect(const Ray& r, Hit& h) const {
        bool any = false;
        for (auto& g : geoms) any |= g->intersect(r, h);
        return any;
    }
};

inline Scene buildScene(int texSize) {
    Scene s;
    s.textures.resize(4);
    for (int t = 0; t < 4; t++) s.textures[t].init(texSize);
    for (int y = 0; y < texSize; y++)
        for (int x = 0; x < texSize; x++) {
            double u = (x + 0.5) / texSize, v = (y + 0.5) / texSize;
            s.textures[TEX_ROCK].setBase(x, y, rockStrata(u, v));
            s.textures[TEX_TEXT].setBase(x, y, fineText(u, v));
            s.textures[TEX_PLACARD].setBase(x, y, placard(u, v));
            s.textures[TEX_ORE].setBase(x, y, ore(u, v));
        }
    for (int t = 0; t < 4; t++) s.textures[t].buildMips();

    // Tilted ground plane, rock strata, grazing view from a low camera.
    auto floor_ = std::make_unique<PlaneGeom>(Vec3(0, 0, 0), Vec3(0, 1, 0.10),
                                              Vec3(1, 0, 0), 0.35, 0.35);
    floor_->tex = TEX_ROCK; floor_->obj = OBJ_FLOOR;
    s.geoms.push_back(std::move(floor_));

    // Curved glass display case (cylinder) carrying the same rock texture.
    auto case_ = std::make_unique<CylinderGeom>();
    case_->cx = 1.6; case_->cz = 6.5; case_->r = 1.1;
    case_->y0 = 0.0; case_->y1 = 1.6; case_->uRepeat = 5.0; case_->sv = 1.2;
    case_->tex = TEX_ROCK; case_->obj = OBJ_CASE;
    s.geoms.push_back(std::move(case_));

    // Far wall with fine print texture.
    auto wall = std::make_unique<PlaneGeom>(Vec3(0, 1.5, 14.0), Vec3(0, 0, -1),
                                            Vec3(1, 0, 0), 0.22, 0.22);
    wall->tex = TEX_TEXT; wall->obj = OBJ_WALL;
    s.geoms.push_back(std::move(wall));

    // Near ore sample on a pedestal-height position beside the camera path.
    auto oreBall = std::make_unique<SphereGeom>();
    oreBall->c = Vec3(-0.9, 0.55, 3.2); oreBall->r = 0.45;
    oreBall->tex = TEX_ORE; oreBall->obj = OBJ_ORE;
    s.geoms.push_back(std::move(oreBall));

    // Small placard next to the ore.
    auto label = std::make_unique<PlaneGeom>(Vec3(-0.9, 0.25, 2.55), Vec3(0, 0.35, -1),
                                             Vec3(1, 0, 0), 1.0, 1.0);
    label->bounded = true;
    label->umin = -0.35; label->umax = 0.35; label->vmin = -0.18; label->vmax = 0.18;
    label->tex = TEX_PLACARD; label->obj = OBJ_LABEL;
    s.geoms.push_back(std::move(label));

    return s;
}
