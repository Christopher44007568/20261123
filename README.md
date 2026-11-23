# 风洞毛发渲染实验台

程序化毛发渲染实验台：TypeScript + WebGL2 + GLSL，零图形库，模型与纹理全部由代码生成。
弯曲基体上分布 40000 根 guide strands，可调毛长、粗糙度、风向/风力、密度，
支持侧光、逆光、掠射三种观察预设。

## 运行

```bash
npm install
npm run build          # tsc -> dist/
npx serve .            # 或任意静态服务器，打开 index.html
```

## 渲染架构

- **L0 发丝**：每根毛发 6 段曲线（法线出发，风力弯曲 + 随机卷曲），
  顶点着色器中沿视线垂直方向展开的相机朝向 ribbon，宽度向发尖收窄。
- **L1 发卡**：3600 个 clump，每个为 2 片交叉的渐变宽度 quad strip，
  纹理由 Canvas 程序化绘制（约 170 根粗细/透明度随机的发丝）。
- **L2 壳层**：基体网格 instanced 挤出 24 层，fragment 内 hash 决定毛发存在与长度。

## 着色

- Kajiya-Kay 各向异性：`sin(T,L)` 漫反射 + `sin(T,H)^n` 高光，粗糙度控制指数。
- 逆光透射：`pow(max(V·-L,0),2) * t²`，只让毛尖透光，根部不受逆光影响。
- 近似自阴影：按深度 `t`（根→尖）指数衰减 + 密度耦合的环境遮蔽。
- 软 tonemap `1-exp(-c·k)` 保证根部不过曝。

## LOD 切换（无跳变）

- 距离驱动三段 fade，任意时刻三者权重和为 1（互补曲线）。
- 过渡区用 interleaved gradient noise 做 screen-door 抖动：
  淡出层保留 `ign < f` 的像素，淡入层精确填充余下的像素（互补阈值），
  每个像素任一时刻只属于一层，轮廓与覆盖率严格守恒。
- 三层亮度已对齐：实测目标区域平均亮度 52.2(发丝) → 53.7(发卡) → 55.9(壳层)，
  偏差 < 8%，无可见跳变。

## 透明排序

基体不透明先画（写深度）→ 毛发层开深度测试、关深度写入、alpha 混合。
发丝按空间 cell 分块（16×8），每帧按块质心远→近排序绘制；发卡逐张排序；
壳层由内向外 instanced。基体后方毛发被正确遮挡（`below-view` 验证）。

## 无头验证

```bash
node tools/shot.mjs '[{"name":"x","q":"lod=compare&preset=back&dist=7"}]'
```

URL 参数：`lod=auto|strand|card|shell|compare`、`preset=side|back|graze`、
`dist/az/el/len/density/wind/rough`、`probe=1`（输出平均亮度/覆盖率到 `window.__probe`）。
验证截图在 `artifacts/`：三层对比、逆光毛尖透光、过渡亮度序列、底部视角遮挡。
