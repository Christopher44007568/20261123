# 盐雾材质台 / Salt Material Lab

离线程序化古建材质与纹理压缩实验台，限定实现栈为 **TypeScript + WebGL2 + GLSL**。
不使用 three.js、图像处理库或 WebGPU。

## 功能

- 四种程序化材质：盐蚀青砖、风化陶瓦、锈蚀铁板、镂空金属屏风。
- 材质 MRT 同时生成基础色、切线空间法线、粗糙度/AO/盐结晶三张 1024² RGBA 贴图。
- `尺度 / 磨损 / 盐雾` 三个参数实时驱动 GLSL 图案与材质。
- 独立 BC1 / BC3 块编码器和解码器，包含完整 mip 链与 DDS（DX10）导出。
- 基础色以 sRGB 纹理格式读取；法线与粗糙度以线性格式读取。
- 支持 S3TC 时上传 GPU 压缩纹理；扩展缺失或手动勾选时回退 CPU 解码后 RGBA 上传。
- 原始 RGBA、压缩后解码、误差热图三种 3D 与 2D 纹理视图。
- 统计整条 mip 链的压缩字节、PSNR、最大色差与压缩率。
- DDS 重载会实际解析、解码并重新上传贴图，再比对字节、mip、尺度、sRGB 标记和法线方向。

## 运行

```bash
npm install
npm run dev
```

生产构建：

```bash
npm run build
```

## 测试

```bash
npm test
```

覆盖 BC1 1-bit alpha、BC3 标准 alpha-first 块布局、mip 法线重归一化、
DDS 多级 mip 往返、sRGB/DXGI 标记和法线方向一致性。

浏览器回归（需要先启动 `npm run dev -- --port 4174`）：

```bash
npm run test:browser
npm run test:visual
```

浏览器回归会实际执行 BC1 → BC3 → 多级 mip → 四材质 → DDS 导出 → 重载 → CPU 回退切换，
并断言无页面错误；可视检查脚本生成斜视砖缝、金属孔洞、热图与极限参数截图。

## 关键实现

- `src/gl/materialShader.ts`：四种材质的 GLSL 场函数、高度导数法线与 MRT 输出。
- `src/compression/bc.ts`：BC1/BC3 块编码、解码、误差指标。
- `src/compression/mips.ts`：sRGB 感知的基础色 mip、法线球面化平均与线性通道 mip。
- `src/compression/dds.ts`：标准 DX10 DDS 写入/解析，基础色写 `_SRGB` DXGI 格式。
- `src/gl/renderer.ts`：WebGL2 材质预览、压缩纹理上传/回退、原始/解码/热图三种渲染路径。
- `src/gl/thumbRenderer.ts`：三联纹理检查器，同样使用 WebGL2 + GLSL。

默认 1024² 砖墙在 BC1 全 mip 链下约 682.7 KB，基础色 PSNR 约 40.35 dB；
BC3 全 mip 链约 1.33 MB。DDS 重载验证结果包含 `3/3 字节一致` 与法线均值 `dot ≈ 1.00000`。
