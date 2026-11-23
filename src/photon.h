#pragma once
#include "vec3.h"
#include <vector>
#include <unordered_map>
#include <algorithm>

struct Photon {
    Vec3 p;      // position on a diffuse surface
    Vec3 dir;    // incident direction (normalized, pointing toward the surface)
    Vec3 power;  // carried flux (RGB)
};

struct CellKey {
    int x, y, z;
    bool operator==(const CellKey& o) const { return x == o.x && y == o.y && z == o.z; }
};
struct CellKeyHash {
    size_t operator()(const CellKey& k) const {
        uint64_t h = 0x9E3779B97F4A7C15ULL;
        auto mix = [&](uint64_t v) {
            v *= 0xBF58476D1CE4E5B9ULL; v ^= v >> 29; h ^= v + 0x9E3779B97F4A7C15ULL + (h << 6) + (h >> 2);
        };
        mix((uint32_t)k.x); mix((uint32_t)k.y); mix((uint32_t)k.z);
        return (size_t)h;
    }
};

// uniform spatial hash grid over photons; cell size = max search radius
struct PhotonMap {
    std::vector<Photon> photons;
    std::unordered_map<CellKey, std::vector<int>, CellKeyHash> grid;
    double cell = 0.1;

    void build(double radius) {
        cell = radius;
        grid.clear();
        grid.reserve(photons.size() * 2 + 1);
        for (int i = 0; i < (int)photons.size(); i++) {
            const Vec3& p = photons[i].p;
            CellKey k{(int)std::floor(p.x / cell), (int)std::floor(p.y / cell), (int)std::floor(p.z / cell)};
            grid[k].push_back(i);
        }
    }

    // gather up to k nearest photons within rMax of pos.
    // returns actual radius used (distance of the farthest accepted photon, or rMax).
    double query(const Vec3& pos, double rMax, int k, std::vector<const Photon*>& out) const {
        out.clear();
        if (photons.empty()) return rMax;
        int r = (int)std::ceil(rMax / cell);
        CellKey c{(int)std::floor(pos.x / cell), (int)std::floor(pos.y / cell), (int)std::floor(pos.z / cell)};
        // collect candidates with squared distances, keep k nearest via a small heap
        std::vector<std::pair<double, const Photon*>> best;
        double r2limit = rMax * rMax;
        for (int ix = c.x - r; ix <= c.x + r; ix++)
            for (int iy = c.y - r; iy <= c.y + r; iy++)
                for (int iz = c.z - r; iz <= c.z + r; iz++) {
                    auto it = grid.find({ix, iy, iz});
                    if (it == grid.end()) continue;
                    for (int idx : it->second) {
                        const Photon& ph = photons[idx];
                        double d2 = (ph.p - pos).dot(ph.p - pos);
                        if (d2 > r2limit) continue;
                        if ((int)best.size() < k) {
                            best.emplace_back(d2, &ph);
                            if ((int)best.size() == k)
                                std::make_heap(best.begin(), best.end());
                        } else if (d2 < best.front().first) {
                            std::pop_heap(best.begin(), best.end());
                            best.back() = {d2, &ph};
                            std::push_heap(best.begin(), best.end());
                        }
                    }
                }
        double used = best.empty() ? rMax : std::sqrt(best.size() == (size_t)k ? best.front().first
                          : std::max_element(best.begin(), best.end(),
                              [](const std::pair<double, const Photon*>& a,
                                 const std::pair<double, const Photon*>& b){ return a.first < b.first; })->first);
        out.reserve(best.size());
        for (auto& e : best) out.push_back(e.second);
        return used;
    }
};
