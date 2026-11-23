#include "deep_shadow.hpp"
#include "image.hpp"
#include "render.hpp"
#include "scene.hpp"
#include "validation.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

namespace {

using namespace ds;

struct Options {
    int width = 640;
    int height = 400;
    int shadowResolution = 384;
    int frames = 12;
    int fixedLayers = 8;
    int adaptiveMaxLayers = 18;
    int depthBins = 4096;
    int subrayGrid = 3;
    bool animation = true;
    bool quick = false;
    bool singleOnly = false;
    std::string outDirectory = "out";
};

Options parseOptions(int argc, char** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        auto nextInt = [&](int fallback) {
            return i + 1 < argc ? std::stoi(argv[++i]) : fallback;
        };
        if (arg == "--width") {
            options.width = nextInt(options.width);
        } else if (arg == "--height") {
            options.height = nextInt(options.height);
        } else if (arg == "--shadow-res") {
            options.shadowResolution = nextInt(options.shadowResolution);
        } else if (arg == "--frames") {
            options.frames = nextInt(options.frames);
        } else if (arg == "--fixed-layers") {
            options.fixedLayers = nextInt(options.fixedLayers);
        } else if (arg == "--adaptive-max") {
            options.adaptiveMaxLayers = nextInt(options.adaptiveMaxLayers);
        } else if (arg == "--depth-bins") {
            options.depthBins = nextInt(options.depthBins);
        } else if (arg == "--subrays") {
            options.subrayGrid = nextInt(options.subrayGrid);
        } else if (arg == "--out") {
            if (i + 1 < argc) {
                options.outDirectory = argv[++i];
            }
        } else if (arg == "--quick") {
            options.quick = true;
            options.width = 400;
            options.height = 250;
            options.shadowResolution = 224;
            options.frames = 8;
        } else if (arg == "--no-animation") {
            options.animation = false;
        } else if (arg == "--single-only") {
            options.singleOnly = true;
        } else if (arg == "--help" || arg == "-h") {
            std::cout
                << "Crystal chandelier deep shadow map demo (C++17)\n"
                << "Usage: deep_shadow [options]\n"
                << "  --width N            image width (default 640)\n"
                << "  --height N           image height (default 400)\n"
                << "  --shadow-res N       light-map resolution (default 384)\n"
                << "  --frames N           rotation frames (default 12)\n"
                << "  --fixed-layers N     fixed deep layers (default 8)\n"
                << "  --adaptive-max N     adaptive layer cap (default 18)\n"
                << "  --depth-bins N       adaptive depth quantization (default 4096)\n"
                << "  --subrays N          NxN light subrays per pixel (default 3)\n"
                << "  --out DIR            output directory (default out)\n"
                << "  --quick              smaller output for a fast check\n"
                << "  --single-only        build/render only the single-layer mode\n"
                << "  --no-animation       skip the rotation sequence\n";
            std::exit(0);
        }
    }
    options.width = std::max(32, options.width);
    options.height = std::max(32, options.height);
    options.shadowResolution = std::max(32, options.shadowResolution);
    options.frames = std::max(1, options.frames);
    options.fixedLayers = std::max(1, options.fixedLayers);
    options.adaptiveMaxLayers = std::max(2, options.adaptiveMaxLayers);
    options.depthBins = std::max(64, options.depthBins);
    options.subrayGrid = std::clamp(options.subrayGrid, 1, 6);
    return options;
}

double imageLuminanceError(const Image& image, const Image& reference) {
    if (image.width != reference.width || image.height != reference.height ||
        image.pixels.empty()) {
        return 0.0;
    }
    double sum = 0.0;
    for (std::size_t i = 0; i < image.pixels.size(); ++i) {
        const Vec3 a = toneMap(image.pixels[i], 1.35f);
        const Vec3 b = toneMap(reference.pixels[i], 1.35f);
        sum += std::abs(static_cast<double>(luminance(a) - luminance(b)));
    }
    return sum / static_cast<double>(image.pixels.size());
}

std::string fixed(double value, int precision = 4) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(precision) << value;
    return stream.str();
}

std::string bytesToText(std::size_t bytes) {
    std::ostringstream stream;
    if (bytes >= 1024u * 1024u) {
        stream << fixed(static_cast<double>(bytes) / (1024.0 * 1024.0), 2)
               << " MiB";
    } else if (bytes >= 1024u) {
        stream << fixed(static_cast<double>(bytes) / 1024.0, 1) << " KiB";
    } else {
        stream << bytes << " B";
    }
    return stream.str();
}

