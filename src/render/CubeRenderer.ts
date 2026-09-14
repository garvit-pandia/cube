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
      this.overridden.push(id);
    }
  }

  clearLayerRotation(): void {
    for (const id of this.overridden) {
      const slot = this.slots.get(id);
      if (!slot) continue;
      slot.group.position.copy(slot.basePosition);
      slot.group.quaternion.copy(slot.baseQuaternion);
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
    this.clear();
    this.object.removeFromParent();
  }
}
