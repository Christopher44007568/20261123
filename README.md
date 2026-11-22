# 海上换流站任意剖切多通道离线渲染器

纯 C++17 标准库实现，无图像库/Ray Tracing 库依赖。场景包含钢平台、变压器舱、
玻璃连廊、电缆桥架与海水/海床基底。

## 构建与运行

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build --output-on-failure
./build/offshore_clip_renderer --all --out artifacts --width 640 --height 360
```

无参数运行等同于 `--all --out artifacts`。任意剖切面：

```bash
./build/offshore_clip_renderer \
  --normal 0.12,0.93,0.35 --offset 7.4 \
  --width 640 --height 360 --out artifacts
```

自定义平面因此写入 `artifacts/custom/`。

法线会被归一化，`offset` 随法线长度同比缩放。裁剪语义固定为：
`dot(normal, p) > offset` 的正半空间被移除，负半空间保留。命令行还支持
`--no-ao`、`--no-reflection`、`--no-reference`、`--ao-samples N` 和
`--help`。

## 实现要点

- 三角网格使用中位数分割 BVH；暴力路径遍历全部三角形。
- 曲面护罩、连廊曲面顶盖和四根电缆使用 SDF 球迹求交、有限差分法线。
- 求交首先完整返回最近命中，再判断是否被裁剪。若被裁剪，仅推进
  `tMin` 继续获取下一层可见表面，不裁剪/重建 BVH 或 SDF，因此不会改变
  其它区域的求交顺序，也不会在第一个被裁命中处提前停止。
- 共面或近平面的命中使用“类型 + 图元编号”确定性平局规则，使 BVH、
  暴力遍历和剖切续交在首交点、材质编号上严格一致。
- 着色包含方向光直接照明与阴影、舱内点光源、局部半球环境遮蔽、薄层
  环境光，以及一次粗糙度扰动光泽反射。
- 颜色、精确深度、法线、材质伪彩、精确 16 位材质编号和剖切交线预览
  均由同一个逐像素首交记录派生。

## 通道与编码

每个剖切目录包含：

| 文件 | 内容 |
| --- | --- |
| `color.ppm` | 色调映射后的颜色 |
| `depth.pfm` | float32 射线距离，0 表示未命中 |
| `depth.pgm` | 16 位深度预览，近=65535，远/未命中=0 |
| `normal.ppm` | `n * 0.5 + 0.5`，未命中为黑色 |
| `material.ppm` | 材质伪彩，调色板见 `materials.json` |
| `material_ids.pgm` | 16 位精确材质编号，0 为背景 |
| `cut_preview.ppm` | 橙色=三角网格/剖切面交线，青色=SDF/剖切面交线，品红=剖切面边界 |
| `cut.json` | 平面、通道一致性、暴力复核、区域探针 |

`material_ids.pgm` 与 `color.ppm`/`material.ppm` 的每个像素来自同一次首交，
因此材质编号可直接与屏幕像素对查。

## 两个剖切方向

- `corridor`：`normal=(0.10,0.02,0.994)`，`offset=3.25`。切掉前方近侧，
  打开变压器舱前壁和连廊前玻璃，露出变压器油箱、连廊地板/长椅，并露出
  海水基底。
- `top`：`normal=(0.10,0.985,0.14)`，`offset=8.60`。近水平切掉舱顶、
  连廊顶盖和上段玻璃，从上方直接检查连廊地板/长椅与变压器内部；电缆桥架
  和水面在裁剪负侧保持不变。

`validation.json` 汇总每种剖切的裁剪续交像素数、三组目标区域可见像素、
通道一致性以及 128×72 暴力首交/材质复核结果。

## 暴力参考

根目录的 `reference_sheet.ppm` 是 160×90 三联图：

1. 暴力遍历颜色；
2. BVH 颜色；
3. 对比掩码：绿色=首交点/材质完全一致，深蓝=双方均未命中，红色=命中
   存在性不同，品红=材质不同，橙色=首交深度/对象不同。

`comparison.json` 给出深度误差、首交点不匹配数、材质不匹配数及样例。
`brute_reference/` 和 `bvh_reference/` 分别保存两条路径的完整小图通道。

## 可选 PNG 预览

渲染器本身只写 PPM/PFM/PGM。若系统有 ImageMagick，可生成便于查看的 PNG
和通道拼图：

```bash
./scripts/make_png_previews.sh artifacts
```

该脚本只做格式转换，不参与求交或通道生成。
