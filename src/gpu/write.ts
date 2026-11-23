export function gpuView(data: ArrayBufferView | ArrayBuffer): GPUAllowSharedBufferSource {
  return data as GPUAllowSharedBufferSource;
}
