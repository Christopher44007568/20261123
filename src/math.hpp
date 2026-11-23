#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace ds {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kInf = std::numeric_limits<float>::infinity();
constexpr float kEps = 1.0e-5f;

struct Vec2 {
    float x = 0.0f;
    float y = 0.0f;
};

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    Vec3 operator+(const Vec3& b) const { return {x + b.x, y + b.y, z + b.z}; }
    Vec3 operator-(const Vec3& b) const { return {x - b.x, y - b.y, z - b.z}; }
    Vec3 operator-() const { return {-x, -y, -z}; }
    Vec3 operator*(float s) const { return {x * s, y * s, z * s}; }
    Vec3 operator/(float s) const { return {x / s, y / s, z / s}; }
    Vec3& operator+=(const Vec3& b) {
        x += b.x;
        y += b.y;
        z += b.z;
        return *this;
    }
    Vec3& operator*=(float s) {
        x *= s;
        y *= s;
        z *= s;
        return *this;
    }
};

inline Vec3 operator*(float s, const Vec3& v) { return v * s; }
inline Vec3 operator*(const Vec3& a, const Vec3& b) {
    return {a.x * b.x, a.y * b.y, a.z * b.z};
}
inline Vec3 operator/(const Vec3& a, const Vec3& b) {
    return {a.x / b.x, a.y / b.y, a.z / b.z};
}

inline float dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    };
}

inline float lengthSq(const Vec3& v) { return dot(v, v); }
inline float length(const Vec3& v) { return std::sqrt(lengthSq(v)); }

inline Vec3 normalize(const Vec3& v) {
    const float len = length(v);
    return len > 1.0e-20f ? v / len : Vec3{0.0f, 0.0f, 0.0f};
}

inline Vec3 lerp(const Vec3& a, const Vec3& b, float t) {
    return a * (1.0f - t) + b * t;
}

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }
inline float saturate(float v) { return std::clamp(v, 0.0f, 1.0f); }
inline float smoothstep(float e0, float e1, float x) {
    const float t = saturate((x - e0) / (e1 - e0));
    return t * t * (3.0f - 2.0f * t);
}

inline Vec3 reflect(const Vec3& incident, const Vec3& normal) {
    return incident - normal * (2.0f * dot(incident, normal));
}

inline float luminance(const Vec3& c) {
    return 0.2126f * c.x + 0.7152f * c.y + 0.0722f * c.z;
}

inline Vec3 expVec(const Vec3& v) {
    return {std::exp(v.x), std::exp(v.y), std::exp(v.z)};
}

inline float degToRad(float degrees) { return degrees * (kPi / 180.0f); }

inline uint32_t hash32(uint32_t x) {
    x ^= x >> 16;
    x *= 0x7feb352du;
    x ^= x >> 15;
    x *= 0x846ca68bu;
    x ^= x >> 16;
    return x;
}

inline float hashToUnit(uint32_t x) {
    return static_cast<float>(hash32(x) & 0x00ffffffu) / 16777215.0f;
}

struct Ray {
    Vec3 origin;
    Vec3 direction;

    Vec3 at(float t) const { return origin + direction * t; }
};

struct Basis {
    Vec3 right;
    Vec3 up;
    Vec3 forward;

    static Basis fromForward(const Vec3& forward, const Vec3& worldUp) {
        Basis basis;
        basis.forward = normalize(forward);
        basis.right = normalize(cross(basis.forward, worldUp));
        basis.up = cross(basis.right, basis.forward);
        return basis;
    }
};

struct Camera {
    Vec3 position;
    Vec3 target;
    Vec3 up{0.0f, 1.0f, 0.0f};
    float verticalFov = degToRad(48.0f);
    float aspect = 1.0f;

    Ray ray(float sx, float sy) const {
        const Basis b = Basis::fromForward(target - position, up);
        const float tanHalf = std::tan(verticalFov * 0.5f);
        const Vec3 dir = normalize(
            b.forward + b.right * (sx * tanHalf * aspect) + b.up * (sy * tanHalf));
        return {position, dir};
    }
};

struct LightCamera {
    Vec3 position;
    Vec3 target;
    Vec3 up{0.0f, 1.0f, 0.0f};
    float verticalFov = degToRad(62.0f);
    float aspect = 1.0f;

    Basis basis() const { return Basis::fromForward(target - position, up); }

    Ray ray(float sx, float sy) const {
        const Basis b = basis();
        const float tanHalf = std::tan(verticalFov * 0.5f);
        const Vec3 dir = normalize(
            b.forward + b.right * (sx * tanHalf * aspect) + b.up * (sy * tanHalf));
        return {position, dir};
    }

    bool project(const Vec3& p, Vec2& uv, float& depth) const {
        const Basis b = basis();
        const Vec3 rel = p - position;
        const float axialDepth = dot(rel, b.forward);
        if (axialDepth <= 1.0e-4f) {
            return false;
        }
        depth = length(rel);
        const float tanHalf = std::tan(verticalFov * 0.5f);
        uv.x = 0.5f +
               dot(rel, b.right) / (2.0f * axialDepth * tanHalf * aspect);
        uv.y = 0.5f -
               dot(rel, b.up) / (2.0f * axialDepth * tanHalf);
        return true;
    }
};

}  // namespace ds
