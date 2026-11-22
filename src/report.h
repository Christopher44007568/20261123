#pragma once

#include "formfactor.h"
#include "solver.h"

#include <string>

namespace rad {

struct ReportContext {
    int imageWidth = 960;
    int imageHeight = 540;
    double exposure = 1.0;
    double formFactorSeconds = 0.0;
    double solveSeconds = 0.0;
    double renderSeconds = 0.0;
};

bool writeJsonReport(const std::string& path, const Scene& scene,
                     const FormFactorMatrix& formFactors,
                     const RadiosityResult& result, const ReportContext& context);
bool writeMarkdownReport(const std::string& path, const Scene& scene,
                         const FormFactorMatrix& formFactors,
                         const RadiosityResult& result, const ReportContext& context);
bool writeEnergyTrace(const std::string& path, const RadiosityResult& result);

}  // namespace rad