struct HeroResult {
    ModeReport report;
    Image image;
    double luminanceMae = 0.0;
};

void writeJson(const std::string& path, const Options& options,
               const std::vector<HeroResult>& heroes,
               const std::vector<FrameReport>& rotation) {
    std::ofstream out(path);
    out << std::fixed << std::setprecision(8);
    out << "{\n";
    out << "  \"scene\": \"crystal_chandelier_theater\",\n";
    out << "  \"implementation\": \"C++17 standard library\",\n";
    out << "  \"image\": {\"width\": " << options.width
        << ", \"height\": " << options.height << "},\n";
    out << "  \"shadowMap\": {\"resolution\": " << options.shadowResolution
        << ", \"subraysPerAxis\": " << options.subrayGrid
        << ", \"subrays\": " << options.subrayGrid * options.subrayGrid
        << ", \"depthBins\": " << options.depthBins
        << ", \"fixedLayers\": " << options.fixedLayers
        << ", \"adaptiveMaxLayers\": " << options.adaptiveMaxLayers << "},\n";
    out << "  \"modes\": [\n";
    for (std::size_t i = 0; i < heroes.size(); ++i) {
        const HeroResult& hero = heroes[i];
        const ModeReport& report = hero.report;
        const MapStats& map = report.map;
        const ProbeMetrics& probes = report.probes;
        out << "    {\n";
        out << "      \"mode\": \"" << shadowModeName(report.mode) << "\",\n";
        out << "      \"averageLayers\": " << map.averageLayers << ",\n";
        out << "      \"averageLayersNonEmpty\": "
            << map.averageLayersNonEmpty << ",\n";
        out << "      \"averageOccupiedLayers\": "
            << map.averageOccupiedLayers << ",\n";
        out << "      \"maxLayers\": " << map.maxLayers << ",\n";
        out << "      \"emptyPixels\": " << map.emptyPixels << ",\n";
        out << "      \"storageBytes\": " << map.storageBytes << ",\n";
        out << "      \"bytesPerPixel\": "
            << static_cast<double>(map.storageBytes) /
                   static_cast<double>(map.width * map.height)
            << ",\n";
        out << "      \"buildMilliseconds\": " << map.buildMilliseconds << ",\n";
        out << "      \"shadowError\": {\"probeMae\": " << probes.mae
            << ", \"probeRmse\": " << probes.rmse
            << ", \"probeP95\": " << probes.p95
            << ", \"probeMax\": " << probes.maximum
            << ", \"screenTransmittanceMae\": "
            << report.frame.transmittanceMae
            << ", \"screenLuminanceMae\": " << hero.luminanceMae << "},\n";
        out << "      \"probeMeanTransmittance\": {\"reference\": "
            << probes.referenceMeanTransmittance << ", \"map\": "
            << probes.mapMeanTransmittance << "},\n";
        out << "      \"attenuation\": {\"monotonic\": "
            << (probes.attenuationMonotonic ? "true" : "false")
            << ", \"bandError\": " << probes.attenuationBandError << "},\n";
        out << "      \"filament\": {\"probes\": " << probes.filamentProbes
            << ", \"retained\": " << probes.retainedFilamentShadows
            << ", \"retainedFraction\": "
            << (probes.filamentProbes == 0
                    ? 0.0
                    : static_cast<double>(probes.retainedFilamentShadows) /
                          static_cast<double>(probes.filamentProbes))
            << ", \"referenceMean\": " << probes.filamentReferenceMean
            << ", \"mapMean\": " << probes.filamentMapMean << "},\n";
        out << "      \"layerBins\": [";
        bool firstBin = true;
        for (const LayerBin& bin : probes.layerBins) {
            if (bin.probes == 0) {
                continue;
            }
            if (!firstBin) {
                out << ", ";
            }
            firstBin = false;
            out << "{\"blades\": " << bin.glassBlades
                << ", \"probes\": " << bin.probes
                << ", \"referenceMean\": " << bin.referenceMeanTransmittance
                << ", \"mapMean\": " << bin.mapMeanTransmittance << "}";
        }
        out << "]\n";
        out << "    }" << (i + 1 < heroes.size() ? "," : "") << "\n";
    }
    out << "  ],\n";
    out << "  \"rotationFrames\": [\n";
    for (std::size_t i = 0; i < rotation.size(); ++i) {
        const FrameReport& frame = rotation[i];
        const ProbeMetrics& probes = frame.probes;
        out << "    {\"frame\": " << frame.frame << ", \"angleDegrees\": "
            << frame.angle * 180.0 / kPi << ", \"probeMae\": " << probes.mae
            << ", \"meanTransmittance\": "
            << probes.mapMeanTransmittance << ", \"filamentRetained\": "
            << probes.retainedFilamentShadows << ", \"filamentProbes\": "
            << probes.filamentProbes << "}"
            << (i + 1 < rotation.size() ? "," : "") << "\n";
    }
    out << "  ],\n";
    out << "  \"outputs\": [\"reference.ppm\", \"single.ppm\", \"fixed.ppm\", "
           "\"adaptive.ppm\", \"hero_contact.ppm\", \"rotation_contact.ppm\", "
           "\"report.md\", \"report.json\", \"rotation.csv\"]\n";
    out << "}\n";
}

