#pragma once
#include "scene.h"
#include "photon.h"
#include <chrono>

struct Params {
    int w = 480, h = 360;
    int photons = 200000;      // emitted photons
    int gatherRays = 24;       // final-gather rays per shading point
    int knn = 60;              // photons per caustic query
    double rDiffuse = 0.25;    // max filter radius on diffuse surfaces
    double rGlossy = 0.08;     // max filter radius on glossy surfaces
    size_t globalCap = 600000; // global map size cap (subsampled, power rescaled)
    int sppPT = 64;            // path tracing samples per pixel
    int maxBounce = 6;
    Vec3 camPos{0.0, 2.6, 4.2};
    Vec3 camLook{0.0, 1.5, -1.2};
    Vec3 camUp{0, 1, 0};
    double fov = 55.0;         // vertical, degrees
    int viz = 0;               // 0=full 1=caustic only 2=direct only 3=indirect only
};

struct Image {
    int w, h;
    std::vector<Vec3> px;
    Image(int w_, int h_) : w(w_), h(h_), px((size_t)w_ * h_) {}
    Vec3& at(int x, int y) { return px[(size_t)y * w + x]; }
    const Vec3& at(int x, int y) const { return px[(size_t)y * w + x]; }
};

struct Camera {
    Vec3 pos, fwd, right, up;
    double scale;
    explicit Camera(const Params& P) {
        pos = P.camPos;
        fwd = (P.camLook - P.camPos).normalized();
        right = fwd.cross(P.camUp).normalized();
        up = right.cross(fwd).normalized();
        scale = std::tan(P.fov * PI / 360.0);
    }
    Vec3 rayDir(double u, double v, int w, int h) const {
        double aspect = (double)w / h;
        double x = (2.0 * u / w - 1.0) * scale * aspect;
        double y = (1.0 - 2.0 * v / h) * scale;
        return (fwd + right * x + up * y).normalized();
    }
};

struct Stats {
    long long photonsEmitted = 0;
    long long photonsStored = 0;
    long long queries = 0;
    double queryRadiusSum = 0.0;
    double tPhotons = 0, tBuild = 0, tRender = 0;
    void merge(const Stats& o) {
        photonsEmitted += o.photonsEmitted; photonsStored += o.photonsStored;
        queries += o.queries; queryRadiusSum += o.queryRadiusSum;
    }
};

