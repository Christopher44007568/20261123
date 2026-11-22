#include "validate.hpp"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <map>
#include <sstream>

namespace ocr {
namespace {

bool closeVec(const Vec3& a, const Vec3& b, float epsilon = 1.0e-6f) {
    return std::fabs(a.x - b.x) <= epsilon &&
           std::fabs(a.y - b.y) <= epsilon &&
           std::fabs(a.z - b.z) <= epsilon;
}

std::string colorJson(const Vec3& c) {
    std::ostringstream out;
    out << '[' << std::fixed << std::setprecision(4)
        << c.x << ',' << c.y << ',' << c.z << ']';
    return out.str();
}

std::string indent(int spaces) {
    return std::string(static_cast<std::size_t>(spaces), ' ');
}

bool writeTextFile(const std::string& path, const std::string& text) {
    ensureParentDirectory(path);
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << text;
    return static_cast<bool>(out);
}

std::string probeJson(const MaterialProbe& probe, int indentSpaces) {
    std::ostringstream out;
    out << indent(indentSpaces) << "{\n"
        << indent(indentSpaces + 2) << "\"label\": \""
        << escapeJson(probe.label) << "\",\n"
        << indent(indentSpaces + 2) << "\"x\": " << probe.x << ",\n"
        << indent(indentSpaces + 2) << "\"y\": " << probe.y << ",\n"
        << indent(indentSpaces + 2) << "\"material\": "
        << probe.material << ",\n"
        << indent(indentSpaces + 2) << "\"objectId\": "
        << probe.objectId << ",\n"
        << indent(indentSpaces + 2) << "\"primitiveId\": "
        << probe.primitiveId << ",\n"
        << indent(indentSpaces + 2) << "\"isSdf\": "
        << (probe.isSdf ? "true" : "false") << ",\n"
        << indent(indentSpaces + 2) << "\"depth\": " << std::fixed
        << std::setprecision(6) << probe.depth << ",\n"
        << indent(indentSpaces + 2) << "\"color\": "
        << colorJson(probe.color) << ",\n"
        << indent(indentSpaces + 2) << "\"normal\": "
        << colorJson(probe.normal) << "\n"
        << indent(indentSpaces) << '}';
    return out.str();
}

MaterialProbe findProbe(const RenderResult& render, const std::string& label,
                        const std::vector<int>& objectIds,
                        const std::vector<int>& materialIds) {
    MaterialProbe probe;
    probe.label = label;
    int bestScore = std::numeric_limits<int>::min();
    const float cx = 0.5f * static_cast<float>(render.width - 1);
    const float cy = 0.5f * static_cast<float>(render.height - 1);
    for (int y = 0; y < render.height; ++y) {
        for (int x = 0; x < render.width; ++x) {
            const PixelRecord& pixel = render.at(x, y);
            if (!pixel.hit) {
                continue;
            }
            const bool objectMatch =
                objectIds.empty() ||
                std::find(objectIds.begin(), objectIds.end(),
                          pixel.objectId) != objectIds.end();
            const bool materialMatch =
                materialIds.empty() ||
                std::find(materialIds.begin(), materialIds.end(),
                          pixel.material) != materialIds.end();
            if (!objectMatch || !materialMatch) {
                continue;
            }
            const int dx = static_cast<int>(std::lround(
                std::fabs(static_cast<float>(x) - cx)));
            const int dy = static_cast<int>(std::lround(
                std::fabs(static_cast<float>(y) - cy)));
            const int score = -(dx + dy);
            if (score > bestScore) {
                bestScore = score;
                probe.x = x;
                probe.y = y;
                probe.material = pixel.material;
                probe.objectId = pixel.objectId;
                probe.primitiveId = pixel.primitiveId;
                probe.isSdf = pixel.isSdf;
                probe.depth = pixel.depth;
                probe.color = pixel.color;
                probe.normal = pixel.normal;
            }
        }
    }
    return probe;
}

ImageRGB comparisonImage(const RenderResult& bvh, const RenderResult& brute) {
    ImageRGB image(bvh.width, bvh.height);
    for (int y = 0; y < bvh.height; ++y) {
        for (int x = 0; x < bvh.width; ++x) {
            const PixelRecord& a = bvh.at(x, y);
            const PixelRecord& b = brute.at(x, y);
            Vec3 color;
            if (!a.hit && !b.hit) {
                color = {0.025f, 0.07f, 0.10f};
            } else if (a.hit != b.hit) {
                color = {0.95f, 0.04f, 0.03f};
            } else if (a.material != b.material) {
                color = {0.95f, 0.025f, 0.70f};
            } else if (a.objectId != b.objectId ||
                       std::fabs(a.depth - b.depth) >
                           2.0e-4f * (1.0f + std::fabs(b.depth))) {
                color = {1.0f, 0.42f, 0.02f};
            } else {
                color = {0.03f, 0.76f, 0.28f};
            }
            image.at(x, y) = color;
        }
    }
    return image;
}

ImageRGB referenceSheet(const RenderResult& bvh, const RenderResult& brute,
                        const ImageRGB& comparison) {
    const int gap = 3;
    ImageRGB sheet(bvh.width * 3 + gap * 2, bvh.height);
    for (int y = 0; y < bvh.height; ++y) {
        for (int x = 0; x < bvh.width; ++x) {
            sheet.at(x, y) = toneMap(brute.at(x, y).color);
            sheet.at(x + bvh.width + gap, y) =
                toneMap(bvh.at(x, y).color);
            sheet.at(x + (bvh.width + gap) * 2, y) =
                comparison.at(x, y);
        }
    }
    for (int y = 0; y < bvh.height; ++y) {
        for (int x = 0; x < gap; ++x) {
            sheet.at(bvh.width + x, y) = {0.01f, 0.01f, 0.01f};
            sheet.at(bvh.width * 2 + gap + x, y) = {0.01f, 0.01f, 0.01f};
        }
    }
    return sheet;
}

}  // namespace

std::string escapeJson(const std::string& value) {
    std::string result;
    result.reserve(value.size() + 8);
    for (char c : value) {
        switch (c) {
            case '\\': result += "\\\\"; break;
            case '"': result += "\\\""; break;
            case '\n': result += "\\n"; break;
            case '\r': result += "\\r"; break;
            case '\t': result += "\\t"; break;
            default: result += c; break;
        }
    }
    return result;
}

ChannelValidation validateChannels(const RenderResult& render) {
    ChannelValidation validation;
    validation.pixels = static_cast<std::int64_t>(render.width) *
                        render.height;
    for (const PixelRecord& pixel : render.pixels) {
        if (pixel.hit) {
            ++validation.hitPixels;
            const bool validDepth =
                std::isfinite(pixel.depth) && pixel.depth > 0.0f;
            const bool validNormal =
                std::isfinite(pixel.normal.x) &&
                std::isfinite(pixel.normal.y) &&
                std::isfinite(pixel.normal.z) &&
                std::fabs(length(pixel.normal) - 1.0f) < 2.0e-3f;
            const bool validMaterial = pixel.material > 0;
            if (validDepth) {
                ++validation.depthsMatched;
            }
            if (validNormal) {
                ++validation.normalsMatched;
            }
            if (validMaterial) {
                ++validation.materialIdsMatched;
                ++validation.materialsMatched;
            }
        } else {
            ++validation.skyPixels;
            if (pixel.material == 0) {
                ++validation.materialIdsMatched;
                ++validation.materialsMatched;
            }
            ++validation.depthsMatched;
            ++validation.normalsMatched;
        }
        if (std::isfinite(pixel.color.x) &&
            std::isfinite(pixel.color.y) &&
            std::isfinite(pixel.color.z)) {
            ++validation.colorsMatched;
        }
    }

    validation.probes.push_back(
        findProbe(render, "corridor_interior", {7}, {7}));
    validation.probes.push_back(
        findProbe(render, "cable_tray", {10}, {8}));
    validation.probes.push_back(
        findProbe(render, "sdf_cable", {31, 32, 33, 34}, {}));
    validation.probes.push_back(
        findProbe(render, "seawater_base", {12}, {}));
    validation.probes.push_back(
        findProbe(render, "transformer_cabin", {6}, {}));
    validation.probes.push_back(
        findProbe(render, "curved_shroud", {20, 21}, {13}));
    return validation;
}

bool writeChannels(const std::string& outputDirectory,
                   const RenderResult& render,
                   const ImageRGB& cutPreview, const Scene& scene,
                   const CutPreviewStats& previewStats,
                   ChannelValidation* validation) {
    std::error_code ec;
    std::filesystem::create_directories(outputDirectory, ec);
    if (ec) {
        return false;
    }

    ImageRGB color(render.width, render.height);
    ImageRGB normal(render.width, render.height);
    ImageRGB material(render.width, render.height);
    ImageFloat depth(render.width, render.height, 0.0f);
    ImageID materialIds(render.width, render.height);

    for (int y = 0; y < render.height; ++y) {
        for (int x = 0; x < render.width; ++x) {
            const PixelRecord& pixel = render.at(x, y);
            color.at(x, y) = toneMap(pixel.color);
            normal.at(x, y) = pixel.hit ? encodeNormal(pixel.normal)
                                        : Vec3{0.0f, 0.0f, 0.0f};
            material.at(x, y) = materialPreviewColor(pixel.material);
            materialIds.at(x, y) =
                static_cast<std::uint16_t>(clampf(
                    static_cast<float>(pixel.material), 0.0f, 65535.0f));
            depth.at(x, y) = pixel.hit ? pixel.depth : 0.0f;
        }
    }

    const bool ok =
        writePPM(outputDirectory + "/color.ppm", color) &&
        writePFM(outputDirectory + "/depth.pfm", depth) &&
        writeDepthPGM16(outputDirectory + "/depth.pgm", depth,
                        0.25f, 110.0f) &&
        writePPM(outputDirectory + "/normal.ppm", normal) &&
        writePPM(outputDirectory + "/material.ppm", material) &&
        writePGM16(outputDirectory + "/material_ids.pgm", materialIds) &&
        writePPM(outputDirectory + "/cut_preview.ppm", cutPreview);
    if (!ok) {
        return false;
    }

    ChannelValidation checks = validateChannels(render);
    checks.materialIdsMatched = 0;
    checks.materialsMatched = 0;
    checks.depthsMatched = 0;
    checks.normalsMatched = 0;
    checks.colorsMatched = 0;
    for (int y = 0; y < render.height; ++y) {
        for (int x = 0; x < render.width; ++x) {
            const PixelRecord& pixel = render.at(x, y);
            if (materialIds.at(x, y) ==
                static_cast<std::uint16_t>(pixel.material)) {
                ++checks.materialIdsMatched;
            }
            if (closeVec(material.at(x, y),
                         materialPreviewColor(pixel.material))) {
                ++checks.materialsMatched;
            }
            const float expectedDepth = pixel.hit ? pixel.depth : 0.0f;
            if (depth.at(x, y) == expectedDepth) {
                ++checks.depthsMatched;
            }
            const Vec3 expectedNormal =
                pixel.hit ? encodeNormal(pixel.normal)
                          : Vec3{0.0f, 0.0f, 0.0f};
            if (closeVec(normal.at(x, y), expectedNormal)) {
                ++checks.normalsMatched;
            }
            if (closeVec(color.at(x, y), toneMap(pixel.color))) {
                ++checks.colorsMatched;
            }
        }
    }
    if (validation != nullptr) {
        *validation = checks;
    }

    std::ostringstream materialsJson;
    materialsJson << "{\n  \"materials\": [\n";
    for (std::size_t i = 0; i < scene.materials.size(); ++i) {
        const Material& m = scene.materials[i];
        materialsJson << "    {\"id\": " << m.id << ", \"name\": \""
                      << escapeJson(m.name) << "\", \"previewRGB\": "
                      << colorJson(materialPreviewColor(m.id)) << "}";
        if (i + 1 != scene.materials.size()) {
            materialsJson << ',';
        }
        materialsJson << '\n';
    }
    materialsJson << "  ]\n}\n";
    if (!writeTextFile(outputDirectory + "/materials.json",
                       materialsJson.str())) {
        return false;
    }

    std::ostringstream channelsJson;
    channelsJson << "{\n"
                 << "  \"width\": " << render.width << ",\n"
                 << "  \"height\": " << render.height << ",\n"
                 << "  \"channels\": {\n"
                 << "    \"color\": \"color.ppm\",\n"
                 << "    \"depth_exact\": \"depth.pfm\",\n"
                 << "    \"depth_preview\": \"depth.pgm\",\n"
                 << "    \"normal\": \"normal.ppm\",\n"
                 << "    \"material\": \"material.ppm\",\n"
                 << "    \"material_ids\": \"material_ids.pgm\",\n"
                 << "    \"cut_preview\": \"cut_preview.ppm\"\n"
                 << "  },\n"
                 << "  \"encodings\": {\n"
                 << "    \"depth.pfm\": \"float32 ray distance; 0 means miss\",\n"
                 << "    \"depth.pgm\": \"uint16 near=65535, far/miss=0, range 0.25..110\",\n"
                 << "    \"normal.ppm\": \"n*0.5+0.5; miss is black\",\n"
                 << "    \"material_ids.pgm\": \"uint16 exact material id\",\n"
                 << "    \"material.ppm\": \"stable palette, see materials.json\",\n"
                 << "    \"cut_preview.ppm\": \"orange triangle/plane, cyan SDF/plane; x-ray overlay\"\n"
                 << "  },\n"
                 << "  \"validation\": {\n"
                 << "    \"pixels\": " << checks.pixels << ",\n"
                 << "    \"hitPixels\": " << checks.hitPixels << ",\n"
                 << "    \"skyPixels\": " << checks.skyPixels << ",\n"
                 << "    \"materialIdPixelsMatched\": "
                 << checks.materialIdsMatched << ",\n"
                 << "    \"materialChannelPixelsMatched\": "
                 << checks.materialsMatched << ",\n"
                 << "    \"depthPixelsMatched\": " << checks.depthsMatched
                 << ",\n"
                 << "    \"normalPixelsMatched\": " << checks.normalsMatched
                 << ",\n"
                 << "    \"colorPixelsMatched\": " << checks.colorsMatched
                 << "\n"
                 << "  },\n"
                 << "  \"cutPreview\": {\"triangleSegments\": "
                 << previewStats.triangleSegments
                 << ", \"sdfSegments\": " << previewStats.sdfSegments
                 << "},\n"
                 << "  \"probes\": [\n";
    for (std::size_t i = 0; i < checks.probes.size(); ++i) {
        channelsJson << probeJson(checks.probes[i], 4);
        if (i + 1 != checks.probes.size()) {
            channelsJson << ',';
        }
        channelsJson << '\n';
    }
    channelsJson << "  ]\n}\n";
    return writeTextFile(outputDirectory + "/channels.json",
                         channelsJson.str());
}

ReferenceComparison compareRenders(const RenderResult& bvh,
                                   const RenderResult& brute) {
    ReferenceComparison comparison;
    comparison.width = std::min(bvh.width, brute.width);
    comparison.height = std::min(bvh.height, brute.height);
    for (int y = 0; y < comparison.height; ++y) {
        for (int x = 0; x < comparison.width; ++x) {
            const PixelRecord& a = bvh.at(x, y);
            const PixelRecord& b = brute.at(x, y);
            if (!a.hit && !b.hit) {
                ++comparison.bothMissPixels;
                ++comparison.exactPixels;
                continue;
            }
            if (a.hit != b.hit) {
                ++comparison.hitPresenceMismatches;
            } else {
                const bool materialMismatch = a.material != b.material;
                const bool depthMismatch =
                    std::fabs(a.depth - b.depth) >
                    2.0e-4f * (1.0f + std::fabs(b.depth));
                const bool firstHitMismatch =
                    a.objectId != b.objectId ||
                    a.isSdf != b.isSdf || depthMismatch;
                if (materialMismatch) {
                    ++comparison.materialMismatches;
                }
                if (firstHitMismatch) {
                    ++comparison.firstHitMismatches;
                }
                if (depthMismatch) {
                    ++comparison.depthMismatches;
                }
                if (!materialMismatch && !firstHitMismatch) {
                    ++comparison.exactPixels;
                }
                comparison.maxDepthError =
                    std::max(comparison.maxDepthError,
                             static_cast<double>(
                                 std::fabs(a.depth - b.depth)));
                if ((materialMismatch || firstHitMismatch) &&
                    comparison.mismatchExamples.size() < 12) {
                    MaterialProbe example;
                    example.label = materialMismatch
                                        ? "material_mismatch"
                                        : "first_hit_mismatch";
                    example.x = x;
                    example.y = y;
                    example.material = b.material;
                    example.objectId = b.objectId;
                    example.depth = b.depth;
                    example.color = b.color;
                    example.normal = b.normal;
                    comparison.mismatchExamples.push_back(example);
                }
            }
        }
    }
    return comparison;
}

bool writeReferenceOutputs(const std::string& outputDirectory,
                           const RenderResult& bvh,
                           const RenderResult& brute,
                           const ImageRGB& brutePreview,
                           const Scene& scene,
                           const CutPreviewStats& previewStats,
                           const ReferenceComparison& comparison) {
    const std::string referenceDirectory = outputDirectory + "/brute_reference";
    ChannelValidation validation;
    if (!writeChannels(referenceDirectory, brute, brutePreview, scene,
                       previewStats, &validation)) {
        return false;
    }
    const ImageRGB bvhPreview = buildCutPreview(scene, bvh.camera, bvh);
    if (!writeChannels(outputDirectory + "/bvh_reference", bvh, bvhPreview,
                       scene, previewStats, nullptr)) {
        return false;
    }
    const ImageRGB comparisonMask = comparisonImage(bvh, brute);
    const ImageRGB sheet = referenceSheet(bvh, brute, comparisonMask);
    if (!writePPM(outputDirectory + "/comparison_mask.ppm", comparisonMask) ||
        !writePPM(outputDirectory + "/reference_sheet.ppm", sheet)) {
        return false;
    }

    std::ostringstream json;
    json << "{\n"
         << "  \"reference\": \"brute_reference/color.ppm\",\n"
         << "  \"bvh_image\": \"bvh_reference/color.ppm\",\n"
         << "  \"comparison_mask\": \"comparison_mask.ppm\",\n"
         << "  \"contact_sheet\": \"reference_sheet.ppm\",\n"
         << "  \"contact_sheet_order\": "
            "[\"brute_color\", \"bvh_color\", \"comparison_mask\"],\n"
         << "  \"width\": " << comparison.width << ",\n"
         << "  \"height\": " << comparison.height << ",\n"
         << "  \"comparison\": {\n"
         << "    \"exactPixels\": " << comparison.exactPixels << ",\n"
         << "    \"bothMissPixels\": " << comparison.bothMissPixels << ",\n"
         << "    \"hitPresenceMismatches\": "
         << comparison.hitPresenceMismatches << ",\n"
         << "    \"materialMismatches\": "
         << comparison.materialMismatches << ",\n"
         << "    \"firstHitMismatches\": "
         << comparison.firstHitMismatches << ",\n"
         << "    \"depthMismatches\": "
         << comparison.depthMismatches << ",\n"
         << "    \"maxDepthError\": " << std::setprecision(9)
         << comparison.maxDepthError << ",\n"
         << "    \"passed\": " << (comparison.pass() ? "true" : "false")
         << "\n"
         << "  },\n"
         << "  \"bruteReferenceTextureChecks\": {\n"
         << "    \"materialIdPixelsMatched\": "
         << validation.materialIdsMatched << ",\n"
         << "    \"pixels\": " << validation.pixels << "\n"
         << "  },\n"
         << "  \"mismatchExamples\": [\n";
    for (std::size_t i = 0; i < comparison.mismatchExamples.size(); ++i) {
        json << probeJson(comparison.mismatchExamples[i], 4);
        if (i + 1 != comparison.mismatchExamples.size()) {
            json << ',';
        }
        json << '\n';
    }
    json << "  ]\n}\n";
    return writeTextFile(outputDirectory + "/comparison.json", json.str());
}

}  // namespace ocr

