# 20261123

## 火山地貌教学沙盘 — NPR 卡通着色器 (TypeScript + WebGL2 + GLSL)

### 结构
- `src/terrain.ts` — 程序化地形:锥形火山+火山口、蜿蜒熔岩沟槽、断崖、缓坡平原、水位面
- `src/shaders_geo.ts` — 几何 pass(MRT G-buffer:反照率+标记 / 世界法线+视深 / 高度+熔岩掩码)
- `src/shaders_shade.ts` — 卡通着色 pass:漫反射 4 阶、高光 2 阶、雾 3 阶量化;
  深度/法线不连续描边(单侧采样,粗线 1.5px 用于尖顶/断崖/轮廓,细线 1.0px 用于缓坡等高线)
- `src/main.ts` — 渲染器与相机,暴露 `window.__npr.render({mode, width, height, azimuthDeg, elevationDeg, distance})`
- `harness/run.mjs` — Playwright 无头渲染 + 指标计算(色阶边界比例、描边宽度、闪烁、水体不变性)
- 图例文字与水体基线为 DOM 覆盖层 / 未风格化材质,不受 NPR 影响

### 运行
```bash
npm install
npm run build
PLAYWRIGHT_BROWSERS_PATH=$HOME/.cache/ms-playwright npm run render
```

### 产物 (`artifacts/`)
- `01_original.png` 原材质(连续渐变)/ `02_banded.png` 分层色阶 / `03_npr.png` 最终 NPR
- `report.md` + `metrics.json` — 色阶边界像素比例、描边宽度误差、稳定性指标
- `validation/` — 旋转/缩放视角验证图
