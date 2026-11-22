import { clamp, type Vec3 } from '../engine/math3.js';

export interface OrbitState {
  eye: Vec3;
  yaw: number;
  pitch: number;
}

/**
 * First-person style fly camera. Mouse drag rotates, WASD / QE move, and the
 * auto-descent driver pushes the eye downward along the shaft.
 */
export class CameraController {
  yaw = 0;
  pitch = -0.15;
  eye: Vec3 = { x: 64, y: 104, z: 72 };
  speed = 22;
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  autoDescend = false;
  descendSpeed = 6;

  constructor(private readonly canvas: HTMLCanvasElement) {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private onPointerUp = (): void => {
    this.dragging = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) {
      return;
    }
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.yaw -= dx * 0.005;
    this.pitch = clamp(this.pitch - dy * 0.005, -1.45, 1.45);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.speed = clamp(this.speed * (e.deltaY > 0 ? 0.9 : 1.1), 4, 80);
  };

  forward(): Vec3 {
    const cp = Math.cos(this.pitch);
    return {
      x: -Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: -Math.cos(this.yaw) * cp,
    };
  }

  update(dt: number, bounds: number): void {
    const f = this.forward();
    const right = { x: Math.cos(this.yaw), y: 0, z: -Math.sin(this.yaw) };
    const move = { x: 0, y: 0, z: 0 };
    const add = (dir: Vec3, amount: number) => {
      move.x += dir.x * amount;
      move.y += dir.y * amount;
      move.z += dir.z * amount;
    };
    if (this.keys.has('KeyW')) {
      add(f, 1);
    }
    if (this.keys.has('KeyS')) {
      add(f, -1);
    }
    if (this.keys.has('KeyA')) {
      add(right, -1);
    }
    if (this.keys.has('KeyD')) {
      add(right, 1);
    }
    if (this.keys.has('KeyE') || this.keys.has('Space')) {
      move.y += 1;
    }
    if (this.keys.has('KeyQ') || this.keys.has('ControlLeft')) {
      move.y -= 1;
    }
    const len = Math.hypot(move.x, move.y, move.z);
    if (len > 0) {
      this.eye.x += (move.x / len) * this.speed * dt;
      this.eye.y += (move.y / len) * this.speed * dt;
      this.eye.z += (move.z / len) * this.speed * dt;
    }
    if (this.autoDescend) {
      this.eye.y -= this.descendSpeed * dt;
    }
    this.eye.x = clamp(this.eye.x, 2, bounds - 2);
    this.eye.y = clamp(this.eye.y, 2, bounds + 12);
    this.eye.z = clamp(this.eye.z, 2, bounds - 2);
  }

  target(): Vec3 {
    const f = this.forward();
    return { x: this.eye.x + f.x, y: this.eye.y + f.y, z: this.eye.z + f.z };
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
  }
}
