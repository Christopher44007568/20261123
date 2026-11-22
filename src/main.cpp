#include "renderer.hpp"
#include "scene.hpp"
#include "validate.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace {

using ocr::Camera;
using ocr::ClipPlane;
using ocr::CutPreviewStats;
using ocr::ImageRGB;
using ocr::RenderOptions;
using ocr::RenderResult;
using ocr::Scene;
using ocr::Vec3;

struct Preset {
    std::string id;
    std::string description;
    Vec3 normal;
    float offset = 0.0f;
};

struct CliOptions {
    int width = 640;
    int height = 360;
    int aoSamples = 6;
    bool all = true;
    bool selfCheck = false;
    bool makeReference = true;
    bool ambientOcclusion = true;
    bool glossyReflection = true;
    std::string outputDirectory = "artifacts";
    bool custom = false;
    Preset customPreset;
};

struct CutRun {
    Preset preset;
    RenderResult render;
    ImageRGB preview;
    CutPreviewStats previewStats;
    ocr::ChannelValidation validation;
    ocr::ReferenceComparison bruteCheck;
    bool bruteCheckValid = false;
    std::map<int, std::int64_t> objectPixels;
};

void printUsage(const char* executable) {
    std::cout
        << "Usage: " << executable << " [options]\n"
        << "  --all                     render corridor and top presets (default)\n"
        << "  --preset corridor|top     render one named preset\n"
        << "  --normal X,Y,Z --offset D render an arbitrary plane\n"
        << "  --width N --height N      output resolution (default 640x360)\n"
        << "  --out DIR                 artifact root (default artifacts)\n"
        << "  --ao-samples N            local AO rays per hit (default 6)\n"
        << "  --no-ao                   disable local ambient occlusion\n"
        << "  --no-reflection           disable the single glossy reflection\n"
        << "  --no-reference            skip the brute-force reference render\n"
        << "  --self-check              run a small internal BVH/brute check\n"
        << "  --help                    show this help\n"
        << "\nThe positive side of dot(normal,p) > offset is removed.\n";
}

bool parseFloat(const std::string& text, float& value) {
    char* end = nullptr;
    const float parsed = std::strtof(text.c_str(), &end);
    if (end == text.c_str() || *end != '\0' || !std::isfinite(parsed)) {
        return false;
    }
    value = parsed;
    return true;
}

bool parseInt(const std::string& text, int& value) {
    char* end = nullptr;
    const long parsed = std::strtol(text.c_str(), &end, 10);
    if (end == text.c_str() || *end != '\0' || parsed <= 0 ||
        parsed > 8192) {
        return false;
    }
    value = static_cast<int>(parsed);
    return true;
}

bool parseNormal(const std::string& text, Vec3& value) {
    std::stringstream stream(text);
    std::string part;
    float components[3] = {0.0f, 0.0f, 0.0f};
    int count = 0;
    while (std::getline(stream, part, ',') && count < 3) {
        if (!parseFloat(part, components[count])) {
            return false;
        }
        ++count;
    }
    if (count != 3) {
        return false;
    }
    value = {components[0], components[1], components[2]};
    return ocr::lengthSquared(value) > 1.0e-8f;
}

Preset corridorPreset() {
    return {"corridor",
            "oblique front section through corridor, cabin and sea base",
            {0.10f, 0.02f, 0.994f},
            3.25f};
}

Preset topPreset() {
    return {"top",
            "near-horizontal upper section exposing corridor interior",
            {0.10f, 0.985f, 0.14f},
            8.60f};
}

