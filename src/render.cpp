#include "render.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <numeric>
#include <sstream>

namespace rad {
namespace {

bool intersectPatch(const Vec3& origin, const Vec3& dir, const Patch& patch, double& t) {
    const double denom = dot(patch.quad.normal, dir);
    if (denom >= -1.0e-10) {
        return false;
    }
    t = dot(patch.quad.normal, patch.quad.p0 - origin) / denom;
    if (t <= 1.0e-5) {
        return false;
    }
    const Vec3 local = origin + dir * t - patch.quad.p0;
    const double uu = dot(local, patch.quad.u) / dot(patch.quad.u, patch.quad.u);
    const double vv = dot(local, patch.quad.v) / dot(patch.quad.v, patch.quad.v);
    return uu >= 0.0 && uu <= 1.0 && vv >= 0.0 && vv <= 1.0;
}

Rgb radianceFor(const std::vector<Patch>& firstPass,
                const std::vector<Patch>& converged,
                std::size_t patch, ViewMode mode) {
    const Rgb direct = firstPass[patch].radiosity();
    const Rgb full = converged[patch].radiosity();
    if (mode == ViewMode::FirstPass) {
        return direct;
    }
    if (mode == ViewMode::Converged) {
        return full;
    }
    return {std::max(0.0, full.r - direct.r),
            std::max(0.0, full.g - direct.g),
            std::max(0.0, full.b - direct.b)};
}

std::array<std::uint8_t, 3> encodeRadiance(const Rgb& radiance, double exposure) {
    const double light = std::max(0.0, luminance(radiance));
    const double mapped = 1.0 - std::exp(-light * exposure);
    const double invLight = light > 1.0e-12 ? 1.0 / light : 0.0;
    const double linear[3] = {
        radiance.r * invLight * mapped,
        radiance.g * invLight * mapped,
        radiance.b * invLight * mapped};
    std::array<std::uint8_t, 3> result{};
    for (int i = 0; i < 3; ++i) {
        const double gamma = std::pow(std::clamp(linear[i], 0.0, 1.0), 1.0 / 2.2);
        result[static_cast<std::size_t>(i)] =
            static_cast<std::uint8_t>(std::lround(gamma * 255.0));
    }
    return result;
}

struct RenderBvh {
    struct Node {
        Aabb box;
        int start = 0;
        int count = 0;
        int left = -1;
        int right = -1;
    };

    std::vector<int> ids;
    std::vector<Node> nodes;
    const Scene* scene = nullptr;

    Aabb patchBox(const Patch& patch) const {
        Vec3 lo = patch.quad.p0;
        Vec3 hi = patch.quad.p0;
        for (int corner = 1; corner < 4; ++corner) {
            const double u = (corner == 1 || corner == 2) ? 1.0 : 0.0;
            const double v = (corner == 2 || corner == 3) ? 1.0 : 0.0;
            const Vec3 p = patch.quad.point(u, v);
            lo.x = std::min(lo.x, p.x);
            lo.y = std::min(lo.y, p.y);
            lo.z = std::min(lo.z, p.z);
            hi.x = std::max(hi.x, p.x);
            hi.y = std::max(hi.y, p.y);
            hi.z = std::max(hi.z, p.z);
        }
        const Vec3 pad{1.0e-6, 1.0e-6, 1.0e-6};
        return {lo - pad, hi + pad};
    }

    Aabb unionBox(const Aabb& a, const Aabb& b) const {
        return {{std::min(a.lo.x, b.lo.x), std::min(a.lo.y, b.lo.y), std::min(a.lo.z, b.lo.z)},
                {std::max(a.hi.x, b.hi.x), std::max(a.hi.y, b.hi.y), std::max(a.hi.z, b.hi.z)}};
    }

    void build(const Scene& source) {
        scene = &source;
        ids.resize(source.patches.size());
        std::iota(ids.begin(), ids.end(), 0);
        nodes.clear();
        nodes.reserve(source.patches.size() * 2);
        if (!ids.empty()) {
            buildNode(0, static_cast<int>(ids.size()));
        }
    }

