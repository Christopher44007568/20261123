#pragma once
#include <vector>
#include <cmath>
#include "vec.h"

// Bitmap texture with a full mip pyramid (box-filtered), wrap-around addressing.
struct Texture {
    int base = 0;    // base level dimension (square, power of two)
    int levels = 0;  // number of mip levels down to 1x1
    std::vector<std::vector<Vec3>> mip;

    void init(int baseSize) {
        base = baseSize;
        levels = 0;
        while ((baseSize >> levels) > 0) levels++;
        mip.resize(levels);
        for (int l = 0; l < levels; l++) {
            int d = base >> l;
            mip[l].assign((size_t)d * d, Vec3());
        }
    }

    int dim(int l) const { return base >> l; }

    const Vec3& texel(int l, int x, int y) const {
        int d = dim(l);
        x = ((x % d) + d) % d;
        y = ((y % d) + d) % d;
        return mip[l][(size_t)y * d + x];
    }

    void setBase(int x, int y, const Vec3& c) {
        mip[0][(size_t)y * base + x] = c;
    }

    void buildMips() {
        for (int l = 1; l < levels; l++) {
            int d = dim(l);
            for (int y = 0; y < d; y++)
                for (int x = 0; x < d; x++) {
                    Vec3 s = texel(l - 1, 2 * x, 2 * y) + texel(l - 1, 2 * x + 1, 2 * y) +
                             texel(l - 1, 2 * x, 2 * y + 1) + texel(l - 1, 2 * x + 1, 2 * y + 1);
                    mip[l][(size_t)y * d + x] = s * 0.25;
                }
        }
    }

    Vec3 nearest(double u, double v) const {
        int x = (int)std::floor(u * base);
        int y = (int)std::floor(v * base);
        return texel(0, x, y);
    }

    Vec3 bilinear(int l, double u, double v) const {
        int d = dim(l);
        double fu = u * d - 0.5, fv = v * d - 0.5;
        int x0 = (int)std::floor(fu), y0 = (int)std::floor(fv);
        double tx = fu - x0, ty = fv - y0;
        Vec3 c00 = texel(l, x0, y0), c10 = texel(l, x0 + 1, y0);
        Vec3 c01 = texel(l, x0, y0 + 1), c11 = texel(l, x0 + 1, y0 + 1);
        Vec3 top = c00 * (1 - tx) + c10 * tx;
        Vec3 bot = c01 * (1 - tx) + c11 * tx;
        return top * (1 - ty) + bot * ty;
    }

    Vec3 trilinear(double u, double v, double m) const {
        m = clampd(m, 0.0, levels - 1.0);
        int l0 = (int)std::floor(m);
        int l1 = std::min(l0 + 1, levels - 1);
        double f = m - l0;
        return bilinear(l0, u, v) * (1 - f) + bilinear(l1, u, v) * f;
    }
};
