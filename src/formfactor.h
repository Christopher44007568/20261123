#pragma once

#include "scene.h"

#include <cstddef>
#include <vector>

namespace rad {

struct FormFactorStats {
    double minRawRowSum = 0.0;
    double maxRawRowSum = 0.0;
    double meanRawRowSum = 0.0;
    double minNormalizedRowSum = 0.0;
    double maxNormalizedRowSum = 0.0;
    std::size_t storedEntries = 0;
    std::size_t sampleRays = 0;
    std::size_t inactiveRows = 0;
    int samplesPerAxis = 0;
};

class FormFactorMatrix {
public:
    void build(const Scene& scene, int samplesPerAxis = 2);

    std::size_t size() const { return count_; }
    double at(int from, int to) const {
        return factors_[static_cast<std::size_t>(from) * count_ + static_cast<std::size_t>(to)];
    }
    const double* row(int from) const {
        return factors_.data() + static_cast<std::size_t>(from) * count_;
    }
    const FormFactorStats& stats() const { return stats_; }

private:
    std::size_t count_ = 0;
    std::vector<double> factors_;
    FormFactorStats stats_;
};

bool patchesSeeEachOther(const Scene& scene, const Patch& from, const Patch& to,
                         const Vec3& fromPoint, const Vec3& toPoint);

}  // namespace rad
