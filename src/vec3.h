#pragma once
#include <cmath>
#include <cstdint>
#include <algorithm>

constexpr double PI = 3.14159265358979323846;
constexpr double EPS = 1e-5;

struct Vec3 {
    double x = 0, y = 0, z = 0;
    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}
    Vec3 operator+(const Vec3& o) const { return {x + o.x, y + o.y, z + o.z}; }
    Vec3 operator-(const Vec3& o) const { return {x - o.x, y - o.y, z - o.z}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3 operator*(double s) const { return {x * s, y * s, z * s}; }
    Vec3 operator*(const Vec3& o) const { return {x * o.x, y * o.y, z * o.z}; }
    Vec3 operator/(double s) const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& o) { x += o.x; y += o.y; z += o.z; return *this; }
    double dot(const Vec3& o) const { return x * o.x + y * o.y + z * o.z; }
    Vec3 cross(const Vec3& o) const {
        return {y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x};
    }
    double length() const { return std::sqrt(x * x + y * y + z * z); }
    Vec3 normalized() const { double l = length(); return l > 0 ? *this / l : Vec3(); }
    double maxComp() const { return std::max(x, std::max(y, z)); }
};

inline Vec3 reflect(const Vec3& d, const Vec3& n) { return d - n * (2.0 * d.dot(n)); }

// returns false on total internal reflection
inline bool refract(const Vec3& d, const Vec3& n, double eta, Vec3& out) {
    double cosi = -d.dot(n);
    double sin2t = eta * eta * (1.0 - cosi * cosi);
    if (sin2t > 1.0) return false;
    double cost = std::sqrt(1.0 - sin2t);
    out = d * eta + n * (eta * cosi - cost);
    return true;
}

// Schlick Fresnel, F0 for normal incidence
inline double fresnelSchlick(double cosi, double f0) {
    double m = 1.0 - std::min(1.0, std::max(0.0, cosi));
    double m5 = m * m; m5 = m5 * m5 * m;
    return f0 + (1.0 - f0) * m5;
}

struct RNG {
    uint64_t s;
    explicit RNG(uint64_t seed) : s(seed ? seed : 0x9E3779B97F4A7C15ULL) {}
    uint64_t nextU64() {
        s += 0x9E3779B97F4A7C15ULL;
        uint64_t z = s;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        return z ^ (z >> 31);
    }
    double next() { return (nextU64() >> 11) * (1.0 / 9007199254740992.0); }
    // cosine-weighted hemisphere around n
    Vec3 cosineDir(const Vec3& n) {
        double u = next(), v = next();
        double r = std::sqrt(u), phi = 2.0 * PI * v;
        Vec3 t = (std::fabs(n.x) < 0.9 ? Vec3(1, 0, 0) : Vec3(0, 1, 0)).cross(n).normalized();
        Vec3 b = n.cross(t);
        return (t * (r * std::cos(phi)) + b * (r * std::sin(phi)) + n * std::sqrt(1.0 - u)).normalized();
    }
    // uniform direction in cone around axis, cos(theta) > cosMax
    Vec3 coneDir(const Vec3& axis, double cosMax) {
        double u = next(), v = next();
        double cosT = 1.0 - u * (1.0 - cosMax);
        double sinT = std::sqrt(std::max(0.0, 1.0 - cosT * cosT));
        double phi = 2.0 * PI * v;
        Vec3 t = (std::fabs(axis.x) < 0.9 ? Vec3(1, 0, 0) : Vec3(0, 1, 0)).cross(axis).normalized();
        Vec3 b = axis.cross(t);
        return (t * (sinT * std::cos(phi)) + b * (sinT * std::sin(phi)) + axis * cosT).normalized();
    }
};