CliOptions parseArguments(int argc, char** argv, bool& ok) {
    CliOptions options;
    bool presetSpecified = false;
    bool normalSpecified = false;
    bool offsetSpecified = false;
    float customOffset = 0.0f;
    Vec3 customNormal;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        auto nextValue = [&](const char* name, std::string& value) {
            if (i + 1 >= argc) {
                std::cerr << "Missing value for " << name << '\n';
                ok = false;
                return false;
            }
            value = argv[++i];
            return true;
        };
        if (arg == "--help" || arg == "-h") {
            printUsage(argv[0]);
            std::exit(0);
        } else if (arg == "--all") {
            options.all = true;
            presetSpecified = true;
        } else if (arg == "--self-check") {
            options.selfCheck = true;
        } else if (arg == "--no-reference") {
            options.makeReference = false;
        } else if (arg == "--no-ao") {
            options.ambientOcclusion = false;
        } else if (arg == "--no-reflection") {
            options.glossyReflection = false;
        } else if (arg == "--preset") {
            std::string value;
            if (!nextValue("--preset", value)) {
                break;
            }
            if (value == "corridor") {
                options.all = false;
                options.customPreset = corridorPreset();
                presetSpecified = true;
            } else if (value == "top") {
                options.all = false;
                options.customPreset = topPreset();
                presetSpecified = true;
            } else {
                std::cerr << "Unknown preset: " << value << '\n';
                ok = false;
            }
        } else if (arg == "--normal") {
            std::string value;
            if (!nextValue("--normal", value)) {
                break;
            }
            if (!parseNormal(value, customNormal)) {
                std::cerr << "Invalid normal: " << value << '\n';
                ok = false;
            }
            normalSpecified = true;
        } else if (arg == "--offset") {
            std::string value;
            if (!nextValue("--offset", value)) {
                break;
            }
            if (!parseFloat(value, customOffset)) {
                std::cerr << "Invalid offset: " << value << '\n';
                ok = false;
            }
            offsetSpecified = true;
        } else if (arg == "--width") {
            std::string value;
            if (!nextValue("--width", value)) {
                break;
            }
            if (!parseInt(value, options.width)) {
                std::cerr << "Invalid width: " << value << '\n';
                ok = false;
            }
        } else if (arg == "--height") {
            std::string value;
            if (!nextValue("--height", value)) {
                break;
            }
            if (!parseInt(value, options.height)) {
                std::cerr << "Invalid height: " << value << '\n';
                ok = false;
            }
        } else if (arg == "--ao-samples") {
            std::string value;
            if (!nextValue("--ao-samples", value)) {
                break;
            }
            if (!parseInt(value, options.aoSamples)) {
                std::cerr << "Invalid AO sample count: " << value << '\n';
                ok = false;
            }
        } else if (arg == "--out") {
            if (!nextValue("--out", options.outputDirectory)) {
                break;
            }
        } else {
            std::cerr << "Unknown argument: " << arg << '\n';
            ok = false;
        }
    }

    if (normalSpecified || offsetSpecified) {
        if (!normalSpecified || !offsetSpecified) {
            std::cerr << "--normal and --offset must be specified together\n";
            ok = false;
        } else {
            options.all = false;
            options.custom = true;
            options.customPreset = {
                "custom", "user-specified clipping plane",
                customNormal, customOffset};
        }
    } else if (!presetSpecified) {
        options.all = true;
    }
    return options;
}

Camera makeCamera(int width, int height) {
    Camera camera;
    camera.width = width;
    camera.height = height;
    camera.position = {29.0f, 17.5f, 32.0f};
    camera.target = {-1.0f, 6.2f, 0.0f};
    camera.up = {0.0f, 1.0f, 0.0f};
    camera.verticalFovDegrees = 45.0f;
    return camera;
}

RenderOptions makeRenderOptions(const CliOptions& cli, int width, int height,
                                bool useBvh = true) {
    RenderOptions options;
    options.width = width;
    options.height = height;
    options.useBvh = useBvh;
    options.ambientOcclusion = cli.ambientOcclusion;
    options.aoSamples = cli.aoSamples;
    options.glossyReflection = cli.glossyReflection;
    return options;
}

void applyPreset(Scene& scene, const Preset& preset) {
    scene.clip.enabled = true;
    scene.clip.normal = preset.normal;
    scene.clip.offset = preset.offset;
    scene.clip.normalizePlane();
}

std::string jsonColor(const Vec3& c) {
    std::ostringstream out;
    out << '[' << std::fixed << std::setprecision(5)
        << c.x << ',' << c.y << ',' << c.z << ']';
    return out.str();
}

std::string probeJson(const ocr::MaterialProbe& probe) {
    std::ostringstream out;
    out << "    {\"label\": \"" << ocr::escapeJson(probe.label)
        << "\", \"x\": " << probe.x << ", \"y\": " << probe.y
        << ", \"material\": " << probe.material
        << ", \"objectId\": " << probe.objectId
        << ", \"primitiveId\": " << probe.primitiveId
        << ", \"isSdf\": " << (probe.isSdf ? "true" : "false")
        << ", \"depth\": " << std::fixed << std::setprecision(6)
        << probe.depth << ", \"color\": " << jsonColor(probe.color)
        << ", \"normal\": " << jsonColor(probe.normal) << '}';
    return out.str();
}

