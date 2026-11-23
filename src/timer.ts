export interface TimestampSample {
  readonly querySet: GPUQuerySet;
  readonly resolveBuffer: GPUBuffer;
  readonly readBuffer: GPUBuffer;
  inUse: boolean;
}

export class StageTimer {
  private readonly pool: TimestampSample[] = [];
  private readonly available: TimestampSample[] = [];

  constructor(
    device: GPUDevice,
    readonly enabled: boolean,
    private readonly onSample: (milliseconds: number) => void,
    poolSize = 14,
  ) {
    if (!enabled) {
      return;
    }
    for (let index = 0; index < poolSize; index += 1) {
      const sample: TimestampSample = {
        querySet: device.createQuerySet({ type: "timestamp", count: 2 }),
        resolveBuffer: device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        }),
        readBuffer: device.createBuffer({
          size: 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
        inUse: false,
      };
      this.pool.push(sample);
      this.available.push(sample);
    }
  }

  acquire(): TimestampSample | null {
    const sample = this.available.pop() ?? null;
    if (sample) {
      sample.inUse = true;
    }
    return sample;
  }

  encodeResolve(encoder: GPUCommandEncoder, sample: TimestampSample): void {
    encoder.resolveQuerySet(sample.querySet, 0, 2, sample.resolveBuffer, 0);
    encoder.copyBufferToBuffer(sample.resolveBuffer, 0, sample.readBuffer, 0, 16);
  }

  submitted(sample: TimestampSample): void {
    void sample.readBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const values = new BigInt64Array(sample.readBuffer.getMappedRange());
        const duration = Number(values[1] - values[0]) / 1_000_000;
        sample.readBuffer.unmap();
        sample.inUse = false;
        this.available.push(sample);
        if (Number.isFinite(duration) && duration >= 0 && duration < 1000) {
          this.onSample(duration);
        }
      })
      .catch(() => {
        sample.inUse = false;
        this.available.push(sample);
      });
  }

  destroy(): void {
    for (const sample of this.pool) {
      sample.querySet.destroy();
      sample.resolveBuffer.destroy();
      sample.readBuffer.destroy();
    }
  }
}
