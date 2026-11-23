# 夜班调度站 · Async Light Grid

一个无运行时第三方依赖的 TypeScript + WebGPU + WGSL 演示：夜间矿区调度站由代码程序化生成，GPU 计算通道为下一份帧快照构建移动工作灯、可见性列表和 16 × 9 光源分块，渲染通道只消费已经完成 fence 的上一份有效快照。

![调度站预览](artifacts/preview.png)

## 运行

```bash
npm install
npm start
```

打开 `http://127.0.0.1:4173`。可设置 `PORT` 或 `HOST` 环境变量。需要支持 WebGPU 的 Chrome / Edge，必须通过 `localhost` 或 HTTPS 打开。若适配器不支持 `timestamp-query`，HUD 自动退回 CPU 围栏计时。

```bash
npm run check   # TypeScript 严格检查
npm run build   # 编译到 dist/
npm run serve   # 直接服务已编译的 dist/
```

仓库根目录的 `main.js` 是静态服务兼容入口，会转发到 `dist/main.js`。

## 场景

- 货架式传送廊、转载塔、维护平台、楼梯、栏杆、轨道、信号桩、控制室、料仓、围栏和散落料箱均由确定性随机种子生成。
- 40 余个固定信号灯和 8 个移动工作灯。移动灯位、闪烁强度、光色与照明半径在 compute pass 中按当前快照时间生成。
- 固定 18 秒相机循环：前场约 28° 缓速轨道摆动、垂直浮动和注视点漂移，全程无需用户控制相机。
- 光源按屏幕空间切成 `16 × 9` 个 tile，每个 tile 保留最多 4 个主要光源；不透明表面直接读取所在 tile 的灯索引。
- 可见性列表采用“标记 + 顺序 gather”，避免原子追加导致的实例顺序抖动，因此固定帧读回哈希可稳定复现。

## 流水线

### 帧槽

固定 3 个帧槽。每槽拥有独立的 camera uniform、动态光源数组、tile 光源分块、可见实例索引、可见标记、indirect draw 参数、compute fence 和 render fence。

槽状态只有 `free / computing / ready / rendering` 四种有效组合。计算只写非 latest、非 rendering 的槽；渲染只读取 `hasValid && !computing` 的 latest 槽。没有空闲槽时不请求更多工作，也不覆盖旧槽。

### 异步模式

每个显示 tick：

1. 先为“下一份快照”选择空闲槽，提交 compute；
2. 同一个 tick 立即用最近完成的快照提交 render；
3. compute 完成后，该槽才标记为有效并成为 latest；
4. compute 落后时，render 继续显示上一有效帧，HUD 显示 `COMPUTE LAGGING`、stale age 和 backpressure。

异步路径不会把 `computing` 槽绑定给渲染，也不会清空屏幕等待新结果。

### 同步模式

同步模式先提交 compute，CPU 等待该槽的 `mapAsync` 完成围栏，再提交同帧 render。HUD 的 `COMPUTE WAIT` 就是这段真实的 CPU 阻塞时间。

### 显式围栏

每次提交末尾把常量 word 复制到槽的 4 字节围栏缓冲。只有 `GPUBuffer.mapAsync(GPUMapMode.READ)` 对该 word 完成后，槽才允许：

- compute 槽从 `computing` 变为 `ready`；
- render 槽从 `rendering` 变为可复用；
- 下一帧写入该槽的 uniform / storage buffer。

这不是按时间猜测完成，也没有使用未围栏的“双缓冲”覆盖。

WebGPU 规范只暴露一个 `GPUQueue`，提交顺序由实现保证；因此这里的“异步”是 CPU 不等待、compute/render 使用独立 command encoder 和独立帧槽提交，并让驱动有机会重排/重叠相邻工作，而不是绕过单队列创建第二个硬件队列。

### Compute 顺序

WGSL 内部的多个 dispatch 被拆成独立 compute pass，依靠 pass 边界建立存储可见性：

1. 复位 indirect 参数；
2. 生成动态灯光；
3. 标记可见实例；
4. 顺序 gather 可见列表，保证绘制顺序确定性；
5. 构建 16 × 9 光源分块。