std::map<int, std::int64_t> countObjects(const RenderResult& render) {
    std::map<int, std::int64_t> counts;
    for (const ocr::PixelRecord& pixel : render.pixels) {
        if (pixel.hit) {
            ++counts[pixel.objectId];
        }
    }
    return counts;
}

std::int64_t objectCount(const CutRun& run,
                         const std::vector<int>& ids) {
    std::int64_t total = 0;
    for (int id : ids) {
        const auto it = run.objectPixels.find(id);
        if (it != run.objectPixels.end()) {
            total += it->second;
        }
    }
    return total;
}

bool writeCutMetadata(const std::string& directory, const CutRun& run,
                      const ClipPlane& plane) {
    std::ostringstream out;
    out << "{\n"
        << "  \"id\": \"" << ocr::escapeJson(run.preset.id) << "\",\n"
        << "  \"description\": \""
        << ocr::escapeJson(run.preset.description) << "\",\n"
        << "  \"plane\": {\"normal\": " << jsonColor(plane.normal)
        << ", \"offset\": " << std::fixed << std::setprecision(6)
        << plane.offset
        << ", \"removedHalfSpace\": \"dot(normal,p) > offset\"},\n"
        << "  \"render\": {\n"
        << "    \"hitPixels\": " << run.render.stats.hitPixels << ",\n"
        << "    \"skyPixels\": " << run.render.stats.skyPixels << ",\n"
        << "    \"clipRejections\": " << run.render.stats.clipRejections
        << ",\n"
        << "    \"continuationPixels\": "
        << run.render.stats.continuationPixels << ",\n"
        << "    \"maxClipRejectionsOnOneRay\": "
        << run.render.stats.maxClipRejections << "\n"
        << "  },\n"
        << "  \"channelConsistency\": {\n"
        << "    \"pixels\": " << run.validation.pixels << ",\n"
        << "    \"materialIdsMatched\": "
        << run.validation.materialIdsMatched << ",\n"
        << "    \"materialsMatched\": " << run.validation.materialsMatched
        << ",\n"
        << "    \"depthsMatched\": " << run.validation.depthsMatched
        << ",\n"
        << "    \"normalsMatched\": " << run.validation.normalsMatched
        << ",\n"
        << "    \"colorsMatched\": " << run.validation.colorsMatched << "\n"
        << "  },\n"
        << "  \"cutPreview\": {\"triangleSegments\": "
        << run.previewStats.triangleSegments << ", \"sdfSegments\": "
        << run.previewStats.sdfSegments << "},\n"
        << "  \"bruteCheck\": {\n"
        << "    \"performed\": "
        << (run.bruteCheckValid ? "true" : "false") << ",\n"
        << "    \"passed\": "
        << (run.bruteCheck.pass() ? "true" : "false") << ",\n"
        << "    \"firstHitMismatches\": "
        << run.bruteCheck.firstHitMismatches << ",\n"
        << "    \"materialMismatches\": "
        << run.bruteCheck.materialMismatches << ",\n"
        << "    \"depthMismatches\": "
        << run.bruteCheck.depthMismatches << ",\n"
        << "    \"maxDepthError\": " << std::setprecision(9)
        << run.bruteCheck.maxDepthError << "\n"
        << "  },\n"
        << "  \"visibleObjectPixels\": {";
    bool first = true;
    for (const auto& entry : run.objectPixels) {
        if (!first) {
            out << ", ";
        }
        out << '"' << entry.first << "\": " << entry.second;
        first = false;
    }
    out << "},\n  \"probes\": [\n";
    for (std::size_t i = 0; i < run.validation.probes.size(); ++i) {
        out << probeJson(run.validation.probes[i]);
        if (i + 1 != run.validation.probes.size()) {
            out << ',';
        }
        out << '\n';
    }
    out << "  ]\n}\n";
    std::filesystem::create_directories(directory);
    std::ofstream file(directory + "/cut.json", std::ios::binary);
    if (!file) {
        return false;
    }
    file << out.str();
    return static_cast<bool>(file);
}

