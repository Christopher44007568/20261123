#pragma once
#include <cmath>
#include <vector>
#include "vec.h"
#include "scene.h"

struct Camera {
    Vec3 pos, fwd, right, up;
    double tanHalf = 0, aspect = 1;
    int w = 0, h = 0;

    static Camera lookAt(Vec3 pos, Vec3 target, double fovYDeg, int w, int h) {
        Camera c;
        c.pos = pos;
        c.w = w; c.h = h;
        c.fwd = (target - pos).normalized();
        c.right = c.fwd.cross(Vec3(0, 1, 0)).normalized();
        c.up = c.right.cross(c.fwd).normalized();
        c.tanHalf = std::tan(fovYDeg * M_PI / 360.0);
        c.aspect = (double)w / h;
        return c;
    }

    // (ox, oy) are sub-pixel offsets in pixel units.
    Ray ray(double i, double j, double ox = 0.5, double oy = 0.5) const {
        double nx = ((i + ox) / w * 2.0 - 1.0) * tanHalf * aspect;
        double ny = (1.0 - (j + oy) / h * 2.0) * tanHalf;
        return {pos, (fwd + right * nx + up * ny).normalized()};
    }
};

enum Mode { MODE_POINT = 0, MODE_FIXED = 1, MODE_RAYDIFF = 2 };

struct Stats {
    long rays = 0;          // primary pixels processed in raydiff mode
    long extreme = 0;       // grazing / curvature / degenerate clamped rays
    long missNeighbor = 0;  // neighbor ray left the surface (edge / curvature)
    long ratioClamp = 0;    // anisotropy ratio clamped
    long mipClampLo = 0;    // magnification clamp (mip < 0)
    long mipClampHi = 0;    // ran out of pyramid
    long degenerate = 0;    // texture coordinate degeneracy
    double sumMip = 0, sumRatio = 0;
};

struct Footprint {
    double dudx = 0, dvdx = 0, dudy = 0, dvdy = 0;
    bool valid = false;
};

// Ray differentials from adjacent pixels: transfer neighbor-ray hit uv
// differences onto the center hit. Invalid when a neighbor ray leaves the
// surface (silhouette, strong curvature) or uv degenerates.
inline Footprint computeFootprint(const Scene& scene, const Camera& cam,
                                  int i, int j, const Hit& h0, Stats& st) {
    Footprint fp;
    Hit hx, hy;
    bool okx = scene.intersect(cam.ray(i + 1.0, j, 0.5, 0.5), hx) && hx.obj == h0.obj;
    bool oky = scene.intersect(cam.ray(i, j + 1.0, 0.5, 0.5), hy) && hy.obj == h0.obj;
    if (!okx || !oky) {
        st.missNeighbor++;
        st.extreme++;
        return fp;
    }
    fp.dudx = hx.u - h0.u; fp.dvdx = hx.v - h0.v;
    fp.dudy = hy.u - h0.u; fp.dvdy = hy.v - h0.v;
    double ax = fp.dudx, ay = fp.dvdx, bx = fp.dudy, by = fp.dvdy;
    double area = std::fabs(ax * by - ay * bx);
    double maxComp = std::max(std::max(std::fabs(ax), std::fabs(ay)),
                              std::max(std::fabs(bx), std::fabs(by)));
    if (area < 1e-20 || maxComp < 1e-14) {
        st.degenerate++;
        st.extreme++;
        return fp;
    }
    fp.valid = true;
    return fp;
}

