import * as THREE from 'three';

import { resolveDragTurn } from '../cube/dragTurn';
import type { Move, Vec3 } from '../cube/types';
import type { SceneManager } from './SceneManager';

/** What the controller tells the handler about a raycast sticker. */
export interface StickerInfo {
  /** Sticker normal in world space (a signed unit axis vector). */
  readonly normal: Vec3;
  /** The cubelet's current integer position. */
  readonly position: Vec3;
}

export interface PointerTurnOptions {
  /** State-derived sticker facts, or null when the id/index pair is stale. */
  stickerInfo(cubeletId: number, stickerIndex: number): StickerInfo | null;
  /** False while an animation or the auto-solve owns the queue. */
  canStart(): boolean;
  /** Called once per committed drag gesture. */
  onMove(move: Move): void;
}

/** World-space drag length needed to commit, roughly an eighth of a face. */
const TURN_THRESHOLD_WORLD = 0.35;
/** Screen-space floor so a zoomed-out jitter cannot commit by accident. */
const TURN_THRESHOLD_PIXELS = 24;

/**
 * Turns sticker drags into layer turns. A pointerdown on any sticker is
 * intercepted in the container's capture phase, so OrbitControls never sees
 * the gesture and no controls state is touched. The drag is projected onto the
 * sticker's face plane and resolved to a move once it passes both thresholds;
 * an outer layer is a face turn and a middle layer is an M/E/S slice turn.
 * Background drags are left alone and orbit exactly as before. Touch follows
 * the same pointer-event path.
 */
export class PointerTurnHandler {
  private readonly scene: SceneManager;
  private readonly opts: PointerTurnOptions;
  private readonly raycaster = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly planeNormal = new THREE.Vector3();
  private readonly planePoint = new THREE.Vector3();
  private readonly startWorld = new THREE.Vector3();
  private readonly currentWorld = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  private gesture: {
    readonly pointerId: number;
    readonly normal: Vec3;
    readonly position: Vec3;
    readonly startClientX: number;
    readonly startClientY: number;
  } | null = null;

  constructor(scene: SceneManager, opts: PointerTurnOptions) {
    this.scene = scene;
    this.opts = opts;
    const container = scene.container;
    container.addEventListener('pointerdown', this.onPointerDown, true);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerup', this.onGestureEnd);
    container.addEventListener('pointercancel', this.onGestureEnd);
  }

  dispose(): void {
    const container = this.scene.container;
    container.removeEventListener('pointerdown', this.onPointerDown, true);
    container.removeEventListener('pointermove', this.onPointerMove);
    container.removeEventListener('pointerup', this.onGestureEnd);
    container.removeEventListener('pointercancel', this.onGestureEnd);
    this.gesture = null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || !this.opts.canStart()) return;
    const hit = this.raycastSticker(event.clientX, event.clientY);
    if (!hit) return;
    const info = this.opts.stickerInfo(hit.cubeletId, hit.stickerIndex);
    if (!info) return;

    // Face plane just outside the sticker surface. Only the drag's direction
    // matters, so the exact offset along the normal is irrelevant.
    const [nx, ny, nz] = info.normal;
    this.planeNormal.set(nx, ny, nz);
    this.planePoint.set(nx * 1.5, ny * 1.5, nz * 1.5);
    this.plane.setFromNormalAndCoplanarPoint(this.planeNormal, this.planePoint);
    if (!this.rayToPlane(event.clientX, event.clientY, this.startWorld)) return;

    // Own the gesture. OrbitControls listens on the canvas in the bubble
    // phase; stopping propagation here in the capture phase keeps the whole
    // drag away from it, so there is nothing to re-enable or reset later.
    event.stopPropagation();
    event.preventDefault();
    this.scene.container.setPointerCapture(event.pointerId);
    this.gesture = {
      pointerId: event.pointerId,
      normal: info.normal,
      position: info.position,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (!this.rayToPlane(event.clientX, event.clientY, this.currentWorld)) return;

    const pixelDist = Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY,
    );
    if (pixelDist < TURN_THRESHOLD_PIXELS) return;

    const drag: Vec3 = [
      this.currentWorld.x - this.startWorld.x,
      this.currentWorld.y - this.startWorld.y,
      this.currentWorld.z - this.startWorld.z,
    ];
    const worldDist = Math.hypot(drag[0], drag[1], drag[2]);
    if (worldDist < TURN_THRESHOLD_WORLD) return;

    this.gesture = null;
    const move = resolveDragTurn(gesture.normal, drag, gesture.position);
    if (move) this.opts.onMove(move);
  };

  private onGestureEnd = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    this.gesture = null;
  };

  /** First sticker mesh under the pointer, or null. */
  private raycastSticker(
    clientX: number,
    clientY: number,
  ): { cubeletId: number; stickerIndex: number } | null {
    this.updateRay(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.scene.scene.children, true);
    for (const hit of hits) {
      const { cubeletId, stickerIndex } = hit.object.userData as {
        cubeletId?: number;
        stickerIndex?: number;
      };
      if (typeof cubeletId === 'number' && typeof stickerIndex === 'number') {
        return { cubeletId, stickerIndex };
      }
    }
    return null;
  }

  /** Intersect the current gesture plane; null when the ray runs parallel. */
  private rayToPlane(clientX: number, clientY: number, target: THREE.Vector3): boolean {
    this.updateRay(clientX, clientY);
    return this.raycaster.ray.intersectPlane(this.plane, target) !== null;
  }

  private updateRay(clientX: number, clientY: number): void {
    const rect = this.scene.container.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.scene.camera);
  }
}