bool renderCut(Scene& scene, const Camera& camera, const Preset& preset,
               const CliOptions& cli, const std::string& directory,
               CutRun& run) {
    const float normalLength = ocr::length(preset.normal);
    run.preset = preset;
    run.preset.normal = preset.normal / normalLength;
    run.preset.offset = preset.offset / normalLength;
    applyPreset(scene, run.preset);
    run.render = ocr::renderScene(
        scene, camera, makeRenderOptions(cli, cli.width, cli.height));
    run.preview = ocr::buildCutPreview(scene, camera, run.render,
                                       &run.previewStats);
    run.objectPixels = countObjects(run.render);

    RenderOptions checkOptions;
    checkOptions.width = 128;
    checkOptions.height = 72;
    checkOptions.useBvh = true;
    checkOptions.ambientOcclusion = false;
    checkOptions.glossyReflection = false;
    const RenderResult bvhCheck =
        ocr::renderScene(scene, makeCamera(128, 72), checkOptions);
    checkOptions.useBvh = false;
    const RenderResult bruteCheck =
        ocr::renderScene(scene, makeCamera(128, 72), checkOptions);
    run.bruteCheck = ocr::compareRenders(bvhCheck, bruteCheck);
    run.bruteCheckValid = true;

    if (!ocr::writeChannels(directory, run.render, run.preview, scene,
                            run.previewStats, &run.validation)) {
        return false;
    }
    return writeCutMetadata(directory, run, scene.clip);
}

bool channelChecksPass(const CutRun& run) {
    return run.validation.materialIdsMatched == run.validation.pixels &&
           run.validation.materialsMatched == run.validation.pixels &&
           run.validation.depthsMatched == run.validation.pixels &&
           run.validation.normalsMatched == run.validation.pixels &&
           run.validation.colorsMatched == run.validation.pixels;
}

bool writeSummary(const std::string& root, const CliOptions& cli,
                  const Camera& camera, const std::vector<CutRun>& runs,
                  bool referencePass, bool referenceRan, bool& passOut) {
    bool allChannelChecks = true;
    bool allRegions = true;
    bool allClipping = true;
    const bool enforcePresetChecks = !cli.custom;
    for (const CutRun& run : runs) {
        allChannelChecks = allChannelChecks && channelChecksPass(run);
        if (enforcePresetChecks) {
            const bool corridor = objectCount(run, {7}) > 0;
            const bool cables =
                objectCount(run, {10, 31, 32, 33, 34}) > 0;
            const bool water = objectCount(run, {12}) > 0;
            allRegions = allRegions && corridor && cables && water;
            allClipping = allClipping &&
                          run.render.stats.clipRejections > 0 &&
                          run.render.stats.continuationPixels > 0 &&
                          run.render.stats.maxClipRejections < 512;
        }
        allClipping =
            allClipping && run.bruteCheckValid && run.bruteCheck.pass();
    }
    const bool referenceOk = !referenceRan || referencePass;
    const bool pass =
        allChannelChecks && allRegions && allClipping && referenceOk;
    passOut = pass;

    std::ostringstream out;
    out << "{\n"
        << "  \"renderer\": \"offshore_clip_renderer\",\n"
        << "  \"standard\": \"C++17\",\n"
        << "  \"resolution\": [" << cli.width << ", " << cli.height << "],\n"
        << "  \"camera\": {\"position\": " << jsonColor(camera.position)
        << ", \"target\": " << jsonColor(camera.target)
        << ", \"verticalFovDegrees\": " << camera.verticalFovDegrees
        << "},\n"
        << "  \"clippingSemantics\": "
           "\"positive half-space dot(normal,p)>offset is removed; all "
           "intersections are completed first and rejected hits continue "
           "without rebuilding BVH/SDF geometry\",\n"
        << "  \"pass\": " << (pass ? "true" : "false") << ",\n"
        << "  \"checks\": {\n"
        << "    \"channelPixelsConsistent\": "
        << (allChannelChecks ? "true" : "false") << ",\n"
        << "    \"presetContentChecksEnforced\": "
        << (enforcePresetChecks ? "true" : "false") << ",\n"
        << "    \"corridorCableWaterVisibleInEveryCut\": "
        << (!enforcePresetChecks
                ? "null"
                : (allRegions ? "true" : "false"))
        << ",\n"
        << "    \"clipContinuationsObserved\": "
        << (allClipping ? "true" : "false") << ",\n"
        << "    \"bruteReferencePassed\": "
        << (!referenceRan ? "null" : (referencePass ? "true" : "false"))
        << "\n"
        << "  },\n"
        << "  \"cuts\": [\n";
    for (std::size_t i = 0; i < runs.size(); ++i) {
        const CutRun& run = runs[i];
        out << "    {\n"
            << "      \"id\": \"" << ocr::escapeJson(run.preset.id)
            << "\",\n"
            << "      \"directory\": \"" << ocr::escapeJson(run.preset.id)
            << "\",\n"
            << "      \"normal\": "
            << jsonColor(run.preset.normal)
            << ",\n"
            << "      \"offset\": " << std::fixed << std::setprecision(6)
            << run.preset.offset << ",\n"
            << "      \"clipRejections\": "
            << run.render.stats.clipRejections << ",\n"
            << "      \"continuationPixels\": "
            << run.render.stats.continuationPixels << ",\n"
            << "      \"corridorInteriorPixels\": "
            << objectCount(run, {7}) << ",\n"
            << "      \"cableBridgePixels\": "
            << objectCount(run, {10, 31, 32, 33, 34}) << ",\n"
            << "      \"seawaterPixels\": " << objectCount(run, {12})
            << ",\n"
            << "      \"channelPixelsConsistent\": "
            << (channelChecksPass(run) ? "true" : "false") << ",\n"
            << "      \"bruteFirstHitAndMaterialPassed\": "
            << (run.bruteCheck.pass() ? "true" : "false") << "\n"
            << "    }";
        if (i + 1 != runs.size()) {
            out << ',';
        }
        out << '\n';
    }
    out << "  ],\n"
        << "  \"reference\": "
        << (!referenceRan ? "null" : "\"comparison.json\"") << "\n"
        << "}\n";

    std::filesystem::create_directories(root);
    std::ofstream file(root + "/validation.json", std::ios::binary);
    if (!file) {
        return false;
    }
    file << out.str();
    return static_cast<bool>(file);
}

