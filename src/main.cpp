#include "render.h"
#include <cstdio>
#include <cstring>
#include <string>
#include <cmath>

static void writePPM(const Image& img, const std::string& path, double exposure) {
    FILE* f = fopen(path.c_str(), "wb");
    fprintf(f, "P6\n%d %d\n255\n", img.w, img.h);
    for (int y = 0; y < img.h; y++)
        for (int x = 0; x < img.w; x++) {
            Vec3 c = img.at(x, y) * exposure;
            unsigned char rgb[3];
            const double* ch = &c.x;
            for (int i = 0; i < 3; i++) {
                double v = ch[i] / (1.0 + ch[i]);            // Reinhard
                v = std::pow(std::max(0.0, v), 1.0 / 2.2);   // gamma
                rgb[i] = (unsigned char)(std::min(1.0, v) * 255.0 + 0.5);
            }
            fwrite(rgb, 1, 3, f);
        }
    fclose(f);
}

static void writePFM(const Image& img, const std::string& path) {
    FILE* f = fopen(path.c_str(), "wb");
    fprintf(f, "PF\n%d %d\n-1.0\n", img.w, img.h); // little-endian, scale 1.0
    for (int y = img.h - 1; y >= 0; y--)           // PFM is bottom-up
        for (int x = 0; x < img.w; x++) {
            Vec3 c = img.at(x, y);
            float rgb[3] = {(float)c.x, (float)c.y, (float)c.z};
            fwrite(rgb, sizeof(float), 3, f);
        }
    fclose(f);
}

static double lum(const Vec3& c) { return 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z; }

struct ROI { int x0, y0, x1, y1; };

// centroid of excess luminance (above mean + 0.5*std) within ROI: robust caustic position
static void centroid(const Image& img, const ROI& r, double& cx, double& cy, double& mass) {
    double sx = 0, sy = 0, sw = 0, s = 0, s2 = 0;
    long long n = 0;
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0; x < r.x1; x++) {
            double l = lum(img.at(x, y));
            s += l; s2 += l * l; n++;
        }
    double mean = s / n, var = std::max(0.0, s2 / n - mean * mean);
    double th = mean + 0.5 * std::sqrt(var);
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0; x < r.x1; x++) {
            double w = lum(img.at(x, y)) - th;
            if (w > 0) { sx += x * w; sy += y * w; sw += w; }
        }
    cx = sw > 0 ? sx / sw : 0; cy = sw > 0 ? sy / sw : 0; mass = sw;
}

static Image readPFM(const std::string& path) {
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path.c_str()); exit(1); }
    char magic[3] = {0, 0, 0};
    int w = 0, h = 0; double scale = 0;
    if (fscanf(f, "%2s", magic) != 1 || magic[0] != 'P' || magic[1] != 'F') {
        fprintf(stderr, "%s: not a color PFM\n", path.c_str()); exit(1);
    }
    if (fscanf(f, "%d %d %lf", &w, &h, &scale) != 3) { fprintf(stderr, "bad PFM header\n"); exit(1); }
    fgetc(f); // single whitespace after header
    Image img(w, h);
    std::vector<float> buf((size_t)w * h * 3);
    if (fread(buf.data(), sizeof(float), buf.size(), f) != buf.size()) {
        fprintf(stderr, "%s: truncated\n", path.c_str()); exit(1);
    }
    fclose(f);
    for (int y = 0; y < h; y++)       // PFM is bottom-up
        for (int x = 0; x < w; x++) {
            size_t i = ((size_t)(h - 1 - y) * w + x) * 3;
            img.at(x, y) = Vec3(buf[i], buf[i + 1], buf[i + 2]);
        }
    return img;
}

static double rmse(const Image& a, const Image& b, const ROI& r) {
    double s = 0; long long n = 0;
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0; x < r.x1; x++) {
            double d = lum(a.at(x, y)) - lum(b.at(x, y));
            s += d * d; n++;
        }
    return std::sqrt(s / n);
}

static double meanLum(const Image& img, const ROI& r) {
    double s = 0; long long n = 0;
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0; x < r.x1; x++) { s += lum(img.at(x, y)); n++; }
    return s / n;
}