    int buildNode(int start, int end) {
        const int nodeIndex = static_cast<int>(nodes.size());
        nodes.push_back(Node{});
        Aabb box = patchBox(scene->patches[static_cast<std::size_t>(ids[start])]);
        for (int i = start + 1; i < end; ++i) {
            box = unionBox(box, patchBox(scene->patches[static_cast<std::size_t>(ids[i])]));
        }
        nodes[nodeIndex].box = box;
        nodes[nodeIndex].start = start;
        nodes[nodeIndex].count = end - start;
        if (end - start <= 4) {
            return nodeIndex;
        }
        const Vec3 extent = box.hi - box.lo;
        const int axis = (extent.x >= extent.y && extent.x >= extent.z)
                             ? 0
                             : (extent.y >= extent.z ? 1 : 2);
        const int middle = start + (end - start) / 2;
        std::sort(ids.begin() + start, ids.begin() + end,
                  [&](int a, int b) {
                      const Vec3 ca = scene->patches[static_cast<std::size_t>(a)].quad.center();
                      const Vec3 cb = scene->patches[static_cast<std::size_t>(b)].quad.center();
                      const double va = axis == 0 ? ca.x : (axis == 1 ? ca.y : ca.z);
                      const double vb = axis == 0 ? cb.x : (axis == 1 ? cb.y : cb.z);
                      return va < vb;
                  });
        const int left = buildNode(start, middle);
        const int right = buildNode(middle, end);
        nodes[nodeIndex].left = left;
        nodes[nodeIndex].right = right;
        nodes[nodeIndex].count = 0;
        return nodeIndex;
    }