bool runSelfCheck() {
    Scene scene = ocr::makeOffshoreScene();
    const Camera camera = makeCamera(64, 36);
    const Preset presets[] = {corridorPreset(), topPreset()};
    bool pass = true;
    for (const Preset& preset : presets) {
        const float normalLength = ocr::length(preset.normal);
        Preset normalized = preset;
        normalized.normal = preset.normal / normalLength;
        normalized.offset = preset.offset / normalLength;
        applyPreset(scene, normalized);
        RenderOptions options;
        options.width = 64;
        options.height = 36;
        options.useBvh = true;
        options.ambientOcclusion = false;
        options.glossyReflection = false;
        const RenderResult bvh = ocr::renderScene(scene, camera, options);
        options.useBvh = false;
        const RenderResult brute = ocr::renderScene(scene, camera, options);
        const ocr::ReferenceComparison comparison =
            ocr::compareRenders(bvh, brute);
        if (!comparison.pass()) {
            pass = false;
            std::cerr << "Self-check failed for " << preset.id
                      << ": presence=" << comparison.hitPresenceMismatches
                      << " material=" << comparison.materialMismatches
                      << " firstHit=" << comparison.firstHitMismatches
                      << " depth=" << comparison.depthMismatches << '\n';
            for (const ocr::MaterialProbe& sample :
                 comparison.mismatchExamples) {
                const ocr::PixelRecord& a = bvh.at(sample.x, sample.y);
                const ocr::PixelRecord& b = brute.at(sample.x, sample.y);
                std::cerr << "  at " << sample.x << ',' << sample.y
                          << " bvh(t=" << a.depth << ", mat=" << a.material
                          << ", obj=" << a.objectId << ", prim="
                          << a.primitiveId << ", sdf=" << a.isSdf
                          << ") brute(t=" << b.depth << ", mat="
                          << b.material << ", obj=" << b.objectId
                          << ", prim=" << b.primitiveId << ", sdf="
                          << b.isSdf << ")\n";
            }
        }
        if (bvh.stats.clipRejections == 0 ||
            bvh.stats.continuationPixels == 0) {
            pass = false;
            std::cerr << "Self-check clip continuation missing for "
                      << preset.id << '\n';
        }
    }
    std::cout << (pass ? "Self-check passed.\n" : "Self-check failed.\n");
    return pass;
}