inline double nowSec() {
    return std::chrono::duration<double>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

// beam axis: the tilted light panel's emission direction
inline Vec3 beamAxis(const Scene& sc) { return sc.light.n; }

// ---------------- photon tracing (caustic + global photon maps) ----------------
// caustic map: paths LS+D (specular then diffuse). global map: photons that have
// bounced off at least one diffuse surface (multi-bounce indirect).
inline void tracePhotons(const Scene& sc, const Params& P, PhotonMap& cmap, PhotonMap& gmap, Stats& st) {
    double t0 = nowSec();
    // emit over the full cosine hemisphere so the photon distribution matches
    // the analytic direct lighting exactly (no cone truncation bias)
    const double cosMax = 0.0;
    const Vec3 axis = beamAxis(sc);
    const double A = sc.light.area();
    const double fluxScale = PI * (1.0 - cosMax * cosMax); // cosine emission restricted to cone
    const Vec3 photonPower = sc.light.Le * (A * fluxScale / P.photons);
    cmap.photons.clear();
    gmap.photons.clear();
    cmap.photons.reserve(P.photons / 4);
    gmap.photons.reserve(P.photons / 4);

#pragma omp parallel
    {
        Stats local;
        std::vector<Photon> bufC, bufG;
        bufC.reserve(4096);
        bufG.reserve(4096);
#pragma omp for schedule(static) nowait
        for (long long i = 0; i < (long long)P.photons; i++) {
            RNG rng(0x1234567ULL + (uint64_t)i * 0x9E3779B9ULL);
            local.photonsEmitted++;
            Vec3 pos = sc.light.sample(rng);
            Vec3 dir = rng.coneDir(axis, cosMax);
            Vec3 power = photonPower;
            bool specularSeen = false, diffuseSeen = false;
            for (int b = 0; b < P.maxBounce; b++) {
                Hit h;
                if (!sc.intersect(pos + dir * EPS, dir, EPS, 1e20, h)) break;
                const Material& m = sc.mats[h.mat];
                if (m.Le.maxComp() > 0) break;
                if (m.type == MatType::Dielectric) {
                    specularSeen = true;
                    double f0 = (m.ior - 1.0) / (m.ior + 1.0);
                    f0 *= f0;
                    double cosi = -dir.dot(h.n);
                    double F = fresnelSchlick(cosi, f0);
                    // decide entering vs exiting by geometric normal of the water sheet
                    bool entering = dir.y < 0;
                    if (rng.next() < F) {
                        dir = reflect(dir, h.n);
                    } else {
                        Vec3 rdir;
                        double eta = entering ? 1.0 / m.ior : m.ior;
                        if (refract(dir, h.n, eta, rdir)) dir = rdir;
                        else dir = reflect(dir, h.n);
                    }
                    pos = h.p;
                } else {
                    if (!diffuseSeen && specularSeen) {
                        bufC.push_back({h.p, dir, power}); // LS+D caustic photon
                        local.photonsStored++;
                    } else if (diffuseSeen) {
                        bufG.push_back({h.p, dir, power}); // multi-bounce photon
                        local.photonsStored++;
                    }
                    // russian-roulette diffuse bounce
                    double q = std::min(0.85, m.albedo.maxComp());
                    if (rng.next() > q) break;
                    power = power * (m.albedo * (1.0 / q));
                    diffuseSeen = true;
                    dir = rng.cosineDir(h.n);
                    pos = h.p;
                }
            }
        }
#pragma omp critical
        {
            for (auto& ph : bufC) cmap.photons.push_back(ph);
            for (auto& ph : bufG) gmap.photons.push_back(ph);
            st.merge(local);
        }
    }
    st.tPhotons = nowSec() - t0;
    double t1 = nowSec();
    // cap the global map: indirect light is smooth, a bounded map keeps
    // query cost independent of emission count (power is rescaled)
    if (gmap.photons.size() > P.globalCap) {
        size_t n = gmap.photons.size(), cap = P.globalCap;
        double scale = (double)n / cap;
        std::vector<Photon> kept;
        kept.reserve(cap);
        for (size_t i = 0; i < cap; i++) {
            Photon ph = gmap.photons[i * n / cap];
            ph.power = ph.power * scale;
            kept.push_back(ph);
        }
        gmap.photons.swap(kept);
    }
    cmap.build(std::max(P.rDiffuse, P.rGlossy));
    gmap.build(P.rDiffuse);
    st.tBuild = nowSec() - t1;
}

// ---------------- caustic radiance estimate ----------------
// returns irradiance (W/m^2); caller multiplies by BRDF albedo/pi.
// filter radius depends on surface gloss: diffuse -> wide, glossy -> tight.
inline Vec3 causticIrradiance(const Scene& sc, const Params& P, const PhotonMap& cmap,
                              const Vec3& pos, const Vec3& n, double gloss,
                              std::vector<const Photon*>& tmp, Stats* st, int knn) {
    double rMax = P.rDiffuse + (P.rGlossy - P.rDiffuse) * gloss;
    double used = cmap.query(pos, rMax, knn, tmp);
    if (st) {
#pragma omp atomic
        st->queries++;
#pragma omp atomic
        st->queryRadiusSum += used;
    }
    if (tmp.empty()) return Vec3();
    const double kCone = 1.1;
    double norm = 1.0 / (1.0 - 2.0 / (3.0 * kCone));
    Vec3 E;
    for (const Photon* ph : tmp) {
        double d = (ph->p - pos).length();
        double w = norm * (1.0 - d / (kCone * used));
        if (w <= 0) continue;
        E += ph->power * w;
    }
    return E / (PI * used * used);
}

// ---------------- direct lighting ----------------
inline Vec3 directLight(const Scene& sc, const Vec3& pos, const Vec3& n, const Material& m,
                        RNG& rng, int nSamples) {
    Vec3 L;
    double A = sc.light.area();
    for (int i = 0; i < nSamples; i++) {
        Vec3 lp = sc.light.sample(rng);
        Vec3 toL = lp - pos;
        double d2 = toL.dot(toL);
        double dist = std::sqrt(d2);
        Vec3 w = toL / dist;
        double cosS = n.dot(w);
        double cosL = -w.dot(sc.light.n);
        if (cosS <= 0 || cosL <= 0) continue;
        if (sc.occluded(pos + n * EPS, lp - sc.light.n * EPS)) continue;
        L += sc.light.Le * (cosS * cosL * A / d2);
    }
    return m.albedo * (L / (PI * nSamples));
}

// forward decl
inline Vec3 pmRadiance(const Scene& sc, const Params& P, const PhotonMap& cmap,
                       const PhotonMap& gmap, Vec3 o, Vec3 d, int depth, RNG& rng, Stats* st);

// one-level final gather: cosine-sample hemisphere, evaluate
// direct + caustic map + global map at the gathered hits
inline Vec3 finalGather(const Scene& sc, const Params& P, const PhotonMap& cmap,
                        const PhotonMap& gmap, const Vec3& pos, const Vec3& n,
                        RNG& rng, Stats* st) {
    Vec3 sum;
    std::vector<const Photon*> tmp;
    const int gatherKnn = std::max(15, P.knn / 3); // cheaper queries inside gather
    auto shadeGatherHit = [&](const Hit& gh, const Material& gm) {
        Vec3 Ein = causticIrradiance(sc, P, cmap, gh.p, gh.n, gm.gloss, tmp, st, gatherKnn);
        Vec3 Egl = causticIrradiance(sc, P, gmap, gh.p, gh.n, 0.0, tmp, st, gatherKnn);
        return directLight(sc, gh.p, gh.n, gm, rng, 1) + gm.albedo * ((Ein + Egl) / PI);
    };
    for (int i = 0; i < P.gatherRays; i++) {
        Vec3 dir = rng.cosineDir(n);
        Hit h;
        if (!sc.intersect(pos + n * EPS, dir, EPS, 1e20, h)) continue;
        const Material& m = sc.mats[h.mat];
        if (m.Le.maxComp() > 0) continue; // direct light is handled analytically
        Vec3 Lin;
        if (m.type == MatType::Dielectric) {
            // fresnel-weighted specular bounce for gather rays hitting water:
            // reflect with probability F, otherwise transmit (never both)
            double f0 = (m.ior - 1.0) / (m.ior + 1.0);
            f0 *= f0;
            double F = fresnelSchlick(-dir.dot(h.n), f0);
            bool entering = dir.y < 0;
            Vec3 rd;
            if (rng.next() < F) rd = reflect(dir, h.n);
            else {
                double eta = entering ? 1.0 / m.ior : m.ior;
                if (!refract(dir, h.n, eta, rd)) rd = reflect(dir, h.n);
            }
            Hit h2;
            if (sc.intersect(h.p + rd * EPS, rd, EPS, 1e20, h2)) {
                const Material& m2 = sc.mats[h2.mat];
                if (m2.Le.maxComp() == 0 && m2.type == MatType::Diffuse)
                    Lin = shadeGatherHit(h2, m2);
            }
        } else {
            Lin = shadeGatherHit(h, m);
        }
        sum += Lin;
    }
    return sum / P.gatherRays;
}

// photon-mapping radiance along a camera (or secondary) ray
inline Vec3 pmRadiance(const Scene& sc, const Params& P, const PhotonMap& cmap,
                       const PhotonMap& gmap, Vec3 o, Vec3 d, int depth, RNG& rng, Stats* st) {
    Hit h;
    if (!sc.intersect(o, d, EPS, 1e20, h)) return Vec3();
    const Material& m = sc.mats[h.mat];
    if (m.Le.maxComp() > 0) return m.Le;
    if (m.type == MatType::Dielectric && depth < 4) {
        double f0 = (m.ior - 1.0) / (m.ior + 1.0);
        f0 *= f0;
        double cosi = -d.dot(h.n);
        double F = fresnelSchlick(cosi, f0);
        bool entering = d.y < 0;
        Vec3 rd = reflect(d, h.n);
        Vec3 Lr = pmRadiance(sc, P, cmap, gmap, h.p + rd * EPS, rd, depth + 1, rng, st);
        Vec3 td;
        Vec3 Lt;
        double eta = entering ? 1.0 / m.ior : m.ior;
        if (refract(d, h.n, eta, td)) Lt = pmRadiance(sc, P, cmap, gmap, h.p + td * EPS, td, depth + 1, rng, st);
        else { Lt = Lr; F = 1.0; }
        return Lr * F + Lt * (1.0 - F);
    }
    // diffuse / glossy surface: direct + caustic map + global map + final gather
    std::vector<const Photon*> tmp;
    Vec3 L;
    if (P.viz == 0 || P.viz == 2) L += directLight(sc, h.p, h.n, m, rng, depth == 0 ? 8 : 1);
    if (P.viz == 0 || P.viz == 1) {
        Vec3 E = causticIrradiance(sc, P, cmap, h.p, h.n, m.gloss, tmp, st, P.knn);
        L += m.albedo * (E / PI);
    }
    // indirect: final gather only (gather hits evaluate direct+caustic+global).
    // the global map is NOT used at primary hits: L->D->x is already covered
    // by the gather's analytic direct term, using both would double count.
    // gather also below the water surface (depth 1-2): the pool basin needs
    // its multi-bounce indirect light too.
    if ((P.viz == 0 || P.viz == 3) && depth <= 1)
        L += m.albedo * finalGather(sc, P, cmap, gmap, h.p, h.n, rng, st);
    return L;
}

inline Image renderPM(const Scene& sc, const Params& P, const PhotonMap& cmap,
                      const PhotonMap& gmap, Stats& st) {
    double t0 = nowSec();
    Camera cam(P);
    Image img(P.w, P.h);
#pragma omp parallel for schedule(dynamic, 4)
    for (int y = 0; y < P.h; y++) {
        RNG rng(0xABCDEFULL + (uint64_t)y * 7919ULL);
        for (int x = 0; x < P.w; x++) {
            double u = x + 0.5, v = y + 0.5;
            Vec3 d = cam.rayDir(u, v, P.w, P.h);
            img.at(x, y) = pmRadiance(sc, P, cmap, gmap, cam.pos, d, 0, rng, &st);
        }
    }
    st.tRender = nowSec() - t0;
    return img;
}

// ---------------- path tracing reference ----------------
inline Vec3 ptRadiance(const Scene& sc, const Params& P, Vec3 o, Vec3 d, RNG& rng) {
    Vec3 L, throughput(1, 1, 1);
    bool lastSpecular = true;
    for (int b = 0; b < P.maxBounce; b++) {
        Hit h;
        if (!sc.intersect(o, d, EPS, 1e20, h)) break;
        const Material& m = sc.mats[h.mat];
        if (m.Le.maxComp() > 0) {
            if (lastSpecular) L += throughput * m.Le;
            break;
        }
        if (m.type == MatType::Dielectric) {
            double f0 = (m.ior - 1.0) / (m.ior + 1.0);
            f0 *= f0;
            double cosi = -d.dot(h.n);
            double F = fresnelSchlick(cosi, f0);
            bool entering = d.y < 0;
            Vec3 nd;
            if (rng.next() < F) nd = reflect(d, h.n);
            else {
                double eta = entering ? 1.0 / m.ior : m.ior;
                if (!refract(d, h.n, eta, nd)) nd = reflect(d, h.n);
            }
            throughput = throughput * m.albedo;
            o = h.p + nd * EPS; d = nd;
            lastSpecular = true;
        } else {
            // next-event estimation toward the light
            Vec3 lp = sc.light.sample(rng);
            Vec3 toL = lp - h.p;
            double d2 = toL.dot(toL);
            double dist = std::sqrt(d2);
            Vec3 w = toL / dist;
            double cosS = h.n.dot(w), cosL = -w.dot(sc.light.n);
            if (cosS > 0 && cosL > 0 && !sc.occluded(h.p + h.n * EPS, lp - sc.light.n * EPS)) {
                Vec3 f = m.albedo * (1.0 / PI);
                L += throughput * f * sc.light.Le * (cosS * cosL * sc.light.area() / d2);
            }
            Vec3 nd = rng.cosineDir(h.n);
            throughput = throughput * m.albedo;
            o = h.p + h.n * EPS; d = nd;
            lastSpecular = false;
        }
        if (b >= 3) {
            double q = std::min(0.95, throughput.maxComp());
            if (rng.next() > q) break;
            throughput = throughput / q;
        }
    }
    return L;
}

inline Image renderPT(const Scene& sc, const Params& P, double& tRender) {
    double t0 = nowSec();
    Camera cam(P);
    Image img(P.w, P.h);
#pragma omp parallel for schedule(dynamic, 4)
    for (int y = 0; y < P.h; y++) {
        for (int x = 0; x < P.w; x++) {
            RNG rng(0x777ULL + (uint64_t)(y * P.w + x) * 0x9E3779B9ULL);
            Vec3 sum;
            for (int s = 0; s < P.sppPT; s++) {
                double u = x + rng.next(), v = y + rng.next();
                Vec3 d = cam.rayDir(u, v, P.w, P.h);
                sum += ptRadiance(sc, P, cam.pos, d, rng);
            }
            img.at(x, y) = sum / P.sppPT;
        }
    }
    tRender = nowSec() - t0;
    return img;
}
