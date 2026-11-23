# 山脊观测站 · 物理约束镜头光晕

TypeScript + WebGL2 + GLSL 实现的夜间山脊观测站场景与物理镜头光晕后期效果，全程在线性 HDR 空间计算，不引入任何第三方运行时库。

## 运行

```bash
npm install
npm run build          # 类型检查并编译到 dist/
npm run serve          # 启动本地静态服务器 http://localhost:8080
```

浏览器打开后用鼠标拖动环绕、滚轮缩放，左侧面板切换视图、调整曝光/焦距/光圈，并可一键运行 GPU 自检。

## 三种视图

- 关闭光晕：仅线性 HDR 场景，无任何后期叠加。
- 简单屏幕亮度光晕：对 HDR 亮场做径向圆核扩散，纯屏幕空间、无光学参数，用作“朴素白色径向渐变”的对照。
- 物理鬼影与光晕（当前实现）：近轴光学反射模型驱动的孔径鬼影与轻量光晕，受焦距、光圈、色散与深度遮挡约束。

## 物理模型

### 线性 HDR 管线

场景与光晕都渲染到 `RGBA16F` 浮点目标，灯光以物理量级（nits）写入，曝光与 ACES 色调映射只在最终合成阶段应用。光晕能量随曝光线性变化，而不是叠加一条与曝光无关的白色径向渐变。

### 近轴反射鬼影

每个镜头反射表面对应一个鬼影，沿光轴排列在光源关于画面中心的镜像方向上：

```
ghostCenterNdc = -lightScreenNdc * k
```

- `k` 是该反射面的近轴放大率，随焦距缩放（`src/flare/optics.ts`）。
- 鬼影半径与通光强度由光圈 F 数决定：半径正比于 `1/F`，通光量按 `(1/F)^2` 衰减。
- 鬼影形状由七边形孔径 SDF（`sdNGon`）生成，附带光圈边缘环带。
- 色散对 R/G/B 通道施加略微不同的半径缩放，产生轴向彩边而不产生空间分离伪影。
- 中心落到成像圈外的鬼影被平滑裁剪，避免离屏多边形边缘切入画面。

### 深度遮挡

光晕通道对每个光源在其屏幕位置做 12-tap Poisson 深度采样（`src/render/shaders/flareLib.glsl.ts`），把场景非线性深度还原为视线距离后与光源距离比较：

```
visible -= step(sceneViewDepth + bias, lightViewDepth) / 12
```

采样核半径取光源角半径，因此灯被塔架、栏杆或薄板逐步遮住时，可见度在 0..1 间连续变化，亮度、鬼影与光晕同步连续消隐，完全遮挡后无残留。

### 旋转信标

塔顶红色信标按高斯扫描脉冲周期调制（`beaconPulse`），场景照明与光晕共用同一脉冲强度。

## 验证

```bash
npm test            # Node 单元测试（数学与光学参数化）
```

端到端 GPU 自检通过无头 Chromium + WebGL2（SwiftShader/ANGLE）执行，断言：

- 未遮挡时物理鬼影与光晕能量显著非零。
- 灯被遮挡后物理通道能量低于未遮挡的 8%，无残留。
- 曝光翻倍时线性捕获的总能量倍率在 1.75–2.25。
- 关闭/简单/物理三种视图能量存在明确差异。
- 物理模式相对关闭基准产生 RGB 通道色散偏移。
- 焦距 35mm→70mm 改变鬼影沿光轴的能量质心分布。

截图输出位于 `artifacts/`。

## 目录结构

- `src/math/`：手写 vec3/mat4 与透视投影。
- `src/scene/`：程序生成的地形、观测站、塔架桁架、栏杆、薄板与灯光。
- `src/flare/optics.ts`：焦距/光圈/色散参数化的近轴鬼影模型。
- `src/render/shaders/`：场景 G-Buffer、深度遮挡光晕、三模式合成 GLSL。
- `src/render/renderer.ts`：HDR 目标与三通道管线。
- `src/selftest/`：GPU 自检断言。
- `test/`：Node 单元测试与 WebGL2 端到端测试。

## 兼容性说明

部分 ANGLE/SwiftShader 驱动对数组 uniform 的整体 `uniform3fv/uniform1fv` 上传会静默失败，渲染器统一改为逐元素 `uniform3f/uniform1f` 上传以保证跨驱动正确（见 `src/render/renderer.ts` 的 `setVec3Array` 与 `setFloatArrayElement`）。
