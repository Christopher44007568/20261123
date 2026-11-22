#pragma once

#include <algorithm>
#include <cmath>
#include <limits>

namespace rad {

constexpr double kEpsilon = 1.0e-8;
constexpr double kPi = 3.14159265358979323846;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    Vec3 operator+(const Vec3& other) const { return {x + other.x, y + other.y, z + other.z}; }
    Vec3 operator-(const Vec3& other) const { return {x - other.x, y - other.y, z - other.z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(double s) const { return {x / s, y / s, z / s}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3& operator+=(const Vec3& other) {
        x += other.x;
        y += other.y;
        z += other.z;
        return *this;
    }
};

inline double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}

inline double length(const Vec3& v) { return std::sqrt(dot(v, v)); }

inline Vec3 normalized(const Vec3& v) {
    const double len = length(v);
    return len > kEpsilon ? v / len : Vec3{};
}

inline Vec3 mix(const Vec3& a, const Vec3& b, double t) {
    return a * (1.0 - t) + b * t;
}

struct Rgb {
    double r = 0.0;
    double g = 0.0;
    double b = 0.0;

    Rgb() = default;
    Rgb(double r_, double g_, double b_) : r(r_), g(g_), b(b_) {}

    Rgb operator+(const Rgb& other) const { return {r + other.r, g + other.g, b + other.b}; }
    Rgb operator-(const Rgb& other) const { return {r - other.r, g - other.g, b - other.b}; }
    Rgb operator*(double s) const { return {r * s, g * s, b * s}; }
    Rgb operator*(const Rgb& other) const { return {r * other.r, g * other.g, b * other.b}; }
    Rgb operator/(double s) const { return {r / s, g / s, b / s}; }
    Rgb& operator+=(const Rgb& other) {
        r += other.r;
        g += other.g;
        b += other.b;
        return *this;
    }
};

inline double maxChannel(const Rgb& c) { return std::max(c.r, std::max(c.g, c.b)); }
inline double luminance(const Rgb& c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

inline Rgb clamp01(const Rgb& c) {
    return {std::clamp(c.r, 0.0, 1.0),
            std::clamp(c.g, 0.0, 1.0),
            std::clamp(c.b, 0.0, 1.0)};
}

struct Aabb {
    Vec3 lo;
    Vec3 hi;

    Aabb() = default;
    Aabb(const Vec3& lo_, const Vec3& hi_) : lo(lo_), hi(hi_) {}
};

inline bool intersectAabb(const Vec3& origin, const Vec3& dir,
                          const Aabb& box, double& tNear, double& tFar) {
    tNear = 0.0;
    tFar = std::numeric_limits<double>::infinity();
    for (int axis = 0; axis < 3; ++axis) {
        const double o = axis == 0 ? origin.x : (axis == 1 ? origin.y : origin.z);
        const double d = axis == 0 ? dir.x : (axis == 1 ? dir.y : dir.z);
        const double lo = axis == 0 ? box.lo.x : (axis == 1 ? box.lo.y : box.lo.z);
        const double hi = axis == 0 ? box.hi.x : (axis == 1 ? box.hi.y : box.hi.z);
        if (std::abs(d) < 1.0e-14) {
            if (o < lo || o > hi) {
                return false;
            }
            continue;
        }
        double t0 = (lo - o) / d;
        double t1 = (hi - o) / d;
        if (t0 > t1) {
            std::swap(t0, t1);
        }
        tNear = std::max(tNear, t0);
        tFar = std::min(tFar, t1);
        if (tNear > tFar) {
            return false;
        }
    }
    return tFar > kEpsilon && tNear < 1.0;
}

inline bool intersectAabbRay(const Vec3& origin, const Vec3& dir,
                             const Aabb& box, double maxDistance,
                             double& tEnter) {
    double tNear = 0.0;
    double tFar = maxDistance;
    for (int axis = 0; axis < 3; ++axis) {
        const double o = axis == 0 ? origin.x : (axis == 1 ? origin.y : origin.z);
        const double d = axis == 0 ? dir.x : (axis == 1 ? dir.y : dir.z);
        const double lo = axis == 0 ? box.lo.x : (axis == 1 ? box.lo.y : box.lo.z);
        const double hi = axis == 0 ? box.hi.x : (axis == 1 ? box.hi.y : box.hi.z);
        if (std::abs(d) < 1.0e-14) {
            if (o < lo || o > hi) {
                return false;
            }
            continue;
        }
        double t0 = (lo - o) / d;
        double t1 = (hi - o) / d;
        if (t0 > t1) {
            std::swap(t0, t1);
        }
        tNear = std::max(tNear, t0);
        tFar = std::min(tFar, t1);
        if (tNear > tFar) {
            return false;
        }
    }
    tEnter = tNear;
    return tFar >= 0.0;
}

}  // namespace rad