bool renderReference(Scene& scene, const Camera& finalCamera,
                     const Preset& preset, const CliOptions& cli,
                     const std::string& root,
                     bool& comparisonPass) {
    (void)finalCamera;
    const float normalLength = ocr::length(preset.normal);
    Preset normalized = preset;
    normalized.normal = preset.normal / normalLength;
    normalized.offset = preset.offset / normalLength;
    applyPreset(scene, normalized);

    Camera referenceCamera = makeCamera(160, 90);
    RenderOptions options = makeRenderOptions(cli, 160, 90, true);
    options.aoSamples = std::min(options.aoSamples, 2);
    const RenderResult bvh =
        ocr::renderScene(scene, referenceCamera, options);
    options.useBvh = false;
    const RenderResult brute =
        ocr::renderScene(scene, referenceCamera, options);
    CutPreviewStats previewStats;
    const ImageRGB preview =
        ocr::buildCutPreview(scene, referenceCamera, brute, &previewStats);
    const ocr::ReferenceComparison comparison =
        ocr::compareRenders(bvh, brute);
    comparisonPass = comparison.pass();

    const bool wrote = ocr::writeReferenceOutputs(
        root, bvh, brute, preview, scene, previewStats, comparison);
    const std::string planePath = root + "/brute_reference/plane.json";
    std::ofstream planeFile(planePath, std::ios::binary);
    if (planeFile) {
        planeFile << "{\n"
                  << "  \"normal\": " << jsonColor(normalized.normal)
                  << ",\n  \"offset\": " << std::fixed
                  << std::setprecision(6) << normalized.offset << ",\n"
                  << "  \"removedHalfSpace\": "
                     "\"dot(normal,p) > offset\"\n}\n";
    }
    return wrote && comparisonPass;
}

}  // namespace

int main(int argc, char** argv) {
    bool argumentsOk = true;
    const CliOptions options = parseArguments(argc, argv, argumentsOk);
    if (!argumentsOk) {
        printUsage(argv[0]);
        return 2;
    }
    if (options.width < 8 || options.height < 8) {
        std::cerr << "Resolution is too small\n";
        return 2;
    }
    if (options.selfCheck) {
        return runSelfCheck() ? 0 : 1;
    }

    Scene scene = ocr::makeOffshoreScene();
    const Camera camera = makeCamera(options.width, options.height);
    std::vector<Preset> presets;
    if (options.all) {
        presets.push_back(corridorPreset());
        presets.push_back(topPreset());
    } else {
        presets.push_back(options.customPreset);
    }

    std::filesystem::create_directories(options.outputDirectory);
    std::vector<CutRun> runs;
    runs.reserve(presets.size());
    bool writeOk = true;
    for (const Preset& preset : presets) {
        const auto start = std::chrono::steady_clock::now();
        const std::string directory =
            options.outputDirectory + "/" + preset.id;
        CutRun run;
        std::cout << "Rendering cut '" << preset.id << "' at "
                  << options.width << 'x' << options.height << "..."
                  << std::endl;
        if (!renderCut(scene, camera, preset, options, directory, run)) {
            std::cerr << "Failed to write cut '" << preset.id << "'\n";
            writeOk = false;
            continue;
        }
        const auto end = std::chrono::steady_clock::now();
        const double seconds =
            std::chrono::duration<double>(end - start).count();
        std::cout << "  wrote " << directory << " in " << std::fixed
                  << std::setprecision(2) << seconds << " s\n";
        runs.push_back(std::move(run));
    }

    bool referenceRan = false;
    bool referencePass = true;
    if (writeOk && options.makeReference && !presets.empty()) {
        std::cout << "Rendering 160x90 brute-force reference..."
                  << std::endl;
        const auto start = std::chrono::steady_clock::now();
        referenceRan = true;
        const Preset& referencePreset =
            presets.front().id == "top" ? corridorPreset() : presets.front();
        const bool wroteReference =
            renderReference(scene, camera, referencePreset, options,
                            options.outputDirectory, referencePass);
        const auto end = std::chrono::steady_clock::now();
        const double seconds =
            std::chrono::duration<double>(end - start).count();
        std::cout << "  brute reference "
                  << (referencePass ? "matched" : "MISMATCHED")
                  << " in " << std::fixed << std::setprecision(2)
                  << seconds << " s\n";
        writeOk = writeOk && wroteReference;
    }

    bool summaryPass = false;
    const bool summaryWritten =
        writeSummary(options.outputDirectory, options, camera, runs,
                     referencePass, referenceRan, summaryPass);
    writeOk = writeOk && summaryWritten && !runs.empty() && summaryPass;

    std::cout << "Channels and validation: "
              << options.outputDirectory << '\n';
    return writeOk ? 0 : 3;
}
