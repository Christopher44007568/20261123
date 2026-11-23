# Reservoir Light Field

滨海集装箱收费岛的实时直接光 ReSTIR 演示。场景、几何、材质与 220 盏工作灯均由 TypeScript
代码生成，渲染使用 WebGPU + WGSL，不依赖 Three.js、Babylon.js 或其他图形库。

## 运行

```bash
npm install
npm run dev
```

打开终端输出的地址。需要支持 WebGPU 的 Chrome / Edge；页面右上角显示 `WEBGPU / LIVE`
即表示设备初始化成功。

无头 Chromium + SwiftShader 验证时使用以下启动参数：

```text
--enable-unsafe-webgpu
--use-angle=vulkan
--use-vulkan=swiftshader
--enable-features=Vulkan
--ignore-gpu-blocklist
--enable-unsafe-swiftshader
```

`--use-angle=swiftshader` 的 WebGPU 画布在部分 Chromium 版本中无法正确呈现，因此脚本固定
使用 Vulkan SwiftShader 路径。

## 场景

- 220 盏高亮工作灯：雨棚下射灯、雨棚边灯、收费亭灯、12 米高杆灯和低位灯。
- 程序化收费岛：混凝土岛面、车道标线、锈色雨棚、支柱、收费亭、玻璃与红色警示条。
- 金属货柜场：不同金属度/粗糙度、波纹板、端门、角件和堆叠关系。
- 路锥、轮廓栏杆、车道标线和高杆灯均由代码生成。
- 相机沿固定椭圆轨道缓慢环绕收费岛，并经过雨棚下交叠灯区。

## ReSTIR 直接光

每个像素维护一个 `Reservoir`（32 字节）：

```text
lightIndex, sampleCount, weightSum, targetPdf,
finalWeight, visibility, candidateCount, reserved
```

每帧流程：

1. 光栅化生成位置/深度、法线/粗糙度、反照率/金属度和自发光 G-buffer。
2. 从世界空间分桶灯光表选择 20 个本地候选，执行初始 reservoir 重采样。
3. 时间复用：用上一帧 `viewProjection` 重投影，校验法线、世界位置深度与历史灯可见性；
   失败帧计入历史拒绝。
4. 空间复用：读取 4 邻域 reservoir，校验法线、世界位置和光线连续性后合并。
5. 最终 reservoir 按 `W = weightSum / (M * targetPdf)` 归一化，并只对选中灯执行一次阴影射线。
6. 法线与深度双边滤波只平滑同一表面内的 reservoir 噪声；参考通道与误差统计读取原始 HDR。

历史缓存上限限制合并进当前 reservoir 的历史样本数。合并权重同时乘入样本数与历史 `W`，
最终总是按总 `M` 归一化，因此改变缓存上限不会改变亮度期望。

## 参考比较

按 `显示模式` 切换：

- `ReSTIR`：实时重采样结果。
- `对比：参考 | ReSTIR`：左半为参考，右半为 ReSTIR。
- `参考：220 灯遍历`：每个像素遍历全部 220 盏灯，并使用同一 BRDF 与解析包围体阴影。
- `Reservoir heatmap`：显示最终权重与样本历史置信度。

左上遥测显示：

- reservoir 接受率；
- 历史失效率（重投影/法线/深度/可见性拒绝）；
- 最终平均权重 `W`；
- 与 220 灯参考图的平均亮度 L1 误差。

`空间复用` 开关可实时关闭 4 邻域合并，`历史缓存上限` 提供 4–64 样本。

## 自动验证

```bash
npm run validate
```

脚本会启动 Vite（若尚未运行），沿固定相机路径执行：

1. 12 帧参考对比，记录接受率、历史失效率、最终权重和参考误差。
2. 取历史失效率最高的 3 帧作为遮挡解除候选，检查误差是否异常抬升。
3. 分别以 4/16/32/64 历史缓存预热，检查平均亮度漂移。
4. 关闭/开启空间复用，记录接受率对照。
5. 生成高分辨率 ReSTIR、参考、分割对比和 reservoir 热图。

结果写入 `artifacts/validation.json`，并通过非零退出码报告失败。主要图片：

- `artifacts/final_restir.png`
- `artifacts/final_reference.png`
- `artifacts/final_split.png`
- `artifacts/reservoir_debug.png`

## 目录

```text
src/scene/        程序化网格、收费岛、货柜、灯具和遮挡体
src/shaders/      WGSL G-buffer、ReSTIR、参考渲染、滤波、ACES 合成
src/renderer.ts   WebGPU 资源、双缓冲、管线、相机与统计回读
src/main.ts       HUD、控件与公开验证 API
scripts/          Playwright 路径/漂移/噪声验证
```
