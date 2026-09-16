import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { CubeletVisual } from './types';
import {
  BODY_MATERIAL,
  BODY_RADIUS,
  BODY_SIZE,
  SPACING,
  STICKER_MATERIAL,
  STICKER_OFFSET,
  STICKER_RADIUS,
  STICKER_SIZE,
  STICKER_THICKNESS,
} from './palette';

interface Slot {
  readonly group: THREE.Group;
  readonly basePosition: THREE.Vector3;
  readonly baseQuaternion: THREE.Quaternion;
}

const AXIS_VECTORS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
} as const;

const STICKER_FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * Owns the three.js representation of the cube. It is a pure mirror of
 * `CubeState`: `sync` writes exact transforms derived from the integer state,
 * so nothing here can drift or feed back into the model.
 */
export class CubeRenderer {
  readonly object = new THREE.Group();
  readonly cubeletIds: number[] = [];

  private slots = new Map<number, Slot>();
  private materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private bodyGeometry: RoundedBoxGeometry | null = null;
  private stickerGeometry: RoundedBoxGeometry | null = null;
  private overridden: number[] = [];

  /** Exploded-view amount: 0 assembled, 1 fully spread. */
  private explode = 0;
  private explodeTarget = 0;
  private intro: {
    offsets: Map<number, { pos: THREE.Vector3; quat: THREE.Quaternion; delay: number }>;
    elapsed: number;
    duration: number;
  } | null = null;
  private unregisterFrame: (() => void) | null = null;
  /** Frame-hook source: the renderer borrows SceneManager's loop via this. */
  private frameSource: {
    registerFrameHook(fn: (delta: number, elapsed: number) => void): () => void;
  } | null = null;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private static readonly IDENTITY_QUAT = new THREE.Quaternion();

  /**
   * Provide the frame loop the explode/intro tween runs on (the SceneManager).
   * Called once by App after attach; build() registers the hook from this.
   */
  setFrameSource(
    source: {
      registerFrameHook(fn: (delta: number, elapsed: number) => void): () => void;
    } | null,
  ): void {
    this.frameSource = source;
    if (!source) this.unregisterTick();
    else this.ensureTick();
  }

  /** Exploded-view amount: 0 assembled, 1 fully spread. */
  setExplode(target: number, immediate = false): void {
    this.explodeTarget = Math.min(Math.max(target, 0), 1);
    if (immediate) {
      this.explode = this.explodeTarget;
      this.reapplyAll();
    }
    this.ensureTick();
  }

