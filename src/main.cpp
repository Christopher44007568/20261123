#include <cstdio>
#include <cmath>
#include <filesystem>
#include <string>
#include <vector>
#include "render.h"

static void writePPM(const Image& img, const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "wb");
    std::fprintf(f, "P6\n%d %d\n255\n", img.w, img.h);
    for (int y = 0; y < img.h; y++)
        for (int x = 0; x < img.w; x++) {
            Vec3 c = img.at(x, y);
            unsigned char rgb[3];
            rgb[0] = (unsigned char)(clampd(c.x, 0, 1) * 255 + 0.5);
            rgb[1] = (unsigned char)(clampd(c.y, 0, 1) * 255 + 0.5);
            rgb[2] = (unsigned char)(clampd(c.z, 0, 1) * 255 + 0.5);
            std::fwrite(rgb, 1, 3, f);
        }
    std::fclose(f);
}

static double rmse(const Image& a, const Image& b) {
    double s = 0;
    long n = (long)a.w * a.h * 3;
    for (size_t i = 0; i < a.px.size(); i++) {
        s += (a.px[i].x - b.px[i].x) * (a.px[i].x - b.px[i].x);
        s += (a.px[i].y - b.px[i].y) * (a.px[i].y - b.px[i].y);
        s += (a.px[i].z - b.px[i].z) * (a.px[i].z - b.px[i].z);
    }
    return std::sqrt(s / n);
}

static double luma(const Vec3& c) { return 0.299 * c.x + 0.587 * c.y + 0.114 * c.z; }

// Mean per-pixel temporal stddev of luminance over pixels that stay on the
// target object in every frame (flicker measure for the far wall).
static double flicker(const std::vector<Image>& frames,
                      const std::vector<std::vector<int>>& masks, int obj) {
    int w = frames[0].w, h = frames[0].h;
    int F = (int)frames.size();
    double total = 0;
    long count = 0;
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) {
            bool onObj = true;
            for (int f = 0; f < F; f++)
                if (masks[f][(size_t)y * w + x] != obj) onObj = false;
            if (!onObj) continue;
            double mean = 0;
            for (int f = 0; f < F; f++) mean += luma(frames[f].at(x, y));
            mean /= F;
            double var = 0;
            for (int f = 0; f < F; f++) {
                double d = luma(frames[f].at(x, y)) - mean;
                var += d * d;
            }
            total += std::sqrt(var / F);
            count++;
        }
    return count ? total / count : 0.0;
}

int main() {
    const int W = 320, H = 240, FRAMES = 5, SPP_REF = 8;
    const double FIXED_MIP = 2.0;
    const std::string outDir = "artifacts/raydiff/";
    std::filesystem::create_directories(outDir);

    Scene scene = buildScene(512);
    const char* modeNames[3] = {"point", "fixedmip", "raydiff"};

    std::vector<Image> refFrames;
    std::vector<std::vector<Image>> modeFrames(3);
    std::vector<std::vector<std::vector<int>>> masks(3);
    std::vector<Stats> stats(FRAMES);

    for (int f = 0; f < FRAMES; f++) {
        // Low camera hugging the floor, dolly forward along the hall.
        double z = 0.5 + f * 0.45;
        Camera cam = Camera::lookAt(Vec3(0.0, 0.55, z), Vec3(0.3, 0.75, z + 8.0),
                                    55.0, W, H);
        refFrames.push_back(renderReference(scene, cam, SPP_REF));
        for (int m = 0; m < 3; m++) {
            std::vector<int> mask;
            Stats st;
            Stats* stp = (m == MODE_RAYDIFF) ? &stats[f] : &st;
            Image img = render(scene, cam, (Mode)m, FIXED_MIP, *stp, &mask);
            modeFrames[m].push_back(img);
            masks[m].push_back(mask);
            writePPM(img, outDir + "frame" + std::to_string(f) + "_" +
                          modeNames[m] + ".ppm");
            std::fprintf(stderr, "frame %d mode %s rmse=%.5f\n", f, modeNames[m],
                         rmse(img, refFrames.back()));
        }
        writePPM(refFrames.back(), outDir + "frame" + std::to_string(f) + "_ref.ppm");
    }

    FILE* out = std::fopen((outDir + "metrics.txt").c_str(), "w");
    std::fprintf(out, "=== Ray differential texture filtering comparison ===\n");
    std::fprintf(out, "resolution %dx%d, frames %d, reference %dx%d spp\n\n",
                 W, H, FRAMES, SPP_REF, SPP_REF);

    for (int m = 0; m < 3; m++) {
        double r = 0;
        for (int f = 0; f < FRAMES; f++) r += rmse(modeFrames[m][f], refFrames[f]);
        r /= FRAMES;
        double flWall = flicker(modeFrames[m], masks[m], OBJ_WALL);
        double flFloor = flicker(modeFrames[m], masks[m], OBJ_FLOOR);
        std::fprintf(out, "mode %-8s  mean RMSE vs ref = %.5f\n", modeNames[m], r);
        std::fprintf(out, "             far-wall flicker (temporal std) = %.5f\n", flWall);
        std::fprintf(out, "             floor    flicker (temporal std) = %.5f\n\n", flFloor);
    }

    std::fprintf(out, "--- ray differential statistics per frame ---\n");
    for (int f = 0; f < FRAMES; f++) {
        const Stats& s = stats[f];
        double avgMip = s.rays ? s.sumMip / s.rays : 0;
        double avgRatio = s.rays ? s.sumRatio / s.rays : 0;
        std::fprintf(out,
                     "frame %d: avg mip = %.3f, avg aniso stretch = %.2f, "
                     "extreme rays = %ld / %ld (%.2f%%)\n",
                     f, avgMip, avgRatio, s.extreme, s.rays,
                     s.rays ? 100.0 * s.extreme / s.rays : 0.0);
        std::fprintf(out,
                     "    breakdown: neighbor-miss %ld, ratio-clamp %ld, "
                     "degenerate-uv %ld, mip-lo %ld, mip-hi %ld\n",
                     s.missNeighbor, s.ratioClamp, s.degenerate, s.mipClampLo,
                     s.mipClampHi);
    }
    std::fclose(out);
    std::fprintf(stderr, "done. metrics in %smetrics.txt\n", outDir.c_str());
    return 0;
}