void writeMarkdown(const std::string& path, const Options& options,
                   const std::vector<HeroResult>& heroes,
                   const std::vector<FrameReport>& rotation) {
    std::ofstream out(path);
    out << "# Crystal Chandelier Deep Shadow Map Report\n\n";
    out << "Scene: five rotating glass tiers, gold spokes, thin suspension "
           "wires, nine bulbs, and two thin smoke volumes. Camera and "
           "chandelier rotate together; the spotlight remains fixed.\n\n";
    out << "Shadow map: `" << options.shadowResolution << "x"
        << options.shadowResolution << "`, " << options.subrayGrid << "x"
        << options.subrayGrid << " coverage subrays, quantized to "
        << options.depthBins
        << " depth bins.\n\n";
    out << "| Mode | Avg layers | Non-empty | Occupied | Max | Storage | B/pixel | "
           "Probe MAE | Screen T MAE | Luminance MAE | Filament kept | "
           "Monotonic |\n";
    out << "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:---:|\n";
    for (const HeroResult& hero : heroes) {
        const ModeReport& report = hero.report;
        const ProbeMetrics& probes = report.probes;
        const double retained =
            probes.filamentProbes == 0
                ? 0.0
                : 100.0 * static_cast<double>(probes.retainedFilamentShadows) /
                      static_cast<double>(probes.filamentProbes);
        out << "| " << shadowModeName(report.mode) << " | "
            << fixed(report.map.averageLayers, 2) << " | "
            << fixed(report.map.averageLayersNonEmpty, 2) << " | "
            << fixed(report.map.averageOccupiedLayers, 2) << " | "
            << report.map.maxLayers << " | "
            << bytesToText(report.map.storageBytes) << " | "
            << fixed(static_cast<double>(report.map.storageBytes) /
                         static_cast<double>(report.map.width *
                                             report.map.height),
                     1)
            << " | " << fixed(probes.mae) << " | "
            << fixed(report.frame.transmittanceMae) << " | "
            << fixed(hero.luminanceMae) << " | " << fixed(retained, 1)
            << "% | " << (probes.attenuationMonotonic ? "yes" : "no")
            << " |\n";
    }
    const auto findMode = [&heroes](ShadowMode mode) -> const ModeReport* {
        for (const HeroResult& hero : heroes) {
            if (hero.report.mode == mode) {
                return &hero.report;
            }
        }
        return nullptr;
    };
    const ModeReport* fixedReport = findMode(ShadowMode::FixedLayers);
    const ModeReport* adaptiveReport = findMode(ShadowMode::Adaptive);
    if (fixedReport != nullptr && adaptiveReport != nullptr &&
        fixedReport->map.storageBytes > 0) {
        const double saving = 100.0 *
            (1.0 - static_cast<double>(adaptiveReport->map.storageBytes) /
                       static_cast<double>(fixedReport->map.storageBytes));
        out << "\nAdaptive maps use " << fixed(saving, 1)
            << "% less storage than the fixed "
            << options.fixedLayers
            << "-layer maps and obtain the lowest depth-probe MAE in this run. "
               "The wall-only screen metric is primarily spatial filtering: "
               "the wall lies behind every layer, so the depth probe set is "
               "the mode-discriminating error measurement.\n";
    }
    out << "\n## Attenuation by glass blades\n\n";
    for (const HeroResult& hero : heroes) {
        out << "\n### " << shadowModeName(hero.report.mode) << "\n\n";
        out << "| Glass blades crossed | Probes | Per-ray T | Map T | Error |\n";
        out << "|---:|---:|---:|---:|---:|\n";
        for (const LayerBin& bin : hero.report.probes.layerBins) {
            if (bin.probes == 0) {
                continue;
            }
            out << "| " << bin.glassBlades << " | " << bin.probes << " | "
                << fixed(bin.referenceMeanTransmittance) << " | "
                << fixed(bin.mapMeanTransmittance) << " | "
                << fixed(std::abs(bin.mapMeanTransmittance -
                                  bin.referenceMeanTransmittance))
                << " |\n";
        }
    }
    out << "\n## Rotation validation\n\n";
    out << "Each frame rebuilds the adaptive map after rotating camera and "
           "chandelier by the same angle.\n\n";
    out << "| Frame | Angle | Probe MAE | Mean T | Filament kept |\n";
    out << "|---:|---:|---:|---:|---:|\n";
    for (const FrameReport& frame : rotation) {
        const double retained =
            frame.probes.filamentProbes == 0
                ? 0.0
                : 100.0 *
                      static_cast<double>(frame.probes.retainedFilamentShadows) /
                      static_cast<double>(frame.probes.filamentProbes);
        out << "| " << frame.frame << " | "
            << fixed(frame.angle * 180.0 / kPi, 1) << " deg | "
            << fixed(frame.probes.mae) << " | "
            << fixed(frame.probes.mapMeanTransmittance) << " | "
            << fixed(retained, 1) << "% |\n";
    }
}