  /**
   * One-time assembly animation: cubelets fly in from a scattered shell.
   * Scatter positions sit <= 3.3 units from the centre on purpose — the
   * key-light shadow frustum is +/-3.4, so nothing pops out of shadow mid-intro.
   */
  beginIntro(duration = 1.2): void {
    const offsets = new Map<
      number,
      { pos: THREE.Vector3; quat: THREE.Quaternion; delay: number }
    >();
    for (const [id, slot] of this.slots) {
      const length = slot.basePosition.length();
      if (length < 1e-6) continue; // core cubie: nowhere to scatter from
      const dir = slot.basePosition.clone().normalize();
      const pos = dir.clone().multiplyScalar(2.5 + Math.random() * 0.8);
      const quat = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
        ),
      );
      const delay = 0.15 * (1 - dir.y) + Math.random() * 0.1;
      offsets.set(id, { pos, quat, delay });
    }
    this.intro = { offsets, elapsed: 0, duration };
    this.ensureTick();
    this.reapplyAll();
  }

  private ensureTick(): void {
    if (this.unregisterFrame || !this.frameSource) return;
    const source = this.frameSource;
    this.unregisterFrame = source.registerFrameHook((delta) => this.tickFrame(delta));
  }

  private unregisterTick(): void {
    this.unregisterFrame?.();
    this.unregisterFrame = null;
  }

  private tickFrame(delta: number): void {
    let dirty = false;
    if (this.explode !== this.explodeTarget) {
      const next =
        this.explode + (this.explodeTarget - this.explode) * Math.min(1, delta * 6);
      this.explode = Math.abs(this.explodeTarget - next) < 0.001 ? this.explodeTarget : next;
      dirty = true;
    }
    const intro = this.intro;
    if (intro) {
      intro.elapsed += delta;
      let done = true;
      for (const offset of intro.offsets.values()) {
        if ((intro.elapsed - offset.delay) / intro.duration < 1) {
          done = false;
          break;
        }
      }
      if (done) this.intro = null;
      dirty = true;
    }
    if (dirty) this.reapplyAll();
  }

  /** Re-derive every settled cubelet's group transform from its base. */
  private reapplyAll(): void {
    for (const [id, slot] of this.slots) {
      // In-flight turns re-apply on their next animation frame instead.
      if (this.overridden.includes(id)) continue;
      slot.group.position.copy(slot.basePosition);
      slot.group.quaternion.copy(slot.baseQuaternion);
      this.applyVisualOffset(id, slot);
    }
  }

  /**
   * Compose derived visual offsets onto a group whose base (or rotated-base)
   * transform the caller has just copied. Explode pushes along the direction
   * of the already-rotated position — so a turning layer spreads while it
   * turns, which reads better than freezing the offset axis mid-turn — and
   * the intro lerps from its scatter pose onto that exploded target.
   * `basePosition`/`baseQuaternion` are never written here.
   */
  private applyVisualOffset(id: number, slot: Slot): void {
    const group = slot.group;
    if (this.explode !== 0) {
      this.tmpDir.copy(group.position);
      if (this.tmpDir.lengthSq() > 1e-12) {
        // Spread length, paired with SceneManager.setContentScale(1.3) which
        // the toggle also applies. Assembly geometry: a corner cubelet centre
        // sits at sqrt(3) ~= 1.732 and its rounded body adds ~0.83, so the
        // assembled silhouette already reaches the framed radius (2.62).
        // Every unit of spread therefore has to come back out of the framing:
        // 1.732 + 0.62 + 0.83 = 3.18, comfortably inside 2.62 x 1.3 = 3.41,
        // which leaves a ~0.66 gap between neighbouring cubelets - enough to
        // read as a spread lattice without clipping at the stage edge.
        group.position.addScaledVector(this.tmpDir.normalize(), this.explode * 0.62);
      }
    }
    const intro = this.intro;
    if (!intro) return;
    const offset = intro.offsets.get(id);
    if (!offset) return;
    const t = Math.min(Math.max((intro.elapsed - offset.delay) / intro.duration, 0), 1);
    if (t >= 1) return;
    const eased = 1 - Math.pow(1 - t, 3);
    this.tmpPos.copy(group.position);
    group.position.lerpVectors(offset.pos, this.tmpPos, eased);
    this.tmpQuat.copy(offset.quat).slerp(CubeRenderer.IDENTITY_QUAT, eased);
    group.quaternion.premultiply(this.tmpQuat);
  }

  private static readMatrix(rotation: readonly number[], target: THREE.Matrix4): THREE.Matrix4 {
    return target.set(
      rotation[0], rotation[1], rotation[2], 0,
      rotation[3], rotation[4], rotation[5], 0,
      rotation[6], rotation[7], rotation[8], 0,
      0, 0, 0, 1,
    );
  }

  build(cubelets: readonly CubeletVisual[]): void {
    this.clear();

    this.bodyGeometry = new RoundedBoxGeometry(BODY_SIZE, BODY_SIZE, BODY_SIZE, 4, BODY_RADIUS);
    this.stickerGeometry = new RoundedBoxGeometry(
      STICKER_SIZE,
      STICKER_SIZE,
      STICKER_THICKNESS,
      3,
      STICKER_RADIUS,
    );

    const bodyMaterial = new THREE.MeshStandardMaterial({ ...BODY_MATERIAL });
    const normal = new THREE.Vector3();
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();

    for (const cubelet of cubelets) {
      const group = new THREE.Group();
      group.name = `cubelet-${cubelet.id}`;

      const body = new THREE.Mesh(this.bodyGeometry, bodyMaterial);
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.cubeletId = cubelet.id;
      group.add(body);

      for (const [index, sticker] of cubelet.stickers.entries()) {
        const material = this.materialFor(sticker.color);
        const mesh = new THREE.Mesh(this.stickerGeometry, material);
        normal.set(sticker.normal[0], sticker.normal[1], sticker.normal[2]);
        quaternion.setFromUnitVectors(STICKER_FORWARD, normal);
        mesh.quaternion.copy(quaternion);
        mesh.position.copy(normal).multiplyScalar(STICKER_OFFSET);
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.userData.cubeletId = cubelet.id;
        mesh.userData.stickerIndex = index;
        mesh.name = `sticker-${cubelet.id}-${index}`;
        group.add(mesh);
      }

      this.object.add(group);
      this.slots.set(cubelet.id, {
        group,
        basePosition: new THREE.Vector3(),
        baseQuaternion: new THREE.Quaternion(),
      });
      this.cubeletIds.push(cubelet.id);
    }

    this.sync(cubelets, matrix);
    this.ensureTick();
  }

  /** Snap every cubelet to the exact transform implied by the logical state. */
  sync(cubelets: readonly CubeletVisual[], scratch?: THREE.Matrix4): void {
    const matrix = scratch ?? new THREE.Matrix4();
    for (const cubelet of cubelets) {
      const slot = this.slots.get(cubelet.id);
      if (!slot) continue;
      slot.basePosition.set(
        cubelet.position[0] * SPACING,
        cubelet.position[1] * SPACING,
        cubelet.position[2] * SPACING,
      );
      CubeRenderer.readMatrix(cubelet.rotation, matrix);
      slot.baseQuaternion.setFromRotationMatrix(matrix);
      slot.group.position.copy(slot.basePosition);
      slot.group.quaternion.copy(slot.baseQuaternion);
      this.applyVisualOffset(cubelet.id, slot);
    }
    this.overridden = [];
  }

  /**
   * Temporarily rotate a set of cubelets about a world axis through the cube
   * centre, for in-flight layer animation. Base transforms stay untouched, so
   * the next `sync` restores exact alignment.
   */
  setLayerRotation(axis: 'x' | 'y' | 'z', ids: readonly number[], angle: number): void {
    if (this.overridden.length > 0) this.clearLayerRotation();
    const rotation = new THREE.Quaternion().setFromAxisAngle(AXIS_VECTORS[axis], angle);
    for (const id of ids) {
      const slot = this.slots.get(id);
      if (!slot) continue;
      slot.group.position.copy(slot.basePosition).applyQuaternion(rotation);
      slot.group.quaternion.copy(rotation).multiply(slot.baseQuaternion);
      this.applyVisualOffset(id, slot);
      this.overridden.push(id);
    }
  }

  clearLayerRotation(): void {
    for (const id of this.overridden) {
      const slot = this.slots.get(id);
      if (!slot) continue;
      slot.group.position.copy(slot.basePosition);
      slot.group.quaternion.copy(slot.baseQuaternion);
      this.applyVisualOffset(id, slot);
    }
    this.overridden = [];
  }

  /** Moves the cube group by a partial layer turn, used for drag-to-turn gestures. */
  peekPosition(id: number): THREE.Vector3 | null {
    const slot = this.slots.get(id);
    return slot ? slot.group.position : null;
  }

  private materialFor(color: string): THREE.MeshPhysicalMaterial {
    const existing = this.materials.get(color);
    if (existing) return existing;
    const material = new THREE.MeshPhysicalMaterial({ ...STICKER_MATERIAL, color });
    this.materials.set(color, material);
    return material;
  }

  private clear(): void {
    this.unregisterTick();
    this.intro = null;
    for (const slot of this.slots.values()) this.object.remove(slot.group);
    this.slots.clear();
    this.cubeletIds.length = 0;
    this.overridden = [];
    this.bodyGeometry?.dispose();
    this.stickerGeometry?.dispose();
    this.bodyGeometry = null;
    this.stickerGeometry = null;
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
  }

  dispose(): void {
    this.unregisterTick();
    this.frameSource = null;
    this.intro = null;
    this.explode = 0;
    this.explodeTarget = 0;
    this.clear();
    this.object.removeFromParent();
  }
}
