import { Random } from "./random.js";
export const INSTANCE_STRIDE_FLOATS = 12;
export const SOURCE_LIGHT_STRIDE_FLOATS = 12;
export const MAX_INSTANCES = 2048;
export const MAX_LIGHTS = 96;
export const LIGHT_BIN_COLUMNS = 16;
export const LIGHT_BIN_ROWS = 9;
const STEEL = [0.08, 0.115, 0.125];
const DARK_STEEL = [0.035, 0.055, 0.06];
const RUST = [0.25, 0.105, 0.045];
const CONCRETE = [0.105, 0.125, 0.12];
const AMBER = [1.0, 0.48, 0.12];
const RED = [1.0, 0.16, 0.1];
const TEAL = [0.2, 1.0, 0.82];
const LIME = [0.58, 1.0, 0.38];
const WARM_WHITE = [1.0, 0.64, 0.31];
class Builder {
    instances = [];
    lights = [];
    instanceCount = 0;
    lightCount = 0;
    box(position, size, color, emissive = 0, kind = 0, yaw = 0) {
        if (this.instanceCount >= MAX_INSTANCES) {
            throw new Error(`Scene exceeds ${MAX_INSTANCES} instances`);
        }
        this.instances.push(position[0], position[1], position[2], yaw, size[0], size[1], size[2], emissive, color[0], color[1], color[2], kind);
        this.instanceCount += 1;
    }
    light(position, radius, color, intensity, phase, rate, kind, lightRadius) {
        if (this.lightCount >= MAX_LIGHTS) {
            throw new Error(`Scene exceeds ${MAX_LIGHTS} lights`);
        }
        this.lights.push(position[0], position[1], position[2], radius, color[0], color[1], color[2], intensity, phase, rate, kind, lightRadius);
        this.lightCount += 1;
    }
    finish() {
        return {
            instances: new Float32Array(this.instances),
            instanceCount: this.instanceCount,
            sourceLights: new Float32Array(this.lights),
            lightCount: this.lightCount,
        };
    }
}
function railingX(builder, start, end, y, z) {
    const count = Math.max(2, Math.round((end - start) / 1.5));
    for (let index = 0; index <= count; index += 1) {
        const x = start + ((end - start) * index) / count;
        builder.box([x, y + 0.45, z], [0.055, 0.9, 0.055], STEEL);
    }
    builder.box([(start + end) / 2, y + 0.9, z], [end - start, 0.055, 0.055], STEEL);
    builder.box([(start + end) / 2, y + 0.47, z], [end - start, 0.04, 0.04], STEEL);
}
function railingZ(builder, start, end, y, x) {
    const count = Math.max(2, Math.round((end - start) / 1.5));
    for (let index = 0; index <= count; index += 1) {
        const z = start + ((end - start) * index) / count;
        builder.box([x, y + 0.45, z], [0.055, 0.9, 0.055], STEEL);
    }
    builder.box([x, y + 0.9, (start + end) / 2], [0.055, 0.055, end - start], STEEL);
    builder.box([x, y + 0.47, (start + end) / 2], [0.04, 0.04, end - start], STEEL);
}
function addSignal(builder, x, z, color, phase, y = 0) {
    builder.box([x, y + 0.75, z], [0.075, 1.5, 0.075], DARK_STEEL, 0, 0);
    builder.box([x, y + 1.54, z], [0.25, 0.08, 0.25], STEEL, 0, 0);
    builder.box([x, y + 1.66, z], [0.18, 0.18, 0.18], color, 3.2, 1);
    builder.box([x, y + 1.78, z], [0.3, 0.06, 0.24], DARK_STEEL, 0, 0);
    builder.light([x, y + 1.66, z], 3.4, color, 4.2, phase, 2.3 + (phase % 1.4), 0, 0);
}
function addConveyorX(builder) {
    const z = -7.4;
    const deckY = 3.25;
    builder.box([0, deckY, z], [31.5, 0.24, 1.42], [0.035, 0.045, 0.045], 0, 0);
    builder.box([0, deckY + 0.06, z - 0.72], [31.5, 0.16, 0.08], TEAL, 2.4, 1);
    builder.box([0, deckY + 0.06, z + 0.72], [31.5, 0.16, 0.08], TEAL, 2.4, 1);
    for (let x = -15.5; x <= 15.5; x += 1.4) {
        builder.box([x, deckY + 0.17, z], [0.075, 0.06, 1.2], RUST, 0, 0);
    }
    builder.box([0, deckY - 0.42, z - 0.8], [31.5, 0.15, 0.15], STEEL);
    builder.box([0, deckY - 0.42, z + 0.8], [31.5, 0.15, 0.15], STEEL);
    for (let x = -15.5; x <= 15.5; x += 2) {
        builder.box([x, deckY - 0.42, z], [0.11, 0.11, 1.6], STEEL);
    }
    for (let x = -14; x <= 14; x += 3.6) {
        for (const side of [-1, 1]) {
            builder.box([x, 1.42, z + side * 0.82], [0.15, 2.84, 0.15], STEEL);
            builder.box([x, 1.25, z + side * 0.82], [0.7, 0.08, 0.08], RUST);
        }
        builder.box([x, 1.25, z], [0.1, 0.1, 1.65], RUST);
    }
    builder.box([0, 2.25, z + 1.35], [31.5, 0.14, 0.76], CONCRETE);
    railingX(builder, -15.6, 15.6, 2.32, z + 1.72);
    builder.box([0, 2.36, z + 0.97], [31.5, 0.16, 0.04], AMBER, 1.4, 1);
    builder.box([-16.8, 3.55, z], [3.4, 2.5, 3.6], RUST);
    builder.box([-16.8, 4.95, z], [2.6, 1.1, 2.8], DARK_STEEL);
    builder.box([-15.25, 3.7, z], [0.1, 2.1, 2.1], DARK_STEEL, 0, 0, 0.08);
    builder.box([16.7, 3.3, z], [2.2, 2, 2.3], RUST);
    builder.box([14.9, 3.65, z], [0.8, 0.9, 1.5], [0.03, 0.04, 0.04], 0, 0);
    for (const x of [-15.2, -10.4, -5.4, 0.2, 5.8, 10.4, 14.2]) {
        builder.light([x, 2.8, z + 0.92], 3.7, WARM_WHITE, 3.4, x * 0.17, 0.5, 0, 0);
    }
    addSignal(builder, -18.7, z - 0.1, RED, 0.4);
    addSignal(builder, 18.1, z - 0.1, AMBER, 1.7);
}
function addConveyorZ(builder) {
    const x = 9.5;
    const deckY = 4.55;
    builder.box([x, deckY, 0], [1.25, 0.22, 28], [0.032, 0.045, 0.045]);
    builder.box([x - 0.66, deckY + 0.06, 0], [0.075, 0.14, 28], TEAL, 2.2, 1);
    builder.box([x + 0.66, deckY + 0.06, 0], [0.075, 0.14, 28], TEAL, 2.2, 1);
    builder.box([x - 0.75, deckY - 0.38, 0], [0.14, 0.14, 28], STEEL);
    builder.box([x + 0.75, deckY - 0.38, 0], [0.14, 0.14, 28], STEEL);
    for (let z = -13; z <= 13; z += 2) {
        builder.box([x, deckY - 0.38, z], [1.45, 0.1, 0.1], STEEL);
    }
    for (let z = -12; z <= 12; z += 4) {
        for (const side of [-1, 1]) {
            builder.box([x + side * 0.73, 2, z], [0.14, 4, 0.14], STEEL);
        }
        builder.box([x, 1.65, z], [1.45, 0.09, 0.09], RUST);
    }
    builder.box([x, deckY + 0.62, 0], [2.5, 0.08, 0.08], STEEL);
    builder.box([x - 1.28, deckY + 0.36, 0], [0.04, 0.56, 27], STEEL, 0, 3);
    builder.box([x + 1.28, deckY + 0.36, 0], [0.04, 0.56, 27], STEEL, 0, 3);
    for (const z of [-11, -5.5, 0.2, 6, 11.5]) {
        builder.light([x - 1.1, 4.2, z], 4.1, AMBER, 4.6, z * 0.2, 0.7, 0, 0);
    }
}
function addMaintenancePlatform(builder) {
    const x = -8.2;
    const z = 3.8;
    const y = 4.05;
    builder.box([x, y, z], [7.4, 0.2, 5], CONCRETE);
    builder.box([x, y + 0.13, z - 2.42], [7.4, 0.08, 0.08], AMBER, 0.8, 3);
    builder.box([x, y + 0.13, z + 2.42], [7.4, 0.08, 0.08], AMBER, 0.8, 3);
    for (const px of [x - 3.1, x + 3.1]) {
        for (const pz of [z - 2.1, z + 2.1]) {
            builder.box([px, 1.95, pz], [0.18, 3.9, 0.18], STEEL);
            builder.box([px, 0.1, pz], [0.48, 0.2, 0.48], CONCRETE);
        }
    }
    builder.box([x, 2.1, z - 2.1], [6.4, 0.13, 0.13], STEEL);
    builder.box([x, 2.1, z + 2.1], [6.4, 0.13, 0.13], STEEL);
    railingX(builder, x - 3.7, x + 3.7, y + 0.1, z - 2.48);
    railingX(builder, x - 3.7, x + 0.8, y + 0.1, z + 2.48);
    railingZ(builder, z - 2.48, z + 2.48, y + 0.1, x - 3.7);
    railingZ(builder, z - 2.48, z + 2.48, y + 0.1, x + 3.7);
    for (let step = 0; step < 11; step += 1) {
        builder.box([x + 4.75 + step * 0.48, y - step * 0.31, z + 1.3], [0.58, 0.16, 1.35], STEEL);
    }
    for (let step = 0; step < 11; step += 2) {
        builder.box([x + 4.62 + step * 0.48, y + 0.63 - step * 0.31, z + 0.68], [0.055, 1.05, 0.055], STEEL);
    }
    builder.light([x - 2.2, y + 2.5, z - 1.8], 5.5, WARM_WHITE, 8.5, 0.3, 0.4, 0, 0);
    builder.box([x - 1.4, y + 0.85, z - 1.3], [2.6, 1.4, 0.35], DARK_STEEL);
    builder.box([x - 2.45, y + 1.1, z - 1.08], [0.55, 0.34, 0.04], TEAL, 2.6, 1);
    builder.box([x - 1.3, y + 1.32, z - 1.08], [0.45, 0.06, 0.04], AMBER, 2.1, 1);
    builder.box([x + 1.9, y + 0.55, z - 1.3], [0.8, 0.9, 0.8], RUST);
    builder.box([x + 2.9, y + 0.45, z - 1.7], [0.8, 0.7, 0.7], [0.19, 0.12, 0.06]);
    builder.box([x - 0.4, y + 0.32, z + 1.9], [1.4, 0.08, 0.08], TEAL, 2.6, 1);
    for (let index = 0; index < 4; index += 1) {
        builder.box([x - 3.4 + index * 2.2, y - 0.8, z - 2.4], [0.18, 1.55, 0.18], STEEL);
    }
}
function addControlCabin(builder) {
    const x = -17.3;
    const z = 8.2;
    builder.box([x, 1.7, z], [5.1, 3.4, 4.3], [0.075, 0.095, 0.1]);
    builder.box([x, 3.48, z], [5.6, 0.2, 4.8], RUST);
    builder.box([x, 0.22, z], [5.6, 0.44, 4.8], CONCRETE);
    for (let index = 0; index < 3; index += 1) {
        builder.box([x - 1.55 + index * 1.55, 2.22, z + 2.18], [1.02, 0.95, 0.06], [1, 0.62, 0.26], 4.6, 4);
    }
    builder.box([x, 1.18, z + 2.19], [1.05, 1.8, 0.08], DARK_STEEL);
    builder.box([x + 1.9, 4.1, z - 0.7], [0.08, 1.2, 0.08], STEEL);
    builder.box([x + 1.9, 4.7, z - 0.7], [0.16, 0.16, 0.16], RED, 3, 1);
    builder.light([x + 1.9, 4.7, z - 0.7], 2.4, RED, 4.8, 0.1, 1.2, 0, 0);
    builder.light([x, 2.25, z + 3.1], 7, [1, 0.52, 0.18], 8.5, 0.7, 0.4, 0, 0);
    builder.box([x + 3.15, 0.45, z + 1.1], [0.9, 0.9, 0.9], RUST);
    builder.box([x + 3.2, 1.05, z + 1.2], [0.7, 0.3, 0.7], DARK_STEEL);
}
function addSiloCluster(builder) {
    const silos = [
        { x: 15.6, z: 9.8, height: 7.1 },
        { x: 19.1, z: 8.6, height: 6.1 },
        { x: 17.2, z: 12.2, height: 5.4 },
    ];
    for (const silo of silos) {
        builder.box([silo.x, silo.height / 2, silo.z], [3.1, silo.height, 3.1], [0.11, 0.135, 0.14]);
        builder.box([silo.x, silo.height + 0.25, silo.z], [3.35, 0.5, 3.35], RUST);
        builder.box([silo.x, silo.height + 0.72, silo.z], [2.5, 0.45, 2.5], RUST);
        builder.box([silo.x, silo.height + 1.08, silo.z], [1.6, 0.32, 1.6], RUST);
        for (let band = 2.2; band < silo.height; band += 2.2) {
            builder.box([silo.x, band, silo.z], [3.24, 0.09, 3.24], STEEL);
        }
        builder.box([silo.x - 2.8, 1.3, silo.z], [2.6, 0.38, 0.38], STEEL);
        builder.box([silo.x - 4.2, 0.65, silo.z], [0.25, 1.3, 0.25], STEEL);
        builder.light([silo.x, silo.height + 1.35, silo.z], 3.5, AMBER, 5, silo.x, 1.5, 0, 0);
    }
    builder.box([15.9, 0.8, 7.1], [8.8, 0.55, 0.65], RUST);
    builder.box([20.25, 2.3, 7.1], [0.65, 3.6, 0.65], STEEL);
    builder.box([10.9, 0.7, 7.1], [0.3, 1.4, 0.3], RUST);
}
function addRailYard(builder) {
    const railX = -2.2;
    builder.box([railX, 0.02, 0.5], [5.4, 0.22, 39], [0.06, 0.055, 0.045]);
    for (let z = -18.5; z <= 19; z += 1.25) {
        builder.box([railX, 0.15, z], [3.3, 0.12, 0.22], RUST);
    }
    for (const offset of [-1.25, 1.25]) {
        builder.box([railX + offset, 0.27, 0.5], [0.13, 0.15, 38], [0.18, 0.2, 0.21]);
    }
    const cartZ = 9.5;
    builder.box([railX, 1.0, cartZ], [3.2, 1.4, 5.2], [0.17, 0.09, 0.05]);
    builder.box([railX, 1.85, cartZ], [2.8, 0.3, 4.8], DARK_STEEL);
    for (const side of [-1, 1]) {
        for (const zOffset of [-1.7, 1.7]) {
            builder.box([railX + side * 1.65, 0.47, cartZ + zOffset], [0.18, 0.75, 0.75], STEEL);
        }
    }
    builder.light([railX, 2.1, cartZ - 2.1], 3.2, RED, 5.1, 0.6, 1.5, 0, 0);
}
function addFence(builder) {
    const minX = -25;
    const maxX = 24;
    const minZ = -21;
    const maxZ = 21;
    for (let x = minX; x <= maxX; x += 2.7) {
        builder.box([x, 0.68, minZ], [0.07, 1.3, 0.07], RUST);
        builder.box([x, 0.68, maxZ], [0.07, 1.3, 0.07], RUST);
    }
    builder.box([(minX + maxX) / 2, 1.25, minZ], [maxX - minX, 0.05, 0.05], RUST);
    builder.box([(minX + maxX) / 2, 1.25, maxZ], [maxX - minX, 0.05, 0.05], RUST);
    for (let z = minZ; z <= maxZ; z += 2.7) {
        builder.box([minX, 0.68, z], [0.07, 1.3, 0.07], RUST);
        builder.box([maxX, 0.68, z], [0.07, 1.3, 0.07], RUST);
    }
    builder.box([minX, 1.25, 0], [0.05, 0.05, maxZ - minZ], RUST);
    builder.box([maxX, 1.25, 0], [0.05, 0.05, maxZ - minZ], RUST);
}
function addScatter(builder, random) {
    const pilePositions = [
        [7.2, 0.45, 11.5],
        [-15.4, 0.5, -12.2],
        [20.8, 0.35, -8.4],
        [-5.4, 0.34, 15.8],
    ];
    for (const center of pilePositions) {
        for (let index = 0; index < 9; index += 1) {
            const size = random.range(0.4, 1.35);
            builder.box([
                center[0] + random.range(-1.8, 1.8),
                center[1] + random.range(-0.2, 0.5),
                center[2] + random.range(-1.8, 1.8),
            ], [size, size * random.range(0.35, 0.8), size * random.range(0.6, 1.2)], [0.16, 0.09, 0.045], 0, 0, random.range(0, Math.PI));
        }
    }
    for (const position of [
        [-21.2, 0.7, -2.1],
        [21.5, 0.8, -13.4],
        [-13.3, 1.1, 16.7],
        [12.4, 0.9, -17.1],
    ]) {
        builder.box([position[0], position[1] / 2, position[2]], [0.13, position[1], 0.13], STEEL);
        builder.box([position[0], position[1] + 0.1, position[2]], [0.8, 0.06, 0.08], DARK_STEEL);
        builder.box([position[0] + 0.36, position[1] + 0.08, position[2]], [0.2, 0.22, 0.25], WARM_WHITE, 2.8, 1);
        builder.light([position[0] + 0.36, position[1] + 0.05, position[2]], 5.2, WARM_WHITE, 6.5, 0.5, 0.4, 0, 0);
    }
}
function addSignalField(builder) {
    const signals = [
        [-19, -7.4, RED, 0.3],
        [-13.5, -10.6, AMBER, 1.1],
        [-7.4, -10.7, TEAL, 2.3],
        [-1.3, -10.5, AMBER, 0.7],
        [4.9, -10.5, RED, 2.8],
        [11.2, -10.4, LIME, 1.5],
        [17.5, -10.6, AMBER, 0.2],
        [10.8, -14.4, RED, 2.2],
        [10.8, -8.2, TEAL, 0.9],
        [10.8, -2, AMBER, 3.1],
        [10.8, 4.2, RED, 1.8],
        [10.8, 10.5, LIME, 0.4],
        [6.3, 12.6, TEAL, 2.5],
        [1.8, 14.8, AMBER, 1.3],
        [-3.7, 14.9, RED, 0.1],
        [-9.4, 14.6, TEAL, 2.9],
        [-14.9, 14.3, AMBER, 0.6],
        [-20.4, 13.2, RED, 1.9],
        [-22.1, 5.2, LIME, 2.4],
        [-21.8, -3.7, AMBER, 0.8],
        [-20.5, -14.6, TEAL, 1.7],
        [-15.7, -17.1, RED, 2.7],
        [-8.6, -17.1, AMBER, 0.5],
        [-1.1, -17.2, LIME, 1.4],
        [5.7, -17, TEAL, 2.1],
        [15.7, -17, RED, 0.9],
        [20.7, -10.9, AMBER, 2.6],
        [20.5, 2.4, TEAL, 1.2],
        [19.4, 15.3, RED, 3.2],
        [12.8, 17.1, LIME, 0.7],
        [4.2, 17.4, AMBER, 2],
        [-4.8, 17.4, TEAL, 1.6],
        [-12.7, 17.4, RED, 2.6],
        [-19.8, 17, AMBER, 0.3],
        [-12.4, 6.7, TEAL, 2.2],
        [-4.3, 7.1, AMBER, 1.2],
        [-9.4, -2.6, RED, 0.8],
        [2.4, 2.3, LIME, 2.5],
        [16.1, 4.4, AMBER, 1.1],
        [-16.7, -15.3, TEAL, 3.1],
    ];
    for (const [x, z, color, phase] of signals) {
        addSignal(builder, x, z, color, phase);
    }
}
function addMobileWorkLights(builder) {
    const workLights = [
        { center: [-6, 8.5, -2], orbit: 5.5, phase: 0.2, speed: 0.43, intensity: 34, radius: 11 },
        { center: [6, 9.2, 5], orbit: 4.6, phase: 2.4, speed: 0.34, intensity: 30, radius: 10 },
        { center: [-14, 7.4, 7], orbit: 3.2, phase: 4.1, speed: 0.58, intensity: 25, radius: 8 },
        { center: [13, 8.2, -9], orbit: 4.8, phase: 1.3, speed: 0.38, intensity: 31, radius: 10 },
        { center: [1, 10.6, 10], orbit: 6.2, phase: 5.2, speed: 0.27, intensity: 27, radius: 9 },
        { center: [-18, 7, -9], orbit: 3.8, phase: 3.3, speed: 0.47, intensity: 24, radius: 8 },
        { center: [18, 8.5, 4], orbit: 3.5, phase: 0.9, speed: 0.51, intensity: 28, radius: 9 },
        { center: [-1, 7.2, -14], orbit: 4.2, phase: 2.8, speed: 0.36, intensity: 26, radius: 9 },
    ];
    for (const work of workLights) {
        builder.light(work.center, work.orbit, WARM_WHITE, work.intensity, work.phase, work.speed, 1, work.radius);
        builder.box([work.center[0], 0.4, work.center[2]], [0.28, 0.8, 0.28], DARK_STEEL);
        builder.box([work.center[0], 0.82, work.center[2]], [0.7, 0.08, 0.7], STEEL);
    }
}
function addYardDetail(builder, random) {
    for (let index = 0; index < 18; index += 1) {
        const x = random.range(-22, 21);
        const z = random.range(-18, 18);
        if (Math.abs(x + 2.2) < 4 || (x > 5 && x < 12 && Math.abs(z) < 15)) {
            continue;
        }
        const width = random.range(0.55, 1.1);
        builder.box([x, 0.38, z], [width, 0.65, random.range(0.55, 1.1)], random.next() > 0.5 ? RUST : DARK_STEEL, 0, 0, random.range(0, Math.PI));
    }
    for (const puddle of [
        [-4.8, 0.07, -3.7, 2.8, 1.2],
        [4.2, 0.07, 7.4, 2.2, 0.8],
        [12.9, 0.07, 2.6, 1.8, 0.7],
        [-13.1, 0.07, 2.3, 2.4, 0.9],
    ]) {
        builder.box([puddle[0], puddle[1], puddle[2]], [puddle[3], 0.035, puddle[4]], [0.015, 0.05, 0.065], 0.8, 6, random.range(-0.3, 0.3));
    }
    builder.box([-13.2, 2.2, -1.7], [0.12, 4.4, 0.12], STEEL);
    builder.box([-13.2, 4.3, -1.7], [2.7, 0.12, 0.12], DARK_STEEL);
    builder.box([-14.45, 4.16, -1.7], [0.55, 0.4, 0.06], TEAL, 2.8, 1);
    builder.light([-13.2, 4.2, -1.7], 6.5, TEAL, 7.2, 1.4, 0.5, 0, 0);
    builder.box([0.2, 3.9, 14.5], [0.14, 7.8, 0.14], STEEL);
    builder.box([0.2, 7.7, 14.5], [3.5, 0.14, 0.14], STEEL);
    builder.box([-1.4, 7.55, 14.5], [0.7, 0.5, 0.08], AMBER, 3.2, 1);
    builder.light([-1.4, 7.55, 14.5], 8, AMBER, 7.6, 0.2, 0.8, 0, 0);
}
export function buildScene() {
    const builder = new Builder();
    const random = new Random(0x5eed2026);
    builder.box([0, -0.34, 0], [58, 0.55, 50], [0.028, 0.045, 0.048], 0, 2);
    builder.box([0, 0.01, 0], [44, 0.08, 37], [0.052, 0.065, 0.062], 0, 2);
    builder.box([0, 0.05, -19.7], [46, 0.055, 0.16], AMBER, 0.9, 3);
    builder.box([0, 0.05, 19.7], [46, 0.055, 0.16], AMBER, 0.9, 3);
    builder.box([-25.8, 0.05, 0], [0.16, 0.055, 38], AMBER, 0.65, 3);
    addRailYard(builder);
    addConveyorX(builder);
    addConveyorZ(builder);
    addMaintenancePlatform(builder);
    addControlCabin(builder);
    addSiloCluster(builder);
    addSignalField(builder);
    addMobileWorkLights(builder);
    addFence(builder);
    addScatter(builder, random);
    addYardDetail(builder, random);
    return builder.finish();
}
//# sourceMappingURL=scene.js.map