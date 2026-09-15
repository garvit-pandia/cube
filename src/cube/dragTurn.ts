import { applyMatrix } from './CubeState';
import { MOVE_AXES } from './palette';
import type { AxisName, FaceLetter, Mat3, Move, MoveFace, SliceLetter, Vec3 } from './types';

/**
 * Face letter for each signed world axis. Written out to match MOVE_AXES;
 * `dragTurn.test.ts` pins the correspondence so the two cannot drift apart.
 */
const FACE_BY_AXIS: Record<AxisName, Record<1 | -1, FaceLetter>> = {
  x: { 1: 'R', [-1]: 'L' },
  y: { 1: 'U', [-1]: 'D' },
  z: { 1: 'F', [-1]: 'B' },
};

/** Middle layer of each axis, named for the face direction it follows. */
const SLICE_BY_AXIS: Record<AxisName, SliceLetter> = { x: 'M', y: 'E', z: 'S' };

/** Degenerate-drag guard; realistic drags are ~0.1+ world units. */
const EPSILON = 1e-6;

/**
 * World-space normal of a sticker: the cubie-local normal carried by the
 * cubelet's integer rotation. Pure integer math, straight from the state.
 */
export function stickerWorldNormal(rotation: Mat3, localNormal: Vec3): Vec3 {
  return applyMatrix(rotation, localNormal);
}

/**
 * Resolve a sticker drag into a layer turn, or null when the gesture does not
 * map to one.
 *
 * `faceNormal` is the sticker's world normal (a signed unit axis vector),
 * `drag` the pointer's world-space movement, and `cubeletPos` the dragged
 * cubelet's current integer position. The drag is projected onto the face
 * plane; the rotation axis is `faceNormal x drag` snapped to its dominant
 * world axis. The layer is the cubelet's coordinate along that axis: an outer
 * coordinate turns that face, zero turns the middle slice (M/E/S). The
 * direction follows the move convention: clockwise from outside is -turns
 * about the positive axis, and a slice turns the way the face it follows does.
 */
export function resolveDragTurn(faceNormal: Vec3, drag: Vec3, cubeletPos: Vec3): Move | null {
  const dot = faceNormal[0] * drag[0] + faceNormal[1] * drag[1] + faceNormal[2] * drag[2];
  const dx = drag[0] - faceNormal[0] * dot;
  const dy = drag[1] - faceNormal[1] * dot;
  const dz = drag[2] - faceNormal[2] * dot;

  // Rotation axis candidate: normal x in-plane drag.
  const cx = faceNormal[1] * dz - faceNormal[2] * dy;
  const cy = faceNormal[2] * dx - faceNormal[0] * dz;
  const cz = faceNormal[0] * dy - faceNormal[1] * dx;

  const candidates: [AxisName, number][] = [
    ['x', cx],
    ['y', cy],
    ['z', cz],
  ];
  let axis: AxisName = 'x';
  let magnitude = 0;
  for (const [name, value] of candidates) {
    if (Math.abs(value) > Math.abs(magnitude)) {
      axis = name;
      magnitude = value;
    }
  }
  if (Math.abs(magnitude) < EPSILON) return null;

  const index = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const layerCoord = cubeletPos[index];
  const face: MoveFace =
    layerCoord === 0 ? SLICE_BY_AXIS[axis] : FACE_BY_AXIS[axis][layerCoord as 1 | -1];

  // A positive magnitude is a +90 degree turn about the positive axis. The
  // engine plays a `turns` quarter turn about a face with sign `s` at visual
  // angle -turns*s*90 degrees; for a face `s` is its layer coordinate, for a
  // slice the sign of the face it follows, so one formula covers both.
  const quarters = -Math.sign(magnitude) * MOVE_AXES[face].sign;
  return { face, turns: quarters === 1 ? 1 : 3 };
}
