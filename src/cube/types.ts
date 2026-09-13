/** Core cube types. Coordinates: +x = right (R), +y = up (U), +z = toward viewer (F). */

export type Vec3 = readonly [number, number, number];

/** Row-major 3x3 integer rotation matrix. */
export type Mat3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

export type FaceLetter = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

export type AxisName = 'x' | 'y' | 'z';

/** Which of the three axes a face normal lies on, and its sign. */
export interface FaceAxis {
  readonly normal: Vec3;
  readonly axis: AxisName;
  readonly sign: 1 | -1;
}

/**
 * A turn of one face. `turns` counts clockwise quarter turns as seen from
 * outside that face, so 1 = `R`, 2 = `R2`, 3 = `R'`.
 */
export interface Move {
  readonly face: FaceLetter;
  readonly turns: 1 | 2 | 3;
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const FACE_LETTERS: readonly FaceLetter[] = ['U', 'D', 'L', 'R', 'F', 'B'];