// mean absolute horizontal gradient (edge sharpness of caustics)
static double edgeSharpness(const Image& img, const ROI& r) {
    double s = 0; long long n = 0;
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0 + 1; x < r.x1; x++) {
            s += std::fabs(lum(img.at(x, y)) - lum(img.at(x - 1, y))); n++;
        }
    return s / n;
}

// count of isolated bright outliers (stray speckles) via median + k*MAD
static int straySpots(const Image& img, const ROI& r) {
    std::vector<double> v;
    for (int y = r.y0; y < r.y1; y++)
        for (int x = r.x0; x < r.x1; x++) v.push_back(lum(img.at(x, y)));
    std::vector<double> sorted = v;
    std::nth_element(sorted.begin(), sorted.begin() + sorted.size() / 2, sorted.end());
    double med = sorted[sorted.size() / 2];
    std::vector<double> dev;
    for (double l : v) dev.push_back(std::fabs(l - med));
    std::nth_element(dev.begin(), dev.begin() + dev.size() / 2, dev.end());
    double mad = dev[dev.size() / 2];
    double th = med + 8.0 * (mad + 1e-6);
    int cnt = 0;
    for (double l : v) if (l > th) cnt++;
    return cnt;
}

static void printReport(const char* tag, const Params& P, const Stats& st) {
    printf("[%s] photons emitted=%lld stored=%lld (%.1f%%)\n", tag,
           st.photonsEmitted, st.photonsStored,
           100.0 * st.photonsStored / std::max(1LL, st.photonsEmitted));
    printf("[%s] caustic queries=%lld avg query radius=%.4f (max r: diffuse=%.2f glossy=%.2f)\n",
           tag, st.queries, st.queryRadiusSum / std::max(1LL, st.queries), P.rDiffuse, P.rGlossy);
    printf("[%s] time: photon trace=%.2fs  hash build=%.2fs  render=%.2fs  total=%.2fs\n",
           tag, st.tPhotons, st.tBuild, st.tRender, st.tPhotons + st.tBuild + st.tRender);
}

static void compare(const Image& pm, const Image& pt, const ROI& causticROI,
                    const ROI& smoothROI, const char* tag) {
    double pmx, pmy, pmm, ptx, pty, ptm;
    centroid(pm, causticROI, pmx, pmy, pmm);
    centroid(pt, causticROI, ptx, pty, ptm);
    double shift = std::hypot(pmx - ptx, pmy - pty);
    printf("[cmp %s] caustic centroid: PM=(%.1f,%.1f) PT=(%.1f,%.1f) shift=%.2f px\n",
           tag, pmx, pmy, ptx, pty, shift);
    printf("[cmp %s] indirect RMSE (caustic ROI)=%.4f  (smooth ROI)=%.4f\n",
           tag, rmse(pm, pt, causticROI), rmse(pm, pt, smoothROI));
    double mPMc = meanLum(pm, causticROI), mPTc = meanLum(pt, causticROI);
    double mPMs = meanLum(pm, smoothROI), mPTs = meanLum(pt, smoothROI);
    printf("[cmp %s] mean lum: caustic ROI PM=%.4f PT=%.4f | smooth ROI PM=%.4f PT=%.4f\n",
           tag, mPMc, mPTc, mPMs, mPTs);
    printf("[cmp %s] brightness conservation PM/PT: caustic ROI=%.3f  smooth ROI=%.3f\n",
           tag, mPMc / mPTc, mPMs / mPTs);
    printf("[cmp %s] caustic edge sharpness: PM=%.4f PT=%.4f | stray spots (smooth ROI): PM=%d PT=%d\n",
           tag, edgeSharpness(pm, causticROI), edgeSharpness(pt, causticROI),
           straySpots(pm, smoothROI), straySpots(pt, smoothROI));
}

