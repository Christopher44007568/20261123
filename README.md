# 废弃盐矿竖井 · 稀疏八叉树体素 LOD 渲染器

纯 TypeScript + WebGL2 + GLSL 实现，不加载任何外部模型或纹理：整座盐矿
（地面仓储层、四个不同深度的水平巷道、螺旋斜井、盐柱、升降平台、井架）
全部由固定 seed 的过程式程序生成。

## 运行

```bash
npm install
npm run build          # esbuild 打包到 dist/
npm run serve          # 静态服务器 http://127.0.0.1:4173
# 浏览器打开 http://127.0.0.1:4173/
```

## 验证

```bash
npm run check          # 严格 TypeScript 类型检查
npm run test:unit      # 10 个纯逻辑测试（八叉树、网格、拾取、缓冲池）
npm run test:e2e       # Playwright 无头 Chromium 端到端 + 截图
```

端到端会从地面自动下降到最底层，在 `screenshots/` 保存 9 张截图
（最终着色 / LOD 色块 / 线框 / 五个跨 LOD 边界的下降位置 / 最底层），
并把统计与不变量写入 `screenshots/report.json`。

## 架构

| 模块 | 职责 |
| --- | --- |
| `src/core/rng.ts` | 固定 seed 的 mulberry32 PRNG、3D 哈希与值噪声 |
| `src/world/VoxelWorld.ts` | 128³ 分块体素世界；竖井、巷道、斜井、盐柱、升降平台全部确定性生成 |
| `src/engine/Octree.ts` | 稀疏八叉树；距离深度上限 + 节点面预算 + 相邻 LOD 差限制 |
| `src/engine/Mesher.ts` | 暴露面枚举、按层贪婪矩形合并、按材质/面方向批处理 |
| `src/engine/RayPicker.ts` | Amanatides-Woo 体素 DDA 射线拾取，与 LOD 完全解耦 |
| `src/render/BufferPool.ts` | 按 VBO/EBO 目标分池的 GPU 缓冲复用与释放 |
| `src/render/LeafMeshManager.ts` | 叶节点网格上传、材质批次区间、签名缓存避免重复上传 |
| `src/render/Renderer.ts` | WebGL2 管线、三种显示模式、线框与拾取高亮 |
| `src/app/` | 相机控制、主装配与 HUD |

## 关键设计

- **无孔洞、无位置漂移**：所有四边形顶点都落在全局整数晶格上，叶节点无论
  大小共享同一套体素坐标；网格只对“实心→空气”的暴露面出片，实心-实心面
  一律剔除，因此不同 LOD 的相邻叶节点边界精确重合。
- **相邻 LOD 差限制**：距离 LOD 以每步 `maxNeighborLodDiff` 级的深度上限
  表达，相邻单元深度天然不越界；面预算触发的细分只在混合节点间做受限传播，
  均匀盐岩节点保持单叶，避免细分级联爆炸。
- **缓冲复用/释放**：每帧从根重建叶集（节点按 key 复用），消失叶的 VBO/EBO
  归还 `BufferPool`，新叶优先认领容量足够的旧缓冲；未变化的签名跳过重新上传。
- **拾取 LOD 不变性**：DDA 直接遍历固定体素世界，不读取八叉树，切换 LOD
  前后同一射线命中同一体素。

## 操作

- 鼠标拖拽环视，滚轮调移动速度；`WASD` 平移，`Q/E` 下降/上升
- `1/2/3` 切换最终着色、LOD 色块、线框；`B` 叠加叶节点包围盒
- `R` 沿竖井自动下降；点击场景或按 `P` 拾取体素
- HUD 实时显示节点总数、叶节点数、面数、批次数、GPU 叶网格、缓冲复用次数