// Anisotropic sample: mip from minor axis, line samples along major axis.
inline Vec3 sampleRayDiff(const Texture& tex, double u, double v,
                          const Footprint& fp, Stats& st) {
    if (!fp.valid) return tex.trilinear(u, v, 0.0);
    int W = tex.base, H = tex.base;
    double ax = fp.dudx * W, ay = fp.dvdx * H;
    double bx = fp.dudy * W, by = fp.dvdy * H;
    double lenA = std::hypot(ax, ay), lenB = std::hypot(bx, by);
    double major = std::max(lenA, lenB), minor = std::min(lenA, lenB);
    const double maxAniso = 16.0;
    double ratio = major / minor;
    if (ratio > maxAniso) {
        ratio = maxAniso;
        st.ratioClamp++;
        st.extreme++;
    }
    double mipRaw = std::log2(minor);
    double mip = mipRaw;
    if (mip < 0) { mip = 0; st.mipClampLo++; }
    if (mip > tex.levels - 1.0) { mip = tex.levels - 1.0; st.mipClampHi++; st.extreme++; }
    st.sumMip += mip;
    st.sumRatio += ratio;

    // Major-axis direction in uv, rescaled to the clamped ratio.
    double mdx = fp.dudx, mdy = fp.dvdx;
    if (lenB > lenA) { mdx = fp.dudy; mdy = fp.dvdy; }
    double mlen = std::hypot(mdx * W, mdy * H);
    if (mlen < 1e-12) return tex.trilinear(u, v, mip);
    double target = minor * ratio / W;
    double scale = target / (mlen / W);
    mdx *= scale; mdy *= scale;

    int n = std::min((int)std::ceil(ratio), 8);
    if (n <= 1) return tex.trilinear(u, v, mip);
    Vec3 sum;
    for (int k = 0; k < n; k++) {
        double f = (k + 0.5) / n - 0.5;
        sum += tex.trilinear(u + mdx * f, v + mdy * f, mip);
    }
    return sum / n;
}

inline Vec3 shade(const Hit& h, const Vec3& albedo) {
    static const Vec3 lightDir = Vec3(-0.4, 0.8, -0.45).normalized();
    double diff = std::max(0.0, h.n.dot(lightDir));
    return albedo * (0.25 + 0.75 * diff);
}

struct Image {
    int w, h;
    std::vector<Vec3> px;
    Image(int w_, int h_) : w(w_), h(h_), px((size_t)w_ * h_) {}
    Vec3& at(int x, int y) { return px[(size_t)y * w + x]; }
    const Vec3& at(int x, int y) const { return px[(size_t)y * w + x]; }
};

// One sample per pixel with the chosen filtering mode.
inline Image render(const Scene& scene, const Camera& cam, Mode mode,
                    double fixedMip, Stats& st, std::vector<int>* objMap = nullptr) {
    Image img(cam.w, cam.h);
    if (objMap) objMap->assign((size_t)cam.w * cam.h, -1);
    for (int j = 0; j < cam.h; j++)
        for (int i = 0; i < cam.w; i++) {
            Hit h;
            Vec3 c(0.05, 0.06, 0.08);
            if (scene.intersect(cam.ray(i, j), h)) {
                if (objMap) (*objMap)[(size_t)j * cam.w + i] = h.obj;
                const Texture& tex = scene.textures[h.tex];
                Vec3 alb;
                if (mode == MODE_POINT) {
                    alb = tex.nearest(h.u, h.v);
                } else if (mode == MODE_FIXED) {
                    alb = tex.trilinear(h.u, h.v, fixedMip);
                } else {
                    st.rays++;
                    Footprint fp = computeFootprint(scene, cam, i, j, h, st);
                    alb = sampleRayDiff(tex, h.u, h.v, fp, st);
                }
                c = shade(h, alb);
            }
            img.at(i, j) = c;
        }
    return img;
}

// High-sampled area-average reference: supersampled point sampling.
inline Image renderReference(const Scene& scene, const Camera& cam, int spp) {
    Image img(cam.w, cam.h);
    for (int j = 0; j < cam.h; j++)
        for (int i = 0; i < cam.w; i++) {
            Vec3 sum;
            for (int sy = 0; sy < spp; sy++)
                for (int sx = 0; sx < spp; sx++) {
                    double ox = (sx + hash2(i * 31 + sx, j * 17 + sy)) / spp;
                    double oy = (sy + hash2(i * 13 + sy, j * 7 + sx)) / spp;
                    Hit h;
                    if (scene.intersect(cam.ray(i, j, ox, oy), h))
                        sum += shade(h, scene.textures[h.tex].nearest(h.u, h.v));
                    else
                        sum += Vec3(0.05, 0.06, 0.08);
                }
            img.at(i, j) = sum / (spp * spp);
        }
    return img;
}
