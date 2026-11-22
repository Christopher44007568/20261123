#pragma once

#include <algorithm>
#include <cmath>
#include <limits>

namespace ocr {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kInf = std::numeric_limits<float>::infinity();
constexpr float kEpsilon = 1.0e-5f;

inline float clampf(float x, float lo, float hi) {
    return std::max(lo, std::min(hi, x));
}

inline float lerpf(float a, float b, float t) {
    return a + (b - a) * t;
}

struct Vec3 {
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;

    Vec3() = default;
    Vec3(float vx, float vy, float vz) : x(vx), y(vy), z(vz) {}

    float operator[](int axis) const {
        return axis == 0 ? x : (axis == 1 ? y : z);
    }
    float& operator[](int axis) {
        return axis == 0 ? x : (axis == 1 ? y : z);
    }
};

inline Vec3 operator+(const Vec3& a, const Vec3& b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}
inline Vec3 operator-(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}
inline Vec3 operator-(const Vec3& v) {
    return {-v.x, -v.y, -v.z};
}
inline Vec3 operator*(const Vec3& v, float s) {
    return {v.x * s, v.y * s, v.z * s};
}
inline Vec3 operator*(float s, const Vec3& v) {
    return v * s;
}
inline Vec3 operator*(const Vec3& a, const Vec3& b) {
    return {a.x * b.x, a.y * b.y, a.z * b.z};
}
inline Vec3 operator/(const Vec3& v, float s) {
    const float inv = 1.0f / s;
    return v * inv;
}
inline Vec3 operator/(const Vec3& a, const Vec3& b) {
    return {a.x / b.x, a.y / b.y, a.z / b.z};
}
inline Vec3& operator+=(Vec3& a, const Vec3& b) {
    a = a + b;
    return a;
}
inline Vec3& operator*=(Vec3& a, float s) {
    a = a * s;
    return a;
}

inline float dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}
inline Vec3 cross(const Vec3& a, const Vec3& b) {
    return {a.y * b.z - a.z * b.y,
            a.z * b.x - a.x * b.z,
            a.x * b.y - a.y * b.x};
}
inline float lengthSquared(const Vec3& v) {
    return dot(v, v);
}
inline float length(const Vec3& v) {
    return std::sqrt(lengthSquared(v));
}
inline Vec3 normalize(const Vec3& v) {
    const float len = length(v);
    return len > 0.0f ? v / len : Vec3{0.0f, 1.0f, 0.0f};
}
inline Vec3 reflect(const Vec3& incident, const Vec3& normal) {
    return incident - normal * (2.0f * dot(incident, normal));
}
inline Vec3 mix(const Vec3& a, const Vec3& b, float t) {
    return a + (b - a) * t;
}
inline Vec3 clampColor(const Vec3& c) {
    return {clampf(c.x, 0.0f, 1.0f),
            clampf(c.y, 0.0f, 1.0f),
            clampf(c.z, 0.0f, 1.0f)};
}

inline float maxComponent(const Vec3& v) {
    return std::max(v.x, std::max(v.y, v.z));
}

struct Ray {
    Vec3 origin;
    Vec3 direction;
};

struct AABB {
    Vec3 lo{kInf, kInf, kInf};
    Vec3 hi{-kInf, -kInf, -kInf};

    bool valid() const {
        return lo.x <= hi.x && lo.y <= hi.y && lo.z <= hi.z;
    }

    void include(const Vec3& p) {
        lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)};
        hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
    }

    void include(const AABB& other) {
        if (!other.valid()) {
            return;
        }
        include(other.lo);
        include(other.hi);
    }

    Vec3 center() const {
        return (lo + hi) * 0.5f;
    }

    Vec3 extent() const {
        return hi - lo;
    }

    bool intersects(const Ray& ray, float tMin, float tMax, float& tEnter) const {
        float nearT = tMin;
        float farT = tMax;
        for (int axis = 0; axis < 3; ++axis) {
            const float o = ray.origin[axis];
            const float d = ray.direction[axis];
            if (std::fabs(d) < 1.0e-9f) {
                if (o < lo[axis] || o > hi[axis]) {
                    return false;
                }
                continue;
            }
            const float inv = 1.0f / d;
            float t0 = (lo[axis] - o) * inv;
            float t1 = (hi[axis] - o) * inv;
            if (t0 > t1) {
                std::swap(t0, t1);
            }
            nearT = std::max(nearT, t0);
            farT = std::min(farT, t1);
            if (nearT > farT) {
                return false;
            }
        }
        tEnter = nearT;
        return true;
    }
};

struct Camera {
    int width = 640;
    int height = 360;
    Vec3 position{28.0f, 18.0f, 31.0f};
    Vec3 target{-1.0f, 6.0f, 0.0f};
    Vec3 up{0.0f, 1.0f, 0.0f};
    float verticalFovDegrees = 45.0f;

    Ray primaryRay(int px, int py) const {
        const Vec3 forward = normalize(target - position);
        const Vec3 right = normalize(cross(forward, up));
        const Vec3 trueUp = cross(right, forward);
        const float aspect = static_cast<float>(width) /
                             static_cast<float>(std::max(1, height));
        const float tanHalf = std::tan(verticalFovDegrees * kPi / 360.0f);
        const float sx = (2.0f * (static_cast<float>(px) + 0.5f) /
                          static_cast<float>(width) - 1.0f) * tanHalf * aspect;
        const float sy = (1.0f -
                          2.0f * (static_cast<float>(py) + 0.5f) /
                          static_cast<float>(height)) * tanHalf;
        const Vec3 direction = normalize(forward + right * sx + trueUp * sy);
        return {position, direction};
    }
};

struct ClipPlane {
    bool enabled = false;
    Vec3 normal{0.0f, 0.0f, 1.0f};
    float offset = 0.0f;

    void normalizePlane() {
        const float len = length(normal);
        if (len > 0.0f) {
            normal = normal / len;
            offset /= len;
        }
    }

    float signedDistance(const Vec3& p) const {
        return dot(normal, p) - offset;
    }

    bool kept(const Vec3& p) const {
        // The positive half-space is removed. The negative side is retained.
        return !enabled || signedDistance(p) <= 1.0e-4f;
    }
};

inline Vec3 skyColor(const Vec3& direction) {
    const float h = clampf(direction.y * 0.5f + 0.5f, 0.0f, 1.0f);
    const Vec3 horizon{0.62f, 0.74f, 0.82f};
    const Vec3 zenith{0.11f, 0.26f, 0.43f};
    Vec3 c = mix(horizon, zenith, std::pow(h, 0.7f));
    const Vec3 sunDir = normalize(Vec3{-0.45f, 0.82f, 0.36f});
    const float sun = std::pow(std::max(0.0f, dot(direction, sunDir)), 700.0f);
    return c + Vec3{1.0f, 0.82f, 0.55f} * (sun * 4.0f);
}

}  // namespace ocr
