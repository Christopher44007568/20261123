export class StageTimer {
    enabled;
    onSample;
    pool = [];
    available = [];
    constructor(device, enabled, onSample, poolSize = 14) {
        this.enabled = enabled;
        this.onSample = onSample;
        if (!enabled) {
            return;
        }
        for (let index = 0; index < poolSize; index += 1) {
            const sample = {
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
    acquire() {
        const sample = this.available.pop() ?? null;
        if (sample) {
            sample.inUse = true;
        }
        return sample;
    }
    encodeResolve(encoder, sample) {
        encoder.resolveQuerySet(sample.querySet, 0, 2, sample.resolveBuffer, 0);
        encoder.copyBufferToBuffer(sample.resolveBuffer, 0, sample.readBuffer, 0, 16);
    }
    submitted(sample) {
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
    destroy() {
        for (const sample of this.pool) {
            sample.querySet.destroy();
            sample.resolveBuffer.destroy();
            sample.readBuffer.destroy();
        }
    }
}
//# sourceMappingURL=timer.js.map