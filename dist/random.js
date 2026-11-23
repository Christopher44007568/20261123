export class Random {
    state;
    constructor(seed) {
        this.state = seed >>> 0;
    }
    next() {
        let value = (this.state += 0x6d2b79f5);
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
    range(min, max) {
        return min + (max - min) * this.next();
    }
    pick(values) {
        return values[Math.floor(this.next() * values.length)];
    }
}
//# sourceMappingURL=random.js.map