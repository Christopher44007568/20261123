#include "formfactor.h"
#include "render.h"
#include "report.h"
#include "scene.h"
#include "solver.h"

#include <array>
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace {

struct Options {
    bool verify = false;
    bool noExport = false;
    bool interactive = false;
    bool showHelp = false;
    std::string outputDir = "artifacts/radiosity";
    int width = 960;
    int height = 540;
    int samples = 3;
    double tolerance = 2.0e-6;
    int initialView = 1;
};

void printUsage() {
    std::cout
        << "Shelter radiosity solver (C++17, standard library only)\n"
        << "Usage: shelter_radiosity [options]\n"
        << "  --out DIR          output directory (default artifacts/radiosity)\n"
        << "  --width N          render width (default 960)\n"
        << "  --height N         render height (default 540)\n"
        << "  --samples N        form-factor samples per patch axis, 1..4 (default 3)\n"
        << "  --tolerance X      relative unshot-power tolerance (default 2e-6)\n"
        << "  --view 1|2|3       initial interactive view: first/converged/indirect\n"
        << "  --interactive      ANSI preview with view switching\n"
        << "  --verify           run assertions; exit nonzero on failure\n"
        << "  --no-export        skip images and report files\n"
        << "  --help             show this text\n";
}

bool parseOptions(int argc, char** argv, Options& options) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        auto requireValue = [&](const char* name) -> const char* {
            if (i + 1 >= argc) {
                std::cerr << "Missing value for " << name << '\n';
                return nullptr;
            }
            return argv[++i];
        };
        if (arg == "--help" || arg == "-h") {
            options.showHelp = true;
        } else if (arg == "--verify") {
            options.verify = true;
        } else if (arg == "--no-export") {
            options.noExport = true;
        } else if (arg == "--interactive") {
            options.interactive = true;
        } else if (arg == "--out") {
            const char* value = requireValue("--out");
            if (!value) return false;
            options.outputDir = value;
        } else if (arg == "--width") {
            const char* value = requireValue("--width");
            if (!value) return false;
            options.width = std::max(64, std::atoi(value));
        } else if (arg == "--height") {
            const char* value = requireValue("--height");
            if (!value) return false;
            options.height = std::max(64, std::atoi(value));
        } else if (arg == "--samples") {
            const char* value = requireValue("--samples");
            if (!value) return false;
            options.samples = std::clamp(std::atoi(value), 1, 4);
        } else if (arg == "--tolerance") {
            const char* value = requireValue("--tolerance");
            if (!value) return false;
            options.tolerance = std::max(1.0e-10, std::atof(value));
        } else if (arg == "--view") {
            const char* value = requireValue("--view");
            if (!value) return false;
            options.initialView = std::clamp(std::atoi(value), 1, 3) - 1;
        } else {
            std::cerr << "Unknown option: " << arg << '\n';
            return false;
        }
    }
    return true;
}

std::vector<std::string> verificationFailures(const rad::Scene& scene,
                                              const rad::FormFactorMatrix& ff,
                                              const rad::RadiosityResult& result,
                                              double tolerance) {
    std::vector<std::string> failures;
    if (scene.patches.size() < 200) {
        failures.push_back("patch count is unexpectedly small");
    }
    if (ff.stats().minNormalizedRowSum < 1.0 - 1.0e-8 ||
        ff.stats().maxNormalizedRowSum > 1.0 + 1.0e-8) {
        failures.push_back("form-factor rows are not normalized");
    }
    if (!result.convergedToTolerance || result.energy.finalResidual > tolerance) {
        failures.push_back("solver did not reach the requested residual");
    }
    if (!std::isfinite(result.energy.maxConservationDrift) ||
        result.energy.maxConservationDrift > 1.0e-9) {
        failures.push_back("energy conservation drift exceeded 1e-9");
    }
    if (!result.contact.passed) {
        failures.push_back("a near-contact occlusion probe leaked light");
    }
    if (result.colorBleed.maxNearWallRedBias <= 1.0e-4) {
        failures.push_back("red color bleed was not observed on nearby white walls");
    }
    return failures;
}

void printSummary(const rad::Scene& scene, const rad::RadiosityResult& result) {
    std::cout << "Patches: " << scene.patches.size() << '\n';
    std::cout << "Iterations: " << result.energy.iterations
              << " (equivalent sweeps: " << result.energy.equivalentSweeps << ")\n";
    std::cout << std::scientific << std::setprecision(4)
              << "Residual: " << result.energy.finalResidual
              << "  max energy drift: " << result.energy.maxConservationDrift << '\n';
    std::cout << std::fixed << std::setprecision(3)
              << "Near-wall red bias: mean "
              << 100.0 * result.colorBleed.meanNearWallRedBias << "%, max "
              << 100.0 * result.colorBleed.maxNearWallRedBias << "%\n";
    std::cout << "Contact occlusion: " << (result.contact.passed ? "PASS" : "FAIL")
              << '\n';
}