int main(int argc, char** argv) {
    Params P;
    std::string mode = "all";        // pm | pt | all
    std::string outDir = "out";
    double exposure = 1.0;
    int photonsHigh = 0;             // if >0, run low+high density comparison
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        auto next = [&]() { return argv[++i]; };
        if (a == "--mode") mode = next();
        else if (a == "--w") P.w = atoi(next());
        else if (a == "--h") P.h = atoi(next());
        else if (a == "--photons") P.photons = atoi(next());
        else if (a == "--photons-high") photonsHigh = atoi(next());
        else if (a == "--gather") P.gatherRays = atoi(next());
        else if (a == "--knn") P.knn = atoi(next());
        else if (a == "--r-diffuse") P.rDiffuse = atof(next());
        else if (a == "--r-glossy") P.rGlossy = atof(next());
        else if (a == "--spp") P.sppPT = atoi(next());
        else if (a == "--viz") P.viz = atoi(next());
        else if (a == "--exposure") exposure = atof(next());
        else if (a == "--out") outDir = next();
        else { fprintf(stderr, "unknown arg %s\n", a.c_str()); return 1; }
    }

    // ROIs in screen space (fractions of resolution), tuned for the default camera
    auto mkROI = [&](double fx0, double fy0, double fx1, double fy1) {
        return ROI{(int)(fx0 * P.w), (int)(fy0 * P.h), (int)(fx1 * P.w), (int)(fy1 * P.h)};
    };
    ROI causticROI = mkROI(0.15, 0.60, 0.85, 0.95);  // pool basin caustic field
    ROI smoothROI  = mkROI(0.02, 0.35, 0.18, 0.65);  // smooth side wall (no caustics)

    if (mode == "compare") {
        // compare two existing PFM files: --out "<pm.pfm> <pt.pfm>"
        std::string f1 = outDir.substr(0, outDir.find(' '));
        std::string f2 = outDir.substr(outDir.find(' ') + 1);
        Image a = readPFM(f1), b = readPFM(f2);
        P.w = a.w; P.h = a.h;
        causticROI = mkROI(0.15, 0.60, 0.85, 0.95);
        smoothROI = mkROI(0.02, 0.35, 0.18, 0.65);
        compare(a, b, causticROI, smoothROI, "file");
        return 0;
    }

    Scene sc = buildSluiceScene();
    printf("scene: %zu primitives, %zu materials\n", sc.prims.size(), sc.mats.size());

    Image pmLow(P.w, P.h), pmHigh(P.w, P.h), ptRef(P.w, P.h);
    bool haveLow = false, haveHigh = false, havePT = false;

    auto runPM = [&](int nPhotons, const char* tag, Image& img) {
        Params q = P; q.photons = nPhotons;
        PhotonMap cmap, gmap;
        Stats st;
        tracePhotons(sc, q, cmap, gmap, st);
        printf("[%s] caustic map=%zu photons, global map=%zu photons\n",
               tag, cmap.photons.size(), gmap.photons.size());
        img = renderPM(sc, q, cmap, gmap, st);
        printReport(tag, q, st);
    };

    if (mode == "pm" || mode == "all") {
        runPM(P.photons, "pm-low", pmLow);
        writePPM(pmLow, outDir + "/pm_low.ppm", exposure);
        writePFM(pmLow, outDir + "/pm_low.pfm");
        haveLow = true;
        if (photonsHigh > 0) {
            runPM(photonsHigh, "pm-high", pmHigh);
            writePPM(pmHigh, outDir + "/pm_high.ppm", exposure);
            writePFM(pmHigh, outDir + "/pm_high.pfm");
            haveHigh = true;
        }
    }
    if (mode == "pt" || mode == "all") {
        double t = 0;
        ptRef = renderPT(sc, P, t);
        printf("[pt-ref] spp=%d time=%.2fs\n", P.sppPT, t);
        writePPM(ptRef, outDir + "/pt_ref.ppm", exposure);
        writePFM(ptRef, outDir + "/pt_ref.pfm");
        havePT = true;
    }
    if (havePT && haveLow) compare(pmLow, ptRef, causticROI, smoothROI, "low");
    if (havePT && haveHigh) compare(pmHigh, ptRef, causticROI, smoothROI, "high");
    if (haveLow && haveHigh) {
        printf("[converge] edge sharpness low=%.4f high=%.4f | stray spots low=%d high=%d\n",
               edgeSharpness(pmLow, causticROI), edgeSharpness(pmHigh, causticROI),
               straySpots(pmLow, smoothROI), straySpots(pmHigh, smoothROI));
    }
    return 0;
}