    int nearest(const Vec3& origin, const Vec3& dir, const Scene& source,
                double& nearestT) const {
        if (nodes.empty()) {
            return -1;
        }
        int hit = -1;
        nearestT = 1.0e30;
        std::vector<int> stack;
        stack.reserve(64);
        stack.push_back(0);
        while (!stack.empty()) {
            const int nodeIndex = stack.back();
            stack.pop_back();
            const Node& node = nodes[static_cast<std::size_t>(nodeIndex)];
            double tEnter = 0.0;
            if (!intersectAabbRay(origin, dir, node.box, nearestT, tEnter)) {
                continue;
            }
            if (node.count > 0) {
                for (int k = 0; k < node.count; ++k) {
                    const int patchId = ids[static_cast<std::size_t>(node.start + k)];
                    double t = 0.0;
                    if (intersectPatch(origin, dir,
                                       source.patches[static_cast<std::size_t>(patchId)], t) &&
                        t < nearestT) {
                        nearestT = t;
                        hit = patchId;
                    }
                }
            } else {
                if (node.left >= 0) {
                    stack.push_back(node.left);
                }
                if (node.right >= 0) {
                    stack.push_back(node.right);
                }
            }
        }
        return hit;
    }
};

void put16(std::ofstream& out, std::uint16_t value) {
    out.put(static_cast<char>(value & 0xff));
    out.put(static_cast<char>((value >> 8) & 0xff));
}

void put32(std::ofstream& out, std::uint32_t value) {
    out.put(static_cast<char>(value & 0xff));
    out.put(static_cast<char>((value >> 8) & 0xff));
    out.put(static_cast<char>((value >> 16) & 0xff));
    out.put(static_cast<char>((value >> 24) & 0xff));
}

}  // namespace

const char* viewName(ViewMode mode) {
    switch (mode) {
        case ViewMode::FirstPass: return "first_pass";
        case ViewMode::Converged: return "converged";
        case ViewMode::IndirectOnly: return "indirect_only";
    }
    return "unknown";
}

double recommendedExposure(const std::vector<Patch>& converged) {
    std::vector<double> values;
    values.reserve(converged.size());
    for (const Patch& patch : converged) {
        if (!patch.isEmitter()) {
            const double value = luminance(patch.radiosity());
            if (value > 1.0e-8) {
                values.push_back(value);
            }
        }
    }
    if (values.empty()) {
        return 1.0;
    }
    std::sort(values.begin(), values.end());
    const std::size_t index =
        static_cast<std::size_t>(static_cast<double>(values.size() - 1) * 0.90);
    return 0.55 / std::max(values[index], 1.0e-8);
}

Image renderView(const Scene& scene, const std::vector<Patch>& firstPass,
                 const std::vector<Patch>& converged, ViewMode mode,
                 int width, int height, double exposure, const Camera& camera) {
    Image image;
    image.width = std::max(1, width);
    image.height = std::max(1, height);
    image.rgb.assign(static_cast<std::size_t>(image.width) * image.height * 3, 0);

    const Vec3 forward = normalized(camera.target - camera.position);
    const Vec3 right = normalized(cross(forward, camera.up));
    const Vec3 up = cross(right, forward);
    const double aspect = static_cast<double>(image.width) / image.height;
    const double tanHalf = std::tan(camera.verticalFovDegrees * kPi / 360.0);
    RenderBvh bvh;
    bvh.build(scene);

    for (int y = 0; y < image.height; ++y) {
        const double sy = (1.0 - 2.0 * (static_cast<double>(y) + 0.5) / image.height) * tanHalf;
        for (int x = 0; x < image.width; ++x) {
            const double sx = (2.0 * (static_cast<double>(x) + 0.5) / image.width - 1.0) *
                              tanHalf * aspect;
            const Vec3 dir = normalized(forward + right * sx + up * sy);
            double nearest = 0.0;
            const int hit = bvh.nearest(camera.position, dir, scene, nearest);
            if (hit < 0) {
                continue;
            }
            const Rgb radiance = radianceFor(firstPass, converged,
                                             static_cast<std::size_t>(hit), mode);
            const std::size_t base =
                (static_cast<std::size_t>(y) * image.width + x) * 3;
            const auto encoded = encodeRadiance(radiance, exposure);
            image.rgb[base + 0] = encoded[0];
            image.rgb[base + 1] = encoded[1];
            image.rgb[base + 2] = encoded[2];
        }
    }
    return image;
}

bool writeBmp(const std::string& path, const Image& image) {
    if (image.width <= 0 || image.height <= 0) {
        return false;
    }
    const int rowStride = (image.width * 3 + 3) & ~3;
    const std::uint32_t pixelBytes =
        static_cast<std::uint32_t>(rowStride) * static_cast<std::uint32_t>(image.height);
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out.put('B');
    out.put('M');
    put32(out, 54u + pixelBytes);
    put16(out, 0);
    put16(out, 0);
    put32(out, 54u);
    put32(out, 40u);
    put32(out, static_cast<std::uint32_t>(image.width));
    put32(out, static_cast<std::uint32_t>(image.height));
    put16(out, 1);
    put16(out, 24);
    put32(out, 0);
    put32(out, pixelBytes);
    put32(out, 2835);
    put32(out, 2835);
    put32(out, 0);
    put32(out, 0);

    std::vector<char> row(static_cast<std::size_t>(rowStride), 0);
    for (int y = image.height - 1; y >= 0; --y) {
        std::fill(row.begin(), row.end(), 0);
        const std::size_t source =
            static_cast<std::size_t>(y) * image.width * 3;
        for (int x = 0; x < image.width; ++x) {
            row[static_cast<std::size_t>(x) * 3 + 0] =
                static_cast<char>(image.rgb[source + static_cast<std::size_t>(x) * 3 + 2]);
            row[static_cast<std::size_t>(x) * 3 + 1] =
                static_cast<char>(image.rgb[source + static_cast<std::size_t>(x) * 3 + 1]);
            row[static_cast<std::size_t>(x) * 3 + 2] =
                static_cast<char>(image.rgb[source + static_cast<std::size_t>(x) * 3 + 0]);
        }
        out.write(row.data(), static_cast<std::streamsize>(row.size()));
    }
    return static_cast<bool>(out);
}

bool writePpm(const std::string& path, const Image& image) {
    std::ofstream out(path, std::ios::binary);
    if (!out) {
        return false;
    }
    out << "P6\n" << image.width << ' ' << image.height << "\n255\n";
    out.write(reinterpret_cast<const char*>(image.rgb.data()),
              static_cast<std::streamsize>(image.rgb.size()));
    return static_cast<bool>(out);
}

std::string ansiPreview(const Image& image, int columns, int rows) {
    columns = std::max(1, columns);
    rows = std::max(1, rows);
    const int pixelRows = rows * 2;
    std::ostringstream out;
    for (int row = 0; row < pixelRows; row += 2) {
        for (int col = 0; col < columns; ++col) {
            const int x = std::min(image.width - 1,
                                   (col * image.width) / columns);
            auto at = [&](int y) {
                const std::size_t index =
                    (static_cast<std::size_t>(y) * image.width + x) * 3;
                return std::array<int, 3>{
                    image.rgb[index + 0], image.rgb[index + 1], image.rgb[index + 2]};
            };
            const int y0 = std::min(image.height - 1, (row * image.height) / pixelRows);
            const int y1 = std::min(image.height - 1,
                                    ((row + 1) * image.height) / pixelRows);
            const auto top = at(y0);
            const auto bottom = at(y1);
            out << "\x1b[38;2;" << top[0] << ';' << top[1] << ';' << top[2]
                << "m\x1b[48;2;" << bottom[0] << ';' << bottom[1] << ';'
                << bottom[2] << "m\xe2\x96\x80";
        }
        out << "\x1b[0m\n";
    }
    return out.str();
}

}  // namespace rad
