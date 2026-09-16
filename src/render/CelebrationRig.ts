import * as THREE from 'three';

import type { CubeRenderer } from './CubeRenderer';
import { CONTENT_CENTER } from './SceneManager';

/**
 * Soft round sprite for the sparks. Default `THREE.Points` draws untextured
 * squares, which read as confetti pixels; a radial falloff makes each spark a
 * small glowing dot instead. Built once per page and shared by every burst
 * (it is a 64px canvas, cheap enough to keep alive for the session).
 */
let sparkTexture: THREE.CanvasTexture | null = null;

function sparkSprite(): THREE.CanvasTexture {
  if (sparkTexture) return sparkTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.92)');
    gradient.addColorStop(0.72, 'rgba(255, 255, 255, 0.28)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  sparkTexture = new THREE.CanvasTexture(canvas);
  sparkTexture.colorSpace = THREE.SRGBColorSpace;
  return sparkTexture;
}

/**
 * Solve-celebration burst: 54 sticker-coloured sparks that fly out, fall,
 * then ease back to their spawn points and get re-absorbed. The rig object
 * is reusable; its frame hook is registered only while a burst is live, and
 * re-triggering cancels the prior burst first.
 */
export class CelebrationRig {
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.PointsMaterial | null = null;
  private unregisterFrame: (() => void) | null = null;
  private spawn: Float32Array | null = null;
  private velocity: Float32Array | null = null;
  private settleFrom: Float32Array | null = null;
  private count = 0;
  private elapsed = 0;
  private readonly scene: THREE.Scene;
  private readonly renderer: CubeRenderer;
  private readonly frameSource: {
    registerFrameHook(fn: (delta: number, elapsed: number) => void): () => void;
  };
  private readonly tick = (delta: number): void => this.step(delta);

  /** Fly-out then settle, in seconds. */
  private static readonly FLY_SECONDS = 0.9;
  private static readonly TOTAL_SECONDS = 1.6;

  constructor(
    scene: THREE.Scene,
    renderer: CubeRenderer,
    frameSource: {
      registerFrameHook(fn: (delta: number, elapsed: number) => void): () => void;
    },
  ) {
    this.scene = scene;
    this.renderer = renderer;
    this.frameSource = frameSource;
  }

  /** Spawn the burst if idle; cancels any prior burst first. */
  trigger(): void {
    this.cancel();
    const positions: number[] = [];
    const colors: number[] = [];
    const group = this.renderer.object;
    group.updateMatrixWorld(true);
    const world = new THREE.Vector3();
    const color = new THREE.Color();
    for (const child of group.children) {
      for (const sticker of child.children) {
        const userData: { stickerIndex?: number } = sticker.userData;
        if (userData.stickerIndex === undefined) continue;
        const mesh = sticker as THREE.Mesh;
        mesh.getWorldPosition(world);
        positions.push(world.x, world.y, world.z);
        const material = mesh.material as THREE.MeshPhysicalMaterial;
        color.copy(material.color);
        colors.push(color.r, color.g, color.b);
      }
    }
    this.count = positions.length / 3;
    if (this.count === 0) return;

    this.spawn = new Float32Array(positions);
    this.velocity = new Float32Array(this.count * 3);
    const direction = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      direction.set(
        positions[i * 3] - CONTENT_CENTER.x,
        positions[i * 3 + 1] - CONTENT_CENTER.y,
        positions[i * 3 + 2] - CONTENT_CENTER.z,
      );
      if (direction.lengthSq() < 1e-8) direction.set(0, 1, 0);
      direction.normalize();
      const speed = 2.5 + Math.random() * 1.5;
      this.velocity[i * 3] = direction.x * speed;
      this.velocity[i * 3 + 1] = direction.y * speed + 1 + Math.random();
      this.velocity[i * 3 + 2] = direction.z * speed;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    this.material = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.075,
      map: sparkSprite(),
      alphaTest: 0.02,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.elapsed = 0;
    this.unregisterFrame = this.frameSource.registerFrameHook(this.tick);
  }

  private step(rawDelta: number): void {
    if (!this.points || !this.geometry || !this.spawn || !this.velocity) return;
    // A backgrounded tab can deliver a huge delta; cap it so the burst never
    // teleports through its whole arc in one frame.
    const delta = Math.min(rawDelta, 0.1);
    this.elapsed += delta;
    const positions = (this.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const { FLY_SECONDS, TOTAL_SECONDS } = CelebrationRig;

    if (this.elapsed < FLY_SECONDS) {
      const drag = Math.exp(-1.8 * delta);
      for (let i = 0; i < this.count; i++) {
        const ix = i * 3;
        this.velocity[ix] *= drag;
        this.velocity[ix + 1] = this.velocity[ix + 1] * drag - 6 * delta;
        this.velocity[ix + 2] *= drag;
        positions[ix] += this.velocity[ix] * delta;
        positions[ix + 1] += this.velocity[ix + 1] * delta;
        positions[ix + 2] += this.velocity[ix + 2] * delta;
      }
    } else {
      // Re-absorption: ease from wherever the burst ended back to the spawn
      // points with cubic ease-in-out, then self-clean.
      const t = Math.min((this.elapsed - FLY_SECONDS) / (TOTAL_SECONDS - FLY_SECONDS), 1);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // Snapshot the fly-out end positions on the first settle frame.
      if (!this.settleFrom) {
        this.settleFrom = new Float32Array(positions);
      }
      const from = this.settleFrom;
      for (let i = 0; i < positions.length; i++) {
        positions[i] = from[i] + (this.spawn[i] - from[i]) * eased;
      }
      if (t >= 1) {
        this.cancel();
        return;
      }
    }
    this.geometry.getAttribute('position').needsUpdate = true;
  }


  private cancel(): void {
    this.unregisterFrame?.();
    this.unregisterFrame = null;
    if (this.points) {
      this.scene.remove(this.points);
      this.points = null;
    }
    this.geometry?.dispose();
    this.geometry = null;
    this.material?.dispose();
    this.material = null;
    this.spawn = null;
    this.velocity = null;
    this.settleFrom = null;
    this.count = 0;
    this.elapsed = 0;
  }

  dispose(): void {
    this.cancel();
  }
}
