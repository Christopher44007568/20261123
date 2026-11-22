#include "solver.h"

#include <algorithm>
#include <cmath>
#include <limits>
#include <queue>
#include <stdexcept>

namespace rad {
namespace {

struct QueueEntry {
    double power = 0.0;
    int patch = -1;
};

struct QueueLess {
    bool operator()(const QueueEntry& a, const QueueEntry& b) const {
        return a.power < b.power;
    }
};

double distanceTo(const Vec3& a, const Vec3& b) {
    return length(a - b);
}

bool inside(double value, double lo, double hi) {
    return value >= lo && value <= hi;
}

Aabb patchBounds(const Patch& patch) {
    Vec3 lo = patch.quad.p0;
    Vec3 hi = patch.quad.p0;
    for (int corner = 1; corner < 4; ++corner) {
        const double u = (corner == 1 || corner == 2) ? 1.0 : 0.0;
        const double v = (corner == 2 || corner == 3) ? 1.0 : 0.0;
        const Vec3 p = patch.quad.point(u, v);
        lo.x = std::min(lo.x, p.x);
        lo.y = std::min(lo.y, p.y);
        lo.z = std::min(lo.z, p.z);
        hi.x = std::max(hi.x, p.x);
        hi.y = std::max(hi.y, p.y);
        hi.z = std::max(hi.z, p.z);
    }
    return {lo, hi};
}

}  // namespace

double rgbPower(const Rgb& value) {
    return (value.r + value.g + value.b) / 3.0;
}

double patchPower(const Rgb& value, double area) {
    return rgbPower(value) * area;
}

ProgressiveSolver::ProgressiveSolver(const Scene& scene,
                                     const FormFactorMatrix& formFactors)
    : scene_(scene), ff_(formFactors) {}

std::vector<Patch> ProgressiveSolver::directPass() const {
    std::vector<Patch> state = scene_.patches;
    for (Patch& patch : state) {
        patch.arrived = {};
        patch.unshot = {};
        patch.direct = patch.emission;
    }

    for (std::size_t i = 0; i < state.size(); ++i) {
        if (!state[i].isEmitter()) {
            continue;
        }
        const double* row = ff_.row(static_cast<int>(i));
        for (std::size_t j = 0; j < state.size(); ++j) {
            if (i == j) {
                continue;
            }
            const double areaRatio = state[i].area / state[j].area;
            state[j].arrived += state[i].emission * row[j] * areaRatio;
        }
    }

    for (Patch& patch : state) {
        patch.direct = patch.radiosity();
        patch.unshot = patch.color * patch.arrived;
    }
    return state;
}

RadiosityResult ProgressiveSolver::solve(const SolverOptions& options) const {
    RadiosityResult result;
    result.firstPass = directPass();

    std::vector<Patch> state = scene_.patches;
    EnergyReport& energy = result.energy;
    std::vector<int> initialEmitters;

    for (Patch& patch : state) {
        patch.arrived = {};
        patch.unshot = patch.emission;
        patch.direct = patch.emission;
        energy.emittedPower += patchPower(patch.emission, patch.area);
        if (patch.isEmitter()) {
            initialEmitters.push_back(patch.id);
        }
    }
    energy.unshotPower = energy.emittedPower;

    std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueLess> queue;
    const double powerFloor = std::max(1.0e-14, energy.emittedPower * 1.0e-12);
    auto pushIfUseful = [&](int patchId) {
        const double p = patchPower(state[static_cast<std::size_t>(patchId)].unshot,
                                    state[static_cast<std::size_t>(patchId)].area);
        if (p > powerFloor) {
            queue.push({p, patchId});
        }
    };
    auto rebuildQueue = [&]() {
        std::priority_queue<QueueEntry, std::vector<QueueEntry>, QueueLess> empty;
        queue.swap(empty);
        for (std::size_t i = 0; i < state.size(); ++i) {
            pushIfUseful(static_cast<int>(i));
        }
    };

    auto shoot = [&](int patchId) {
        Patch& source = state[static_cast<std::size_t>(patchId)];
        const Rgb shot = source.unshot;
        if (rgbPower(shot) <= 0.0) {
            return;
        }
        source.unshot = {};
        const double shotPower = patchPower(shot, source.area);
        double absorbedNow = 0.0;
        double reflectedNow = 0.0;
        const double* row = ff_.row(patchId);
        const double sourceArea = source.area;

        for (std::size_t j = 0; j < state.size(); ++j) {
            if (j == static_cast<std::size_t>(patchId) || row[j] <= 0.0) {
                continue;
            }
            Patch& target = state[j];
            const Rgb received = shot * (row[j] * sourceArea / target.area);
            const Rgb reflected = received * target.color;
            target.arrived += received;
            target.unshot += reflected;

            const Rgb absorbed = received - reflected;
            absorbedNow += patchPower(absorbed, target.area);
            reflectedNow += patchPower(reflected, target.area);
            if (patchPower(reflected, target.area) > powerFloor) {
                queue.push({patchPower(reflected, target.area), static_cast<int>(j)});
            }
        }

        energy.absorbedPower += absorbedNow;
        energy.unshotPower += reflectedNow - shotPower;
        energy.unshotPower = std::max(0.0, energy.unshotPower);
        ++energy.iterations;

        const double conserved = energy.absorbedPower + energy.unshotPower;
        const double drift = std::abs(conserved - energy.emittedPower) /
                             std::max(energy.emittedPower, 1.0e-15);
        energy.maxConservationDrift = std::max(energy.maxConservationDrift, drift);
        energy.trace.push_back({energy.iterations, energy.absorbedPower,
                                energy.unshotPower, conserved, drift});
    };

    std::sort(initialEmitters.begin(), initialEmitters.end(),
              [&](int a, int b) {
                  return patchPower(state[static_cast<std::size_t>(a)].unshot,
                                    state[static_cast<std::size_t>(a)].area) >
                         patchPower(state[static_cast<std::size_t>(b)].unshot,
                                    state[static_cast<std::size_t>(b)].area);
              });

    for (int id : initialEmitters) {
        if (energy.iterations >= options.maxIterations) {
            break;
        }
        shoot(id);
        ++energy.initialEmitterShots;
    }

    rebuildQueue();

    while (!queue.empty() && energy.iterations < options.maxIterations) {
        const QueueEntry entry = queue.top();
        queue.pop();
        const Patch& current = state[static_cast<std::size_t>(entry.patch)];
        const double currentPower = patchPower(current.unshot, current.area);
        if (currentPower <= powerFloor) {
            continue;
        }
        if (entry.power > currentPower * 1.000001 + 1.0e-14) {
            continue;
        }
        shoot(entry.patch);
        if (queue.size() > state.size() * 4) {
            rebuildQueue();
        }
        const double residual = energy.unshotPower /
                                std::max(energy.emittedPower, 1.0e-15);
        if (residual <= options.tolerance) {
            break;
        }
    }

    energy.finalResidual = energy.unshotPower /
                           std::max(energy.emittedPower, 1.0e-15);
    energy.conservedPower = energy.absorbedPower + energy.unshotPower;
    energy.equivalentSweeps =
        state.empty() ? 0 : energy.iterations / static_cast<int>(state.size());
    result.convergedToTolerance = energy.finalResidual <= options.tolerance;

    double maxPatchError = 0.0;
    for (const Patch& patch : state) {
        maxPatchError = std::max(maxPatchError,
                                 patchPower(patch.unshot, patch.area) /
                                     std::max(energy.emittedPower, 1.0e-15));
    }
    energy.finalPatchError = maxPatchError;
    result.converged = std::move(state);
    result.contact = probeContacts(result.firstPass);
    result.colorBleed = analyzeColorBleed(result.firstPass, result.converged);
    return result;
}

ContactReport ProgressiveSolver::probeContacts(
    const std::vector<Patch>& firstPass) const {
    (void)firstPass;
    ContactReport report;
    struct ProbeDef {
        const char* name;
        bool (*matches)(const Patch&);
    };

    const ProbeDef definitions[] = {
        {"floor_under_console", [](const Patch& p) {
             const Aabb b = patchBounds(p);
             return p.material == MaterialId::Floor &&
                    inside(b.lo.x, 3.599, 5.451) && inside(b.hi.x, 3.599, 5.451) &&
                    inside(b.lo.y, 1.699, 2.421) && inside(b.hi.y, 1.699, 2.421);
         }},
        {"wall_behind_shelf", [](const Patch& p) {
             const Aabb b = patchBounds(p);
             return p.material == MaterialId::WhiteWall && b.lo.y > 5.19 &&
                    inside(b.lo.x, 0.50, 1.50) && inside(b.hi.x, 0.50, 1.50) &&
                    inside(b.lo.z, 0.05, 1.79) && inside(b.hi.z, 0.05, 1.79);
         }},
        {"wall_behind_left_cabinet", [](const Patch& p) {
             const Aabb b = patchBounds(p);
             return p.material == MaterialId::WhiteWall && b.hi.x < 0.01 &&
                    inside(b.lo.y, 3.50, 4.40) && inside(b.hi.y, 3.50, 4.40) &&
                    inside(b.lo.z, 0.03, 1.32) && inside(b.hi.z, 0.03, 1.32);
         }},
    };

    std::vector<int> emitters;
    for (const Patch& patch : scene_.patches) {
        if (patch.isEmitter()) {
            emitters.push_back(patch.id);
        }
    }

    for (const ProbeDef& definition : definitions) {
        ContactProbe probe;
        probe.name = definition.name;
        int visiblePairs = 0;
        int totalPairs = 0;
        for (std::size_t i = 0; i < scene_.patches.size(); ++i) {
            if (!definition.matches(scene_.patches[i])) {
                continue;
            }
            ++probe.patchCount;
            for (int emitter : emitters) {
                ++totalPairs;
                const double f = ff_.at(emitter, static_cast<int>(i));
                probe.maxDirectFormFactor = std::max(probe.maxDirectFormFactor, f);
                if (f > 1.0e-10) {
                    ++visiblePairs;
                }
            }
        }
        probe.unoccludedFraction =
            totalPairs > 0 ? static_cast<double>(visiblePairs) / totalPairs : 0.0;
        probe.passed = probe.maxDirectFormFactor <= 1.0e-9;
        report.passed = report.passed && probe.passed;
        report.probes.push_back(probe);
    }
    return report;
}

ColorBleedReport ProgressiveSolver::analyzeColorBleed(
    const std::vector<Patch>& firstPass,
    const std::vector<Patch>& converged) const {
    ColorBleedReport report;
    Vec3 lampCenter;
    int lampCount = 0;
    for (const Patch& patch : scene_.patches) {
        if (patch.material != MaterialId::RedEquipmentLamp) {
            continue;
        }
        lampCenter += patch.quad.center();
        ++lampCount;
        ++report.redEmitterPatches;
        report.redEmitterPower += patchPower(patch.emission, patch.area);
    }
    if (lampCount > 0) {
        lampCenter = lampCenter / static_cast<double>(lampCount);
    }

    double nearSum = 0.0;
    double indirectSum = 0.0;
    for (std::size_t i = 0; i < converged.size(); ++i) {
        const Patch& patch = converged[i];
        if (patch.material != MaterialId::WhiteWall) {
            continue;
        }
        const Rgb rad = patch.radiosity();
        if (luminance(rad) <= 1.0e-9) {
            continue;
        }
        const double denominator = std::max(std::abs(rad.r) + std::abs(rad.g) + 1.0e-12,
                                            1.0e-12);
        const double bias = std::max(0.0, (rad.r - 0.5 * (rad.g + rad.b)) / denominator);
        if (bias > report.maxWallRedBias) {
            report.maxWallRedBias = bias;
            report.maxPatch = static_cast<int>(i);
            report.maxLocation = patch.quad.center();
            report.maxDistanceToLamp = distanceTo(report.maxLocation, lampCenter);
        }

        const double distance = distanceTo(patch.quad.center(), lampCenter);
        if (distance <= 2.6) {
            ++report.nearWallPatches;
            nearSum += bias;
            report.maxNearWallRedBias = std::max(report.maxNearWallRedBias, bias);

            const Rgb before = firstPass[i].radiosity();
            const double beforeDenom =
                std::max(std::abs(before.r) + std::abs(before.g) + 1.0e-12, 1.0e-12);
            const double beforeBias =
                std::max(0.0, (before.r - 0.5 * (before.g + before.b)) / beforeDenom);
            indirectSum += std::max(0.0, bias - beforeBias);
        }
    }
    if (report.nearWallPatches > 0) {
        report.meanNearWallRedBias = nearSum / report.nearWallPatches;
        report.indirectRedBoost = indirectSum / report.nearWallPatches;
    }
    return report;
}

}  // namespace rad
