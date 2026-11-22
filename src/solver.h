#pragma once

#include "formfactor.h"
#include "scene.h"

#include <cstddef>
#include <vector>

namespace rad {

struct SolverOptions {
    double tolerance = 2.0e-6;
    int maxIterations = 50000;
};

struct EnergySample {
    int iteration = 0;
    double absorbed = 0.0;
    double unshot = 0.0;
    double conserved = 0.0;
    double drift = 0.0;
};

struct EnergyReport {
    double emittedPower = 0.0;
    double absorbedPower = 0.0;
    double unshotPower = 0.0;
    double conservedPower = 0.0;
    double finalResidual = 0.0;
    double maxConservationDrift = 0.0;
    double finalPatchError = 0.0;
    int iterations = 0;
    int initialEmitterShots = 0;
    int equivalentSweeps = 0;
    std::vector<EnergySample> trace;
};

struct ContactProbe {
    std::string name;
    int patchCount = 0;
    double maxDirectFormFactor = 0.0;
    double unoccludedFraction = 0.0;
    bool passed = false;
};

struct ContactReport {
    std::vector<ContactProbe> probes;
    bool passed = true;
};

struct ColorBleedReport {
    int redEmitterPatches = 0;
    double redEmitterPower = 0.0;
    double maxWallRedBias = 0.0;
    double meanNearWallRedBias = 0.0;
    double maxNearWallRedBias = 0.0;
    int nearWallPatches = 0;
    int maxPatch = -1;
    Vec3 maxLocation;
    double maxDistanceToLamp = 0.0;
    double indirectRedBoost = 0.0;
};

struct RadiosityResult {
    std::vector<Patch> firstPass;
    std::vector<Patch> converged;
    EnergyReport energy;
    ContactReport contact;
    ColorBleedReport colorBleed;
    bool convergedToTolerance = false;
};

class ProgressiveSolver {
public:
    ProgressiveSolver(const Scene& scene, const FormFactorMatrix& formFactors);

    RadiosityResult solve(const SolverOptions& options) const;

private:
    const Scene& scene_;
    const FormFactorMatrix& ff_;

    std::vector<Patch> directPass() const;
    ContactReport probeContacts(const std::vector<Patch>& firstPass) const;
    ColorBleedReport analyzeColorBleed(const std::vector<Patch>& firstPass,
                                       const std::vector<Patch>& converged) const;
};

double rgbPower(const Rgb& value);
double patchPower(const Rgb& value, double area);

}  // namespace rad
