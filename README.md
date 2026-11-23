# 精密双目维修镜

纯 TypeScript + WebGL2 + GLSL 的双目立体维修镜。没有 three.js、Babylon.js 或任何模型/纹理资源；刻度、齿轮、护罩、螺栓和远景零件全部由代码生成。

## 运行

```bash
npm install
npx playwright install chromium
npm run dev
```

自动验收：

```bash
npm run verify
```

验收会构建、启动预览、实际创建 WebGL2 上下文，并输出：

- `artifacts/verification.json`：完整数值、诊断和浏览器错误
- `artifacts/stereo-front.png`：探针齿轮在护罩前
- `artifacts/stereo-behind.png`：探针齿轮在护罩后
- `artifacts/stereo-anaglyph.png`：红青模式

## 操作

- 鼠标拖动：偏航/俯仰
- `WASD`：上下左右平移
- `R/F`：前后平移
- `Q/E`：滚转
- `1/2/3`：单眼、并排、红青
- `G`：停止自动往返并移动探针齿轮
- `Space`：暂停场景时间

## 渲染结构

- 左/右眼各有一个独立 FBO，颜色为 `RGBA8`，深度为 `DEPTH_COMPONENT24`。
- 固定瞳距 64 mm。两只相机位置分别为 `x = ±32 mm`，投影使用共享显示面的非对称视锥，汇聚面在 42 cm。
- `renderFrame(time, head, probeBlend)` 首先生成唯一 `SceneSnapshot`，随后左眼、右眼都只读取该快照。几何动画、探针位置、头部位姿和相机矩阵不会在两眼之间重新采样。
- 场景使用程序化三角网格和解析光照；透明护罩在最后绘制、alpha 混合，并写入透明表面深度，供后处理边缘检测和遮挡验收使用。
- 后处理使用径向镜头畸变（`k1=-0.027`, `k2=-0.007`）和 5 点深度感知重采样。邻域样本与中心线性深度差过大时降权，避免遮挡边缘拖影。
- 单眼模式显示左眼；并排模式按 1.35:1 眼窗适配；红青模式使用左眼 R、右眼 GB。

## 验收结果

以下数值来自本机一次完整 `npm run verify`，图像尺寸 `1440×900`，眼缓冲 `1153×855`。

| 检查项 | 结果 |
| --- | --- |
| 护罩前探针深度 | 0.315 m |
| 护罩后探针深度 | 0.603 m |
| 护罩前有符号视差 | `+94.69 px`（左眼图像中的像位于右眼图像右侧） |
| 护罩后有符号视差 | `-86.21 px`（越过 0.42 m 汇聚面，方向反转） |
| 遮挡一致性 | 前后两组左右眼深度回读均一致 |
| 快速位姿帧数 | 24 帧，最大相邻偏航变化 0.1689 rad |
| 左右帧令牌不一致 | 0 |
| 左右场景时间不一致 | 0 |
| 实际画面校准灯缺失帧 | 0 / 24（每帧逐眼回读颜色纹理） |
| 最大重投影误差 | **0.2810 px** |
| 验收阈值 | 0.75 px |

探针齿轮位于护罩前时，左右眼深度回读均约 0.311 m；移到护罩后时，左右眼回读变为 0.449/0.454 m，而齿轮几何深度为 0.601 m，说明两只眼都实际看到了更近的透明护罩表面。

## 浏览器诊断 API

页面暴露 `window.__stereoLab`：

```ts
__stereoLab.getDiagnostics()
__stereoLab.setViewMode("mono" | "sbs" | "anaglyph")
__stereoLab.setProbeSide("front" | "behind")
__stereoLab.setHeadPose({ yaw, pitch, roll, position })
__stereoLab.measureReprojection()
__stereoLab.runVerification()
```