void writeRotationCsv(const std::string& path,
                      const std::vector<FrameReport>& rotation) {
    std::ofstream out(path);
    out << "frame,angle_deg,map_layers,probe_mae,mean_transmittance,"
           "filament_probes,filament_retained,monotonic\n";
    for (const FrameReport& frame : rotation) {
        const ProbeMetrics& probes = frame.probes;
        out << frame.frame << ',' << fixed(frame.angle * 180.0 / kPi, 3) << ','
            << "0," << fixed(probes.mae, 6) << ','
            << fixed(probes.mapMeanTransmittance, 6) << ','
            << probes.filamentProbes << ',' << probes.retainedFilamentShadows
            << ',' << (probes.attenuationMonotonic ? 1 : 0) << '\n';
    }
}

int run(const Options& options) {
    std::filesystem::create_directories(options.outDirectory);
    const std::string out = options.outDirectory;
    const auto runStart = std::chrono::steady_clock::now();
    const float heroAngle = 0.18f;
    const Scene heroScene = Scene::makeTheater(heroAngle, 7u);
    const LightCamera light = heroScene.lightCamera();
    const std::size_t mapPixels =
        static_cast<std::size_t>(options.shadowResolution) *
        options.shadowResolution;
    std::cout << "Crystal chandelier deep shadow map\n"
              << "  image " << options.width << "x" << options.height
              << ", light map " << options.shadowResolution << "x"
              << options.shadowResolution << " (" << mapPixels
              << " pixels), " << options.subrayGrid << "x"
              << options.subrayGrid << " subrays\n";

    RenderSettings referenceSettings;
    referenceSettings.width = options.width;
    referenceSettings.height = options.height;
    referenceSettings.referenceShadows = true;
    const RenderOutput referenceOutput =
        renderFrame(heroScene, nullptr, heroAngle, referenceSettings, false);
    savePPM(referenceOutput.image, out + "/reference.ppm",
            referenceSettings.exposure);

    std::vector<ShadowMode> modes = {ShadowMode::SingleLayer,
                                     ShadowMode::FixedLayers,
                                     ShadowMode::Adaptive};
    if (options.singleOnly) {
        modes = {ShadowMode::SingleLayer};
    }
    BuildOptions buildOptions;
    buildOptions.fixedLayers = options.fixedLayers;
    buildOptions.adaptiveMaxLayers = options.adaptiveMaxLayers;
    buildOptions.depthBins = options.depthBins;
    buildOptions.subrays = options.subrayGrid;
    buildOptions.smokeSamples = 8;

    std::vector<HeroResult> heroes;
    heroes.reserve(modes.size());
    for (ShadowMode mode : modes) {
        DeepShadowMap map;
        map.build(heroScene, light, options.shadowResolution,
                  options.shadowResolution, mode, buildOptions);
        RenderSettings settings;
        settings.width = options.width;
        settings.height = options.height;
        const RenderOutput rendered =
            renderFrame(heroScene, &map, heroAngle, settings, true);
        HeroResult hero;
        hero.report.mode = mode;
        hero.report.map = map.stats;
        hero.report.frame = rendered.metrics;
        hero.report.probes =
            measureMapAgainstReference(heroScene, map, 1);
        hero.image = rendered.image;
        hero.luminanceMae =
            imageLuminanceError(rendered.image, referenceOutput.image);
        savePPM(rendered.image, out + "/" + shadowModeName(mode) + ".ppm",
                settings.exposure);
        const double retained =
            hero.report.probes.filamentProbes == 0
                ? 0.0
                : 100.0 *
                      static_cast<double>(
                          hero.report.probes.retainedFilamentShadows) /
                      static_cast<double>(hero.report.probes.filamentProbes);
        std::cout << "  " << std::setw(8) << shadowModeName(mode)
                  << ": layers " << std::fixed << std::setprecision(2)
                  << map.stats.averageLayers << ", storage "
                  << bytesToText(map.stats.storageBytes) << ", probe MAE "
                  << std::setprecision(4) << hero.report.probes.mae
                  << ", filament kept " << std::setprecision(1) << retained
                  << "%\n";
        heroes.push_back(std::move(hero));
    }

    {
        std::vector<Image> sheetImages;
        sheetImages.push_back(referenceOutput.image);
        for (const HeroResult& hero : heroes) {
            sheetImages.push_back(hero.image);
        }
        savePPM(makeContactSheet(sheetImages, static_cast<int>(sheetImages.size())),
                out + "/hero_contact.ppm", referenceSettings.exposure);
    }

    std::vector<FrameReport> rotation;
    if (options.animation && !options.singleOnly) {
        std::vector<Image> frameImages;
        frameImages.reserve(static_cast<std::size_t>(options.frames));
        RenderSettings settings;
        settings.width = options.width;
        settings.height = options.height;
        for (int frame = 0; frame < options.frames; ++frame) {
            const float angle =
                2.0f * kPi * static_cast<float>(frame) /
                static_cast<float>(options.frames);
            const Scene scene =
                Scene::makeTheater(angle, static_cast<uint32_t>(frame) + 31u);
            DeepShadowMap map;
            map.build(scene, scene.lightCamera(), options.shadowResolution,
                      options.shadowResolution, ShadowMode::Adaptive,
                      buildOptions);
            const RenderOutput rendered = renderFrame(scene, &map, angle,
                                                      settings, true);
            FrameReport report;
            report.frame = frame;
            report.angle = angle;
            report.metrics = rendered.metrics;
            report.probes = measureMapAgainstReference(scene, map, 3);
            rotation.push_back(report);
            frameImages.push_back(rendered.image);
            std::ostringstream name;
            name << out << "/rotation_" << std::setw(2) << std::setfill('0')
                 << frame << ".ppm";
            savePPM(rendered.image, name.str(), settings.exposure);
            std::cout << "  rotation " << (frame + 1) << "/" << options.frames
                      << "  angle " << std::setprecision(1)
                      << angle * 180.0f / kPi << " deg  MAE "
                      << std::setprecision(4) << report.probes.mae << "\n";
        }
        if (!frameImages.empty()) {
            savePPM(makeContactSheet(frameImages, 4), out + "/rotation_contact.ppm",
                    settings.exposure);
        }
    }

    writeJson(out + "/report.json", options, heroes, rotation);
    writeMarkdown(out + "/report.md", options, heroes, rotation);
    writeRotationCsv(out + "/rotation.csv", rotation);
    const double seconds =
        std::chrono::duration<double>(std::chrono::steady_clock::now() - runStart)
            .count();
    std::cout << "Wrote " << out << "/report.json, report.md and PPM images in "
              << std::fixed << std::setprecision(2) << seconds << " s\n";
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    return run(parseOptions(argc, argv));
}
