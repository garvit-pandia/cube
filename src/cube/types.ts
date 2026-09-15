/** Core cube types. Coordinates: +x = right (R), +y = up (U), +z = toward viewer (F). */

export type Vec3 = readonly [number, number, number];

/** Row-major 3x3 integer rotation matrix. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type FaceLetter = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

/**
 * Middle-slice letters. `M` turns the layer between L and R in the direction
 * of `L`; `E` the layer between U and D in the direction of `D`; `S` the layer
 * between F and B in the direction of `F`.
 */
export type SliceLetter = 'M' | 'E' | 'S';

/** Every layer a move can name: the six outer faces plus the three slices. */
export type MoveFace = FaceLetter | SliceLetter;

export type AxisName = 'x' | 'y' | 'z';

/** Which of the three axes a move's layer lies on, and its direction sign. */
export interface MoveAxis {
  readonly normal: Vec3;
  readonly axis: AxisName;
  readonly sign: 1 | -1;
}

/**
 * A turn of one layer. `turns` counts clockwise quarter turns as seen from
 * outside the face the layer follows, so 1 = `R`, 2 = `R2`, 3 = `R'`; slice
 * turns read 1 = `M`, 2 = `M2`, 3 = `M'`.
 */
export interface Move {
  readonly face: MoveFace;
  readonly turns: 1 | 2 | 3;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const FACE_LETTERS: readonly FaceLetter[] = ['U', 'D', 'L', 'R', 'F', 'B'];

export const SLICE_LETTERS: readonly SliceLetter[] = ['M', 'E', 'S'];

export const MOVE_FACES: readonly MoveFace[] = [...FACE_LETTERS, ...SLICE_LETTERS];

/** True for the three middle-slice letters. */
export function isSliceLetter(face: MoveFace): face is SliceLetter {
  return face === 'M' || face === 'E' || face === 'S';
}
