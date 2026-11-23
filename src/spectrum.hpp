#pragma once

#include "vec3.hpp"

#include <array>
#include <cmath>
#include <cstddef>

namespace st {

constexpr int kBandCount = 16;
constexpr double kBandLo = 400.0;
constexpr double kBandHi = 720.0;
constexpr double kBandWidth = (kBandHi - kBandLo) / static_cast<double>(kBandCount);

struct SpectralBand {
    int index = 0;
    double lo = 0.0;
    double hi = 0.0;
    double center = 0.0;

    double sample(double u01) const {
        return lo + kBandWidth * saturate(u01);
    }
};

inline const std::array<SpectralBand, kBandCount>& bands() {
    static const std::array<SpectralBand, kBandCount> data = [] {
        std::array<SpectralBand, kBandCount> result{};
        for (int i = 0; i < kBandCount; ++i) {
            result[static_cast<std::size_t>(i)] = {
                i,
                kBandLo + kBandWidth * static_cast<double>(i),
                kBandLo + kBandWidth * static_cast<double>(i + 1),
                kBandLo + kBandWidth * (static_cast<double>(i) + 0.5)
            };
        }
        return result;
    }();
    return data;
}

inline double spectral_band_weight() {
    return 1.0 / static_cast<double>(kBandCount);
}

inline int hero_band_index(int sample_index, std::uint64_t pixel_hash) {
    const int offset = static_cast<int>(pixel_hash % static_cast<std::uint64_t>(kBandCount));
    return (sample_index + offset) % kBandCount;
}

inline double prism_ior(double lambda_nm) {
    const double um = lambda_nm * 1e-3;
    const double inv2 = 1.0 / (um * um);
    return 1.2050 + 0.1085 * inv2;
}

inline double tube_glass_ior(double lambda_nm) {
    const double um = lambda_nm * 1e-3;
    const double inv2 = 1.0 / (um * um);
    return 1.5000 + 0.0048 * inv2;
}

inline double water_ior(double lambda_nm) {
    const double um = lambda_nm * 1e-3;
    const double inv2 = 1.0 / (um * um);
    return 1.3240 + 0.0034 * inv2;
}

inline double air_ior() { return 1.000277; }

inline double dielectric_fresnel(double cos_i, double n_i, double n_t) {
    cos_i = clamp(cos_i, 0.0, 1.0);
    const double eta = n_i / n_t;
    const double sin_t2 = eta * eta * std::max(0.0, 1.0 - cos_i * cos_i);
    if (sin_t2 >= 1.0) {
        return 1.0;
    }
    const double cos_t = std::sqrt(std::max(0.0, 1.0 - sin_t2));
    const double rs = (n_i * cos_i - n_t * cos_t) /
                      (n_i * cos_i + n_t * cos_t);
    const double rp = (n_t * cos_i - n_i * cos_t) /
                      (n_t * cos_i + n_i * cos_t);
    return clamp(0.5 * (rs * rs + rp * rp), 0.0, 1.0);
}

struct Complex {
    double re = 0.0;
    double im = 0.0;
};

inline Complex c_mul(const Complex& a, const Complex& b) {
    return {a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re};
}

inline Complex c_div(const Complex& a, const Complex& b) {
    const double denom = b.re * b.re + b.im * b.im;
    return {(a.re * b.re + a.im * b.im) / denom,
            (a.im * b.re - a.re * b.im) / denom};
}

inline Complex c_sqrt(const Complex& z) {
    const double r = std::hypot(z.re, z.im);
    const double re = std::sqrt(std::max(0.0, 0.5 * (r + z.re)));
    double im = std::sqrt(std::max(0.0, 0.5 * (r - z.re)));
    if (z.im < 0.0) {
        im = -im;
    }
    return {re, im};
}

struct BrassIor {
    double n = 0.0;
    double k = 0.0;
};

inline BrassIor brass_ior(double lambda_nm) {
    struct Point {
        double lambda;
        double n;
        double k;
    };
    static constexpr std::array<Point, 7> table{{
        {400.0, 1.46, 1.80},
        {450.0, 1.12, 2.05},
        {500.0, 0.86, 2.28},
        {550.0, 0.68, 2.52},
        {600.0, 0.54, 2.76},
        {660.0, 0.43, 3.06},
        {720.0, 0.37, 3.25}
    }};
    if (lambda_nm <= table.front().lambda) {
        return {table.front().n, table.front().k};
    }
    if (lambda_nm >= table.back().lambda) {
        return {table.back().n, table.back().k};
    }
    for (std::size_t i = 1; i < table.size(); ++i) {
        if (lambda_nm <= table[i].lambda) {
            const Point& a = table[i - 1];
            const Point& b = table[i];
            const double t = (lambda_nm - a.lambda) / (b.lambda - a.lambda);
            return {a.n + (b.n - a.n) * t, a.k + (b.k - a.k) * t};
        }
    }
    return {table.back().n, table.back().k};
}

inline double conductor_fresnel(double cos_i, double n_metal, double k_metal) {
    cos_i = clamp(cos_i, 0.0, 1.0);
    const double sin_i2 = std::max(0.0, 1.0 - cos_i * cos_i);
    const Complex eta{n_metal, k_metal};
    const Complex eta2 = c_mul(eta, eta);
    const Complex sin_t2 = c_div({sin_i2, 0.0}, eta2);
    const Complex cos_t = c_sqrt({1.0 - sin_t2.re, -sin_t2.im});
    const Complex rs = c_div({cos_i - eta.re * cos_t.re, -eta.im * cos_t.re},
                             {cos_i + eta.re * cos_t.re, eta.im * cos_t.re});
    const Complex rp = c_div({eta.re * cos_i - cos_t.re, eta.im * cos_i},
                             {eta.re * cos_i + cos_t.re, eta.im * cos_i});
    const double fs = rs.re * rs.re + rs.im * rs.im;
    const double fp = rp.re * rp.re + rp.im * rp.im;
    return clamp(0.5 * (fs + fp), 0.0, 1.0);
}

inline Vec3 water_absorption(double lambda_nm) {
    const double t = saturate((lambda_nm - 400.0) / 320.0);
    return Vec3(0.004 + 0.070 * t, 0.006 + 0.022 * t, 0.006 + 0.006 * t);
}

inline Vec3 prism_absorption(double lambda_nm) {
    const double t = saturate((lambda_nm - 400.0) / 320.0);
    return Vec3(0.008, 0.006, 0.010 + 0.005 * t);
}

inline double cie_x(double w) {
    const double t1 = (w - 442.0) * (w < 442.0 ? 0.0624 : 0.0374);
    const double t2 = (w - 599.8) * (w < 599.8 ? 0.0264 : 0.0323);
    const double t3 = (w - 501.1) * (w < 501.1 ? 0.0490 : 0.0382);
    return 0.362 * std::exp(-0.5 * t1 * t1) +
           1.056 * std::exp(-0.5 * t2 * t2) -
           0.065 * std::exp(-0.5 * t3 * t3);
}

inline double cie_y(double w) {
    const double t1 = (w - 568.8) * (w < 568.8 ? 0.0213 : 0.0247);
    const double t2 = (w - 530.9) * (w < 530.9 ? 0.0613 : 0.0322);
    return 0.821 * std::exp(-0.5 * t1 * t1) +
           0.286 * std::exp(-0.5 * t2 * t2);
}

inline double cie_z(double w) {
    const double t1 = (w - 437.0) * (w < 437.0 ? 0.0845 : 0.0278);
    const double t2 = (w - 459.0) * (w < 459.0 ? 0.0385 : 0.0725);
    return 1.217 * std::exp(-0.5 * t1 * t1) +
           0.681 * std::exp(-0.5 * t2 * t2);
}

inline Vec3 xyz_to_linear_srgb(const Vec3& xyz) {
    return Vec3(
        3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
        -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
        0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z);
}

inline Vec3 equal_energy_white_srgb() {
    static const Vec3 white = [] {
        Vec3 xyz(0.0, 0.0, 0.0);
        for (const SpectralBand& band : bands()) {
            xyz += Vec3(cie_x(band.center), cie_y(band.center), cie_z(band.center)) * kBandWidth;
        }
        return xyz_to_linear_srgb(xyz);
    }();
    return white;
}

inline Vec3 spectrum_to_linear_srgb(const std::array<double, kBandCount>& band_radiance) {
    Vec3 xyz(0.0, 0.0, 0.0);
    for (int i = 0; i < kBandCount; ++i) {
        const double lambda = bands()[static_cast<std::size_t>(i)].center;
        const double value = band_radiance[static_cast<std::size_t>(i)] * kBandWidth;
        xyz += Vec3(cie_x(lambda), cie_y(lambda), cie_z(lambda)) * value;
    }
    Vec3 rgb = xyz_to_linear_srgb(xyz);
    const Vec3 white = equal_energy_white_srgb();
    rgb.x /= std::max(white.x, 1e-12);
    rgb.y /= std::max(white.y, 1e-12);
    rgb.z /= std::max(white.z, 1e-12);
    return rgb;
}

struct RgbApproxPrimary {
    double lambda;
    int channel;
};

inline const std::array<RgbApproxPrimary, 3>& rgb_primaries() {
    static const std::array<RgbApproxPrimary, 3> primaries{{
        {620.0, 0},
        {545.0, 1},
        {460.0, 2}
    }};
    return primaries;
}

}  // namespace st
