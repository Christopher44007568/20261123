#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace st {

constexpr double kPi = 3.14159265358979323846;
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr double kEps = 1e-7;

struct Vec3 {
    double x = 0.0;
    double y = 0.0;
    double z = 0.0;

    Vec3() = default;
    Vec3(double x_, double y_, double z_) : x(x_), y(y_), z(z_) {}

    Vec3& operator+=(const Vec3& rhs) {
        x += rhs.x;
        y += rhs.y;
        z += rhs.z;
        return *this;
    }
    Vec3& operator-=(const Vec3& rhs) {
        x -= rhs.x;
        y -= rhs.y;
        z -= rhs.z;
        return *this;
    }
    Vec3& operator*=(double s) {
        x *= s;
        y *= s;
        z *= s;
        return *this;
    }
    Vec3& operator/=(double s) {
        const double inv = 1.0 / s;
        x *= inv;
        y *= inv;
        z *= inv;
        return *this;
    }
};

inline Vec3 operator+(Vec3 a, const Vec3& b) { return a += b; }
inline Vec3 operator-(Vec3 a, const Vec3& b) { return a -= b; }
inline Vec3 operator-(const Vec3& v) { return Vec3(-v.x, -v.y, -v.z); }
inline Vec3 operator*(Vec3 v, double s) { return v *= s; }
inline Vec3 operator*(double s, Vec3 v) { return v *= s; }
inline Vec3 operator/(Vec3 v, double s) { return v /= s; }
inline Vec3 operator*(const Vec3& a, const Vec3& b) {
    return Vec3(a.x * b.x, a.y * b.y, a.z * b.z);
}

inline double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return Vec3(a.y * b.z - a.z * b.y,
                a.z * b.x - a.x * b.z,
                a.x * b.y - a.y * b.x);
}
inline double length2(const Vec3& v) { return dot(v, v); }
inline double length(const Vec3& v) { return std::sqrt(length2(v)); }
inline Vec3 normalize(const Vec3& v) {
    const double len = length(v);
    return len > 0.0 ? v / len : Vec3(0.0, 1.0, 0.0);
}
inline Vec3 reflect_dir(const Vec3& incident, const Vec3& normal) {
    return incident - 2.0 * dot(incident, normal) * normal;
}
inline bool same_hemisphere(const Vec3& a, const Vec3& b) {
    return dot(a, b) > 0.0;
}

inline Vec3 exp_neg(const Vec3& v) {
    return Vec3(std::exp(-v.x), std::exp(-v.y), std::exp(-v.z));
}

inline double clamp(double x, double lo, double hi) {
    return std::max(lo, std::min(hi, x));
}
inline double saturate(double x) { return clamp(x, 0.0, 1.0); }

struct Rng {
    std::uint64_t state;

    explicit Rng(std::uint64_t seed = 0x9e3779b97f4a7c15ULL) : state(seed ? seed : 1) {}

    std::uint64_t next_u64() {
        state += 0x9e3779b97f4a7c15ULL;
        std::uint64_t z = state;
        z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
        z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
        return z ^ (z >> 31);
    }

    double next() {
        return static_cast<double>(next_u64() >> 11) * (1.0 / 9007199254740992.0);
    }

    double uniform(double lo, double hi) { return lo + (hi - lo) * next(); }
};

inline std::uint64_t hash_u64(std::uint64_t x) {
    x += 0x9e3779b97f4a7c15ULL;
    x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
    x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
    return x ^ (x >> 31);
}

inline std::uint64_t hash_combine(std::uint64_t a, std::uint64_t b) {
    return hash_u64(a ^ (b + 0x9e3779b97f4a7c15ULL + (a << 6) + (a >> 2)));
}

struct OrthoBasis {
    Vec3 u;
    Vec3 v;
    Vec3 w;
};

inline OrthoBasis make_basis(const Vec3& n) {
    const Vec3 w = normalize(n);
    const Vec3 helper = std::abs(w.x) > 0.35 ? Vec3(0.0, 1.0, 0.0) : Vec3(1.0, 0.0, 0.0);
    const Vec3 u = normalize(cross(helper, w));
    const Vec3 v = cross(w, u);
    return {u, v, w};
}

inline Vec3 sample_cosine_hemisphere(const Vec3& normal, Rng& rng) {
    const double u1 = rng.next();
    const double u2 = rng.next();
    const double r = std::sqrt(u1);
    const double phi = 2.0 * kPi * u2;
    const OrthoBasis basis = make_basis(normal);
    return normalize(basis.u * (r * std::cos(phi)) +
                     basis.v * (r * std::sin(phi)) +
                     basis.w * std::sqrt(std::max(0.0, 1.0 - u1)));
}

inline Vec3 sample_cone(const Vec3& axis, double half_angle, Rng& rng) {
    const double cos_max = std::cos(half_angle);
    const double u1 = rng.next();
    const double u2 = rng.next();
    const double cos_theta = 1.0 - u1 * (1.0 - cos_max);
    const double sin_theta = std::sqrt(std::max(0.0, 1.0 - cos_theta * cos_theta));
    const double phi = 2.0 * kPi * u2;
    const OrthoBasis basis = make_basis(axis);
    return normalize(basis.u * (sin_theta * std::cos(phi)) +
                     basis.v * (sin_theta * std::sin(phi)) +
                     basis.w * cos_theta);
}

inline void concentric_disk(double u1, double u2, double& dx, double& dy) {
    const double a = 2.0 * u1 - 1.0;
    const double b = 2.0 * u2 - 1.0;
    if (a == 0.0 && b == 0.0) {
        dx = 0.0;
        dy = 0.0;
        return;
    }
    double r;
    double phi;
    if (std::abs(a) > std::abs(b)) {
        r = a;
        phi = (kPi * 0.25) * (b / a);
    } else {
        r = b;
        phi = (kPi * 0.5) - (kPi * 0.25) * (a / b);
    }
    dx = r * std::cos(phi);
    dy = r * std::sin(phi);
}

inline bool solve_quadratic(double a, double b, double c, double& t0, double& t1) {
    if (std::abs(a) < 1e-14) {
        if (std::abs(b) < 1e-14) {
            return false;
        }
        t0 = t1 = -c / b;
        return true;
    }
    const double disc = b * b - 4.0 * a * c;
    if (disc < 0.0) {
        return false;
    }
    const double root = std::sqrt(std::max(0.0, disc));
    const double q = -0.5 * (b + (b >= 0.0 ? root : -root));
    t0 = q / a;
    t1 = c / q;
    if (t0 > t1) {
        std::swap(t0, t1);
    }
    return true;
}

}  // namespace st