int runInteractive(const rad::Scene& scene, const rad::RadiosityResult& result,
                   const std::array<rad::Image, 3>& images, int initialView) {
    const std::array<const char*, 3> names = {"first pass", "converged", "indirect only"};
    int view = std::clamp(initialView, 0, 2);
    std::string line;
    while (true) {
        std::cout << "\x1b[2J\x1b[H";
        std::cout << "Shelter radiosity | " << names[view]
                  << " | patches " << scene.patches.size()
                  << " | iterations " << result.energy.iterations << '\n';
        std::cout << rad::ansiPreview(images[static_cast<std::size_t>(view)], 100, 30);
        std::cout << "\n[1] first pass   [2] converged   [3] indirect only   [q] quit\n> "
                  << std::flush;
        if (!std::getline(std::cin, line)) {
            break;
        }
        if (line == "q" || line == "Q" || line == "quit") {
            break;
        }
        if (line == "1") view = 0;
        if (line == "2") view = 1;
        if (line == "3") view = 2;
    }
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    Options options;
    if (!parseOptions(argc, argv, options)) {
        printUsage();
        return 2;
    }
    if (options.showHelp) {
        printUsage();
        return 0;
    }

    rad::Scene scene;
    scene.buildShelter();

    rad::FormFactorMatrix formFactors;
    const auto ffStart = std::chrono::steady_clock::now();
    formFactors.build(scene, options.samples);
    const auto ffEnd = std::chrono::steady_clock::now();

    rad::SolverOptions solverOptions;
    solverOptions.tolerance = options.tolerance;
    rad::ProgressiveSolver solver(scene, formFactors);
    const auto solveStart = std::chrono::steady_clock::now();
    const rad::RadiosityResult result = solver.solve(solverOptions);
    const auto solveEnd = std::chrono::steady_clock::now();

    rad::ReportContext context;
    context.imageWidth = options.width;
    context.imageHeight = options.height;
    context.exposure = rad::recommendedExposure(result.converged);
    context.formFactorSeconds =
        std::chrono::duration<double>(ffEnd - ffStart).count();
    context.solveSeconds =
        std::chrono::duration<double>(solveEnd - solveStart).count();

    printSummary(scene, result);

    const std::vector<std::string> failures =
        verificationFailures(scene, formFactors, result, options.tolerance);
    if (options.verify) {
        if (failures.empty()) {
            std::cout << "VERIFY: PASS\n";
            return 0;
        }
        for (const std::string& failure : failures) {
            std::cerr << "VERIFY: FAIL: " << failure << '\n';
        }
        return 1;
    }

    std::array<rad::Image, 3> images;
    bool haveImages = false;
    if (!options.noExport || options.interactive) {
        const rad::Camera camera;
        const std::array<rad::ViewMode, 3> modes = {
            rad::ViewMode::FirstPass,
            rad::ViewMode::Converged,
            rad::ViewMode::IndirectOnly};
        const auto renderStart = std::chrono::steady_clock::now();
        for (std::size_t i = 0; i < modes.size(); ++i) {
            images[i] = rad::renderView(scene, result.firstPass, result.converged,
                                        modes[i], options.width, options.height,
                                        context.exposure, camera);
        }
        const auto renderEnd = std::chrono::steady_clock::now();
        context.renderSeconds =
            std::chrono::duration<double>(renderEnd - renderStart).count();
        haveImages = true;
    }

    if (!options.noExport) {
        std::error_code error;
        std::filesystem::create_directories(options.outputDir, error);
        if (error) {
            std::cerr << "Cannot create output directory: " << error.message() << '\n';
            return 1;
        }
        const std::array<const char*, 3> fileNames = {
            "first_pass", "converged", "indirect_only"};
        for (std::size_t i = 0; i < images.size(); ++i) {
            const std::string base =
                (std::filesystem::path(options.outputDir) / fileNames[i]).string();
            rad::writeBmp(base + ".bmp", images[i]);
            rad::writePpm(base + ".ppm", images[i]);
        }
        const std::filesystem::path out(options.outputDir);
        rad::writeJsonReport((out / "report.json").string(), scene, formFactors, result,
                             context);
        rad::writeMarkdownReport((out / "report.md").string(), scene, formFactors,
                                 result, context);
        rad::writeEnergyTrace((out / "energy_trace.csv").string(), result);
        std::cout << "Outputs: " << options.outputDir << '\n';
    }

    if (options.interactive && haveImages) {
        return runInteractive(scene, result, images, options.initialView);
    }
    return 0;
}
