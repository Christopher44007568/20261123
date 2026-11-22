#include "formfactor.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace rad {
namespace {

constexpr double kSurfaceOffset = 2.0e-5;

Vec3 samplePoint(const Quad& quad, int iu, int iv, int samples, const Vec3& normal) {
    const double u = (static_cast<double>(iu) + 0.5) / static_cast<double>(samples);
    const double v = (static_cast<double>(iv) + 0.5) / static_cast<double>(samples);
    return quad.point(u, v) + normal * kSurfaceOffset;
}

}  // namespace

bool patchesSeeEachOther(const Scene& scene, const Patch& from, const Patch& to,
                         const Vec3& fromPoint, const Vec3& toPoint) {
    const Vec3 delta = toPoint - fromPoint;
    for (const Aabb& box : scene.occluders) {
        double tNear = 0.0;
        double tFar = 0.0;
        if (intersectAabb(fromPoint, delta, box, tNear, tFar) &&
            tNear < 1.0 - 1.0e-6 && tFar > 1.0e-6) {
            return false;
        }
    }
    (void)from;
    (void)to;
    return true;
}

void FormFactorMatrix::build(const Scene& scene, int samplesPerAxis) {
    count_ = scene.patches.size();
    samplesPerAxis = std::max(1, samplesPerAxis);
    factors_.assign(count_ * count_, 0.0);
    stats_ = FormFactorStats{};
    stats_.samplesPerAxis = samplesPerAxis;

    const int samples = samplesPerAxis;
    const double sampleCount =
        static_cast<double>(samples) * samples * samples * samples;

    for (std::size_t i = 0; i < count_; ++i) {
        const Patch& a = scene.patches[i];
        for (std::size_t j = i + 1; j < count_; ++j) {
            const Patch& b = scene.patches[j];
            double estimate = 0.0;
            for (int su = 0; su < samples; ++su) {
                for (int sv = 0; sv < samples; ++sv) {
                    const Vec3 ps = samplePoint(a.quad, su, sv, samples, a.quad.normal);
                    for (int tu = 0; tu < samples; ++tu) {
                        for (int tv = 0; tv < samples; ++tv) {
                            const Vec3 pt = samplePoint(b.quad, tu, tv, samples, b.quad.normal);
                            const Vec3 delta = pt - ps;
                            const double distance2 = dot(delta, delta);
                            if (distance2 < 1.0e-12) {
                                continue;
                            }
                            const double distance = std::sqrt(distance2);
                            const Vec3 dir = delta / distance;
                            const double cosA = dot(a.quad.normal, dir);
                            const double cosB = dot(b.quad.normal, -dir);
                            if (cosA <= 0.0 || cosB <= 0.0) {
                                continue;
                            }
                            if (!patchesSeeEachOther(scene, a, b, ps, pt)) {
                                continue;
                            }
                            estimate += cosA * cosB * b.area / (kPi * distance2);
                            ++stats_.sampleRays;
                        }
                    }
                }
            }
            estimate /= sampleCount;
            estimate = std::max(0.0, estimate);
            const double exchangedAreaTerm = estimate * a.area;
            factors_[i * count_ + j] = exchangedAreaTerm / a.area;
            factors_[j * count_ + i] = exchangedAreaTerm / b.area;
        }
    }

    double rawMin = std::numeric_limits<double>::infinity();
    double rawMax = 0.0;
    double rawSum = 0.0;
    std::size_t activeRows = 0;
    std::size_t nonZero = 0;
    for (std::size_t i = 0; i < count_; ++i) {
        double rowSum = 0.0;
        for (std::size_t j = 0; j < count_; ++j) {
            const double value = factors_[i * count_ + j];
            if (value > 1.0e-14) {
                ++nonZero;
            }
            rowSum += value;
        }
        if (rowSum > 1.0e-12) {
            rawMin = std::min(rawMin, rowSum);
            rawMax = std::max(rawMax, rowSum);
            rawSum += rowSum;
            ++activeRows;
            const double inv = 1.0 / rowSum;
            for (std::size_t j = 0; j < count_; ++j) {
                factors_[i * count_ + j] *= inv;
            }
        } else {
            ++stats_.inactiveRows;
        }
    }

    stats_.minRawRowSum = activeRows > 0 ? rawMin : 0.0;
    stats_.maxRawRowSum = rawMax;
    stats_.meanRawRowSum = activeRows > 0 ? rawSum / static_cast<double>(activeRows) : 0.0;
    stats_.storedEntries = nonZero;

    double normMin = std::numeric_limits<double>::infinity();
    double normMax = 0.0;
    for (std::size_t i = 0; i < count_; ++i) {
        double rowSum = 0.0;
        for (std::size_t j = 0; j < count_; ++j) {
            rowSum += factors_[i * count_ + j];
        }
        if (rowSum > 1.0e-12) {
            normMin = std::min(normMin, rowSum);
            normMax = std::max(normMax, rowSum);
        }
    }
    stats_.minNormalizedRowSum = std::isfinite(normMin) ? normMin : 0.0;
    stats_.maxNormalizedRowSum = normMax;
}

}  // namespace rad
