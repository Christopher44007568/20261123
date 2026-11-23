# 海岸悬崖考古遗址 · Meshlet 虚拟几何

纯 TypeScript + WebGPU + WGSL 实现。没有模型文件、没有第三方渲染引擎；海岸岩壁、台地、阶梯残迹、剖面、残墙、碎石坡与海蚀柱全部由固定 seed 程序化生成。

## 运行

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:4173/`。需要支持 WebGPU 的 Chromium。

```bash
npm test        # 几何、确定性、包围体、CPU 裁剪测试
npm run build   # 类型检查 + 生产构建
npm run verify  # Xvfb + Chromium 完整 GPU 验证，生成 artifacts/
```

`npm run verify` 使用带显示服务的完整 Chromium。无头 Chromium 在此环境下可创建 WebGPU 设备，但 `copyTextureToBuffer`/present 不稳定，因此验证脚本通过 Xvfb 运行，并从 GPU 颜色附件回读像素生成截图。

## 场景与数据规模

- 固定 seed：`0x051C1AFF`
- 源网格：488 个参数页面，每页 64×64 网格，共 **3,997,696** 三角形
- 每页 LOD：`L0 8192 / L1 2048 / L2 512 / L3 128` 三角形
- Meshlet：每 cluster 固定 8×8 单元、128 三角形、384 索引
- 候选 meshlet：**41,480**
  - L0 31,232
  - L1 7,808
  - L2 1,952
  - L3 488
- 每个 meshlet 都保存包围球与法线锥，法线锥由面积加权法线轴和最大角偏确定。

页面按固定布局分槽：

- L2/L3 全量常驻，作为缺页回退与 LOD 覆盖底层。
- L0/L1 放入 128 个可换入页面槽；统一索引/顶点缓冲的常驻区由原子页面映射定位。
- 页面未驻留时，屏幕误差选中的 L0/L1 自动降为 L2，不会丢页。

## GPU 裁剪与绘制

每帧一个 compute pass 遍历 41,480 个候选：

1. 页面级屏幕误差选择唯一 LOD；高精度页面缺失时回退 L2。
2. 包围球对 6 个视锥平面测试。
3. 法线锥背面测试：`dot(axis, viewDir) < -sin(theta)` 时剔除。
4. 接受的 cluster 原子追加到可见列表。
5. compute 同时把实例计数写入间接参数。

渲染只发出一次 `drawIndirect`。顶点 shader 用 `SV_InstanceID` 读取 cluster ID，再从统一索引/顶点缓冲解引用实际三角形。每个实例固定提交 384 个顶点，即 128 三角形。

L2 覆盖实例用可见列表最高位标记，并以 clip-space 深度偏置后退；高 LOD 页面正常遮挡它，而在页面缺失或 LOD 接缝处它继续填充轮廓。

## 视图与操作

- `1` 最终着色
- `2` 每 cluster 独立色块
- `3` 三角形密度（barycentric 线框 + LOD 热色）
- `Space` 暂停/继续自动巡航
- `↑` / `↓` 沿悬崖升降相机
- 底部滑杆直接跳转远海到近景路径

自动路径从远海 `z=430` 推进到遗址近景，再上爬至 `y=94`、下降回到遗址。

## 验证结果

最近一次 `npm run verify` 的实际结果：

- GPU 可见 cluster 集合与 CPU 参考：**7/7 采样点完全一致**
- 裁剪计数器（候选、LOD 拒绝、视锥、法线锥、提交、回退、覆盖、各级 LOD）：全部一致
- 缺页回退掩膜 vs 高 LOD 掩膜：`IoU = 1.0`，未覆盖像素 `0`
- 路径提交三角形：`262,144 → 428,160 → 587,392 → 747,136 → 607,872 → 566,912 → 637,440`
- 峰值提交：**747,136** 三角形 / **5,837** clusters
- 入港路径 LOD 切换：`L0 197 / L1 270 / L2 332 / L3 0`，合计 **799**
- 中段缺页回退：约 980–1,005 个 L2 cluster；覆盖底层约 341–453 个 cluster

完整数据在 `artifacts/gpu-report.json`。截图均为 GPU 颜色附件回读后与 HUD 合成：

- `artifacts/01-far-sea-frame.png`
- `artifacts/03-near-final-frame.png`
- `artifacts/04-near-clusters-frame.png`
- `artifacts/05-near-density-frame.png`
- `artifacts/06-cliff-ascent-frame.png`
- `artifacts/07-cliff-descent-frame.png`
- `artifacts/08-fallback-only-frame.png`
- `artifacts/09-fallback-mask-frame.png` / `10-high-mask-frame.png`

## 主要代码

- `src/geometry/scene.ts`：程序化地貌
- `src/geometry/build.ts`：页面/LOD/meshlet 与包围体构建
- `src/culling.ts`：CPU 参考裁剪与 GPU 结果逐项比较
- `src/page-store.ts`：L0/L1 页面驻留和 GPU 槽位写入
- `src/shaders/cull.wgsl`：GPU 视锥、法线锥、屏幕误差裁剪
- `src/shaders/scene.wgsl`：间接实例展开、三种视图和覆盖深度偏置
- `src/renderer.ts`：WebGPU 管线、间接绘制、GPU 回读
- `scripts/verify.ts`：完整相机路径、GPU/CPU 对比、截图与报告
