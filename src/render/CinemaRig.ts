import * as THREE from 'three';

import { CONTENT_CENTER, type SceneManager } from './SceneManager';

/**
 * Cinematic camera rig: while active it owns the camera and drives a slow
 * orbit around the content centre; on exit it hands the camera back to the
 * default framing via the same reset tween `resetView` uses.
 *
 * (the drag handler must never — AGENTS.md invariant): it stores the prior
 * value on entry and restores it verbatim on exit, and never calls
 * `controls.update()` while it owns the camera.
 */
export class CinemaRig {
  private activeFlag = false;
  private unregisterFrame: (() => void) | null = null;
  private savedEnabled = true;
  private static readonly AZIMUTH_RATE = (Math.PI * 2) / 40;
  private static readonly POLAR_PERIOD = 13;
  private static readonly DISTANCE_PERIOD = 23;
  private readonly manager: SceneManager;
  private readonly spherical = new THREE.Spherical();
  private readonly offset = new THREE.Vector3();
  private readonly elapsedBase = { value: -1 };
  private tick: ((delta: number, elapsed: number) => void) | null = null;
  private reducedMotion: () => boolean;

  constructor(manager: SceneManager, opts?: { reducedMotion?: () => boolean }) {
    this.manager = manager;
    this.reducedMotion = opts?.reducedMotion ?? (() => false);
  }

  /** Enter/exit cinema mode. Idempotent both ways. */
  setActive(active: boolean): void {
    if (this.activeFlag === active) return;
    this.activeFlag = active;
    if (active) this.enter();
    else this.exit();
  }

  get active(): boolean {
    return this.activeFlag;
  }

  private enter(): void {
    const { controls, camera } = this.manager;
    this.savedEnabled = controls.enabled;
    controls.enabled = false;
    // Capture the current orbit position as the phase origin so entry never
    // snaps: seed the spherical from the live camera offset.
    this.offset.copy(camera.position).sub(controls.target);
    this.spherical.setFromVector3(this.offset);
    // Arm the elapsed origin on the first orbit frame: the loop clock's
    // absolute elapsed is what the hook delivers, not time-since-entry.
    this.elapsedBase.value = -1;
    if (this.reducedMotion()) {
      // Reduced motion: hold a static pleasing angle, camera must not move.
      return;
    }
    this.tick = (_delta: number, elapsed: number) => this.orbit(elapsed);
    this.unregisterFrame = this.manager.registerFrameHook(this.tick);
  }

  private orbit(elapsed: number): void {
    if (this.elapsedBase.value < 0) this.elapsedBase.value = elapsed;
    const sinceEntry = elapsed - this.elapsedBase.value;
    const { controls, camera } = this.manager;
    // Azimuth advances at ~9 deg/s from the entry phase; polar breathes
    // around the entry polar; distance breathes around the framed distance.
    // Clamp polar to the controls' own limits so the cube never clips.
    const azimuth = this.spherical.theta + CinemaRig.AZIMUTH_RATE * sinceEntry;
    const polarBase = THREE.MathUtils.clamp(
      this.spherical.phi,
      controls.minPolarAngle + 0.02,
      controls.maxPolarAngle - 0.02,
    );
    const polar = THREE.MathUtils.clamp(
      polarBase + 0.12 * Math.sin((sinceEntry / CinemaRig.POLAR_PERIOD) * Math.PI * 2),
      controls.minPolarAngle,
      controls.maxPolarAngle,
    );
    const distance =
      this.manager.framedDistance *
      (0.95 + 0.1 * Math.sin((sinceEntry / CinemaRig.DISTANCE_PERIOD) * Math.PI * 2));
    const clamped = THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance);
    this.offset.setFromSphericalCoords(clamped, polar, azimuth);
    camera.position.copy(CONTENT_CENTER).add(this.offset);
    controls.target.copy(CONTENT_CENTER);
    camera.lookAt(controls.target);
    // Deliberately no controls.update(): it would fight the rig.
  }

  private exit(): void {
    if (this.tick) {
      this.unregisterFrame?.();
      this.unregisterFrame = null;
      this.tick = null;
    }
    // Same handoff pattern resetView uses: it already flushes damping
    // itself, so hand it the camera and restore controls.enabled verbatim.
    this.manager.resetView(this.reducedMotion());
    this.manager.controls.enabled = this.savedEnabled;
  }

  dispose(): void {
    if (this.activeFlag) {
      this.activeFlag = false;
      this.unregisterFrame?.();
      this.unregisterFrame = null;
      this.tick = null;
      this.manager.controls.enabled = this.savedEnabled;
    } else {
      this.unregisterFrame?.();
      this.unregisterFrame = null;
      this.tick = null;
    }
  }
}
