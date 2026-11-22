#include "report.h"

#include <array>
#include <fstream>
#include <iomanip>
#include <sstream>

namespace rad {
namespace {

double totalArea(const Scene& scene) {
    double area = 0.0;
    for (const Patch& patch : scene.patches) {
        area += patch.area;
    }
    return area;
}

int emitterCount(const Scene& scene) {
    int count = 0;
    for (const Patch& patch : scene.patches) {
        if (patch.isEmitter()) {
            ++count;
        }
    }
    return count;
}

std::string vecText(const Vec3& value, int precision = 3) {
    std::ostringstream out;
    out << std::fixed << std::setprecision(precision)
        << '(' << value.x << ", " << value.y << ", " << value.z << ')';
    return out.str();
}

bool jsonBool(bool value) { return value; }

}  // namespace

bool writeJsonReport(const std::string& path, const Scene& scene,
                     const FormFactorMatrix& formFactors,
                     const RadiosityResult& result, const ReportContext& context) {
    std::ofstream out(path);
    if (!out) {
        return false;
    }
    out << std::setprecision(12);
    out << "{\n";
    out << "  \"scene\": {\n";
    out << "    \"patch_count\": " << scene.patches.size() << ",\n";
    out << "    \"emitter_patch_count\": " << emitterCount(scene) << ",\n";
    out << "    \"total_surface_area_m2\": " << totalArea(scene) << ",\n";
    out << "    \"bounds_min\": [" << scene.bounds().lo.x << ", " << scene.bounds().lo.y
        << ", " << scene.bounds().lo.z << "],\n";
    out << "    \"bounds_max\": [" << scene.bounds().hi.x << ", " << scene.bounds().hi.y
        << ", " << scene.bounds().hi.z << "]\n";
    out << "  },\n";
    out << "  \"form_factors\": {\n";
    out << "    \"samples_per_axis\": " << formFactors.stats().samplesPerAxis << ",\n";
    out << "    \"stored_entries\": " << formFactors.stats().storedEntries << ",\n";
    out << "    \"visible_sample_rays\": " << formFactors.stats().sampleRays << ",\n";
    out << "    \"inactive_occluded_rows\": " << formFactors.stats().inactiveRows << ",\n";
    out << "    \"raw_row_sum_min\": " << formFactors.stats().minRawRowSum << ",\n";
    out << "    \"raw_row_sum_mean\": " << formFactors.stats().meanRawRowSum << ",\n";
    out << "    \"raw_row_sum_max\": " << formFactors.stats().maxRawRowSum << ",\n";
    out << "    \"normalized_row_sum_min\": " << formFactors.stats().minNormalizedRowSum << ",\n";
    out << "    \"normalized_row_sum_max\": " << formFactors.stats().maxNormalizedRowSum << ",\n";
    out << "    \"build_seconds\": " << context.formFactorSeconds << "\n";
    out << "  },\n";
    out << "  \"solver\": {\n";
    out << "    \"converged\": " << jsonBool(result.convergedToTolerance) << ",\n";
    out << "    \"iterations\": " << result.energy.iterations << ",\n";
    out << "    \"initial_emitter_shots\": " << result.energy.initialEmitterShots << ",\n";
    out << "    \"equivalent_sweeps\": " << result.energy.equivalentSweeps << ",\n";
    out << "    \"final_residual\": " << result.energy.finalResidual << ",\n";
    out << "    \"final_patch_error\": " << result.energy.finalPatchError << ",\n";
    out << "    \"max_conservation_drift\": " << result.energy.maxConservationDrift << ",\n";
    out << "    \"solve_seconds\": " << context.solveSeconds << "\n";
    out << "  },\n";
    out << "  \"energy\": {\n";
    out << "    \"emitted_power\": " << result.energy.emittedPower << ",\n";
    out << "    \"absorbed_power\": " << result.energy.absorbedPower << ",\n";
    out << "    \"unshot_power\": " << result.energy.unshotPower << ",\n";
    out << "    \"absorbed_plus_unshot\": " << result.energy.conservedPower << ",\n";
    out << "    \"relative_residual\": " << result.energy.finalResidual << "\n";
    out << "  },\n";
    out << "  \"color_bleed\": {\n";
    out << "    \"red_emitter_patches\": " << result.colorBleed.redEmitterPatches << ",\n";
    out << "    \"red_emitter_power\": " << result.colorBleed.redEmitterPower << ",\n";
    out << "    \"max_wall_red_bias\": " << result.colorBleed.maxWallRedBias << ",\n";
    out << "    \"mean_near_wall_red_bias\": " << result.colorBleed.meanNearWallRedBias << ",\n";
    out << "    \"max_near_wall_red_bias\": " << result.colorBleed.maxNearWallRedBias << ",\n";
    out << "    \"near_wall_patches\": " << result.colorBleed.nearWallPatches << ",\n";
    out << "    \"indirect_red_boost\": " << result.colorBleed.indirectRedBoost << ",\n";
    out << "    \"max_patch\": " << result.colorBleed.maxPatch << ",\n";
    out << "    \"max_location\": [" << result.colorBleed.maxLocation.x << ", "
        << result.colorBleed.maxLocation.y << ", " << result.colorBleed.maxLocation.z << "],\n";
    out << "    \"max_distance_to_lamp\": " << result.colorBleed.maxDistanceToLamp << "\n";
    out << "  },\n";
    out << "  \"contact_occlusion\": {\n";
    out << "    \"passed\": " << jsonBool(result.contact.passed) << ",\n";
    out << "    \"probes\": [\n";
    for (std::size_t i = 0; i < result.contact.probes.size(); ++i) {
        const ContactProbe& probe = result.contact.probes[i];
        out << "      {\"name\": \"" << probe.name << "\", \"patch_count\": "
            << probe.patchCount << ", \"max_direct_form_factor\": "
            << probe.maxDirectFormFactor << ", \"unoccluded_fraction\": "
            << probe.unoccludedFraction << ", \"passed\": "
            << jsonBool(probe.passed) << "}";
        out << (i + 1 < result.contact.probes.size() ? ",\n" : "\n");
    }
    out << "    ]\n";
    out << "  },\n";
    out << "  \"render\": {\n";
    out << "    \"width\": " << context.imageWidth << ",\n";
    out << "    \"height\": " << context.imageHeight << ",\n";
    out << "    \"exposure\": " << context.exposure << ",\n";
    out << "    \"render_seconds\": " << context.renderSeconds << "\n";
    out << "  }\n";
    out << "}\n";
    return static_cast<bool>(out);
}

bool writeMarkdownReport(const std::string& path, const Scene& scene,
                         const FormFactorMatrix& formFactors,
                         const RadiosityResult& result, const ReportContext& context) {
    std::ofstream out(path);
    if (!out) {
        return false;
    }
    out << "# 地下避难所控制厅 · 辐射度求解报告\n\n";
    out << "## 场景与 patch\n\n";
    out << "- Patch 数：**" << scene.patches.size() << "**\n";
    out << "- 发光 patch 数：" << emitterCount(scene) << "\n";
    out << "- 总表面积：" << std::fixed << std::setprecision(2)
        << totalArea(scene) << " m²\n";
    out << "- 形状因子采样：每个轴向 " << formFactors.stats().samplesPerAxis
        << " 点，可见采样光线 " << formFactors.stats().sampleRays << " 条\n";
    out << "- 完全被设备遮挡的不可达 patch：" << formFactors.stats().inactiveRows
        << " 个（仍保留用于接触遮挡验证，不参与能量传播）\n";
    out << "- 原始行和范围：[" << std::setprecision(6)
        << formFactors.stats().minRawRowSum << ", "
        << formFactors.stats().maxRawRowSum << "]，归一化后行和范围：["
        << formFactors.stats().minNormalizedRowSum << ", "
        << formFactors.stats().maxNormalizedRowSum << "]\n\n";

    out << "## 收敛与能量守恒\n\n";
    out << "- 状态：" << (result.convergedToTolerance ? "已收敛" : "未达到容差") << "\n";
    out << "- 逐 patch 能量发射迭代次数：**" << result.energy.iterations << "**\n";
    out << "- 等效完整扫描：" << result.energy.equivalentSweeps << " 轮\n";
    out << "- 最终未传递能量比（误差）：" << std::scientific
        << std::setprecision(6) << result.energy.finalResidual << "\n";
    out << "- 最大单 patch 未传递能量比：" << result.energy.finalPatchError << "\n";
    out << "- 总发射功率：" << std::fixed << std::setprecision(4)
        << result.energy.emittedPower << " W\n";
    out << "- 累计吸收功率：" << result.energy.absorbedPower << " W\n";
    out << "- 剩余未传递功率：" << result.energy.unshotPower << " W\n";
    out << "- 吸收 + 未传递：" << result.energy.conservedPower << " W\n";
    out << "- 迭代中最大守恒漂移：" << std::scientific
        << std::setprecision(6) << result.energy.maxConservationDrift << "\n\n";
    if (!result.energy.trace.empty()) {
        out << "能量轨迹抽检（完整逐次记录见 `energy_trace.csv`）：\n\n";
        out << "| 迭代 | 吸收 W | 未传递 W | 合计 W | 相对漂移 |\n";
        out << "|---:|---:|---:|---:|---:|\n";
        const std::size_t last = result.energy.trace.size() - 1;
        const std::array<std::size_t, 5> picks = {
            0, last / 4, last / 2, (last * 3) / 4, last};
        for (std::size_t pick : picks) {
            const EnergySample& sample = result.energy.trace[pick];
            out << "| " << sample.iteration << " | " << std::fixed
                << std::setprecision(5) << sample.absorbed << " | "
                << sample.unshot << " | " << sample.conserved << " | "
                << std::scientific << std::setprecision(3) << sample.drift << " |\n";
        }
        out << '\n';
    }

    out << "## 红色设备灯颜色溢出\n\n";
    out << "- 红色设备灯发光功率：" << std::fixed << std::setprecision(6)
        << result.colorBleed.redEmitterPower << " W\n";
    out << "- 白墙最大红色偏置：" << std::setprecision(3)
        << (100.0 * result.colorBleed.maxWallRedBias) << "%\n";
    out << "- 灯具 2.6 m 内白墙平均红色偏置：" << (100.0 * result.colorBleed.meanNearWallRedBias)
        << "%\n";
    out << "- 灯具 2.6 m 内白墙最大红色偏置：" << (100.0 * result.colorBleed.maxNearWallRedBias)
        << "%\n";
    out << "- 间接反弹带来的额外红色偏置：" << (100.0 * result.colorBleed.indirectRedBoost)
        << " 个百分点\n";
    out << "- 最大偏置 patch：" << result.colorBleed.maxPatch << "，位置 "
        << vecText(result.colorBleed.maxLocation) << "，距灯 "
        << std::setprecision(2) << result.colorBleed.maxDistanceToLamp << " m\n\n";
    out << "红色偏置按白墙的 `max(0, R - (G+B)/2) / (R+G)` 计算；"
           "白色主灯三通道相同，因此该值量化红色设备灯的通道溢出。\n\n";

    out << "## 近距离接触遮挡\n\n";
    out << "以下探针均从灯具直接投向被设备遮挡的表面。可见形状因子为 0 才算无漏光。\n\n";
    out << "| 探针 | patch 数 | 最大形状因子 | 未遮挡比例 | 结果 |\n";
    out << "|---|---:|---:|---:|---|\n";
    for (const ContactProbe& probe : result.contact.probes) {
        out << "| " << probe.name << " | " << probe.patchCount << " | "
            << std::scientific << std::setprecision(3)
            << probe.maxDirectFormFactor << " | " << std::fixed
            << std::setprecision(2) << (100.0 * probe.unoccludedFraction) << "% | "
            << (probe.passed ? "通过" : "失败") << " |\n";
    }
    out << "\n总体：" << (result.contact.passed ? "通过，无接触漏光" : "失败") << "。\n\n";

    out << "## 视图与文件\n\n";
    out << "- `first_pass.bmp` / `first_pass.ppm`：首轮直接光\n";
    out << "- `converged.bmp` / `converged.ppm`：收敛结果\n";
    out << "- `indirect_only.bmp` / `indirect_only.ppm`：仅间接反弹\n";
    out << "- `energy_trace.csv`：每次迭代的吸收、未传递与守恒漂移\n";
    out << "- 渲染：" << context.imageWidth << "×" << context.imageHeight
        << "，曝光 " << std::setprecision(3) << context.exposure << "\n";
    return static_cast<bool>(out);
}

bool writeEnergyTrace(const std::string& path, const RadiosityResult& result) {
    std::ofstream out(path);
    if (!out) {
        return false;
    }
    out << "iteration,absorbed_power,unshot_power,absorbed_plus_unshot,"
           "emitted_power,relative_drift\n";
    out << std::setprecision(14);
    for (const EnergySample& sample : result.energy.trace) {
        out << sample.iteration << ',' << sample.absorbed << ',' << sample.unshot << ','
            << sample.conserved << ',' << result.energy.emittedPower << ','
            << sample.drift << '\n';
    }
    return static_cast<bool>(out);
}

}  // namespace rad