此前灯生成与分块放在同一 pass 时，读回验证会偶发拿到上一版本灯光；拆分 pass 后 A/B 哈希稳定一致。

## HUD 指标

- `COMPUTE`：timestamp query 包住全部 compute pass 的 GPU 时间。
- `RENDER`：opaque、indirect 可见实例、灯光 halo、移动灯光束的 GPU pass 时间。
- `COMPUTE WAIT`：同步模式下 CPU 等待 compute 围栏的时间；异步模式按设计为 `0.00 ms`。
- `P95 TAIL`：当前模式最近渲染提交到 render fence 完成的 P95。
- `STALE AGE`：当前理想相机帧与最近有效快照帧的差。
- `BACKPRESSURE`：异步计算在飞时继续请求新工作的次数；高负载下增长。
- `OVERWRITE BLOCK`：被槽状态机拒绝的提前复用次数；正常验证应保持 0。
- `EXPLICIT FENCES / recycles`：已完成的 mapAsync 围栏数和安全回收的槽次数。

## A/B 验证

点击 `RUN A/B CHECK`。验证在 pause 状态使用固定帧 `0 / 246 / 522`：

- 同步路径：compute 到围栏完成，再 render 并 GPU 读回；
- 异步路径：在第二个槽启动同一帧 compute，在它未完成时继续 render 上一有效快照并读回，随后等待围栏并 render 新快照；
- 对比同步帧、异步帧和“旧帧保持”三次读回的 FNV-1a 哈希；
- 同时检查 computing 槽未被调度器选中。

当前环境结果见 `artifacts/validation.json`：

- 三个固定帧的 sync / async / intermediate 哈希均一致；
- 围栏保护全部 `guardHeld: true`；
- `overwriteBlocks: 0`；
- 暂停在 frame 180 时实时 async 与 sync 画面哈希均为 `91a424e6`。

浏览器内也可直接调用：

```js
await window.__dispatch.runAudit();
window.__dispatch.diagnostics();
await window.__dispatch.captureLatest();
```

URL 参数便于复现：`?mode=async&load=1&frame=180&paused=1`。

## 性能与高负载

`1× / 4× / 12× / 24×` 控制光源分块中的合成计算迭代量。下表来自本机无头 Chromium 159 + SwiftShader、1280 × 720 的相对结果；绝对毫秒数不能代表独立显卡。

| 模式 / 负载 | Compute | Render | Compute Wait | P95 Tail | Stale | Backpressure |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| async / 1× | 1.09 ms | 144.53 ms | 0.00 ms | 230.7 ms | 5 | 50 |
| async / 24× | 6.99 ms | 108.82 ms | 0.00 ms | 227.1 ms | 11 | 123 |
| sync / 24× | 7.74 ms | 113.19 ms | 16.51 ms | 253.6 ms | 6 | 0 |
| sync / 1× | 1.79 ms | 110.05 ms | 9.83 ms | 235.8 ms | 4 | 0 |

高负载下降级方式是“保帧”：

- compute GPU 时间从约 1.1 ms 增至约 7.0 ms；
- backpressure 从 50 增至 123；
- stale age 增长，但 render 仍使用上一有效快照；
- `overwriteBlocks` 始终为 0，未发生未完成资源复用；
- 同步模式则把等待显式计入 CPU `COMPUTE WAIT`（约 10–17 ms）。

## 文件

- `src/renderer.ts`：适配器、帧槽、调度、fence、timestamp query、A/B 读回。
- `src/shaders.ts`：背景、实例、光源 halo/beam、compute WGSL。
- `src/scene.ts`：程序化场景与光源源数据。
- `src/math.ts`：矩阵、向量和固定相机路径。
- `src/hud.ts` / `styles.css`：状态、指标和控制面板。
- `artifacts/preview.png`、`artifacts/validation.json`：预览与本次验证结果。

运行时没有第三方 JavaScript/WGSL 库；`typescript` 与 `@webgpu/types` 仅用于构建和类型检查。
