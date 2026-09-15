import type { FaceLetter, MoveAxis, MoveFace } from './types';

/**
 * Standard Western colour scheme (WCA-recognised orientation):
 * white up, yellow down, green front, blue back, red right, orange left.
 */
export const CUBE_COLORS: Record<FaceLetter, string> = {
  U: '#f7f7f8',
  D: '#ffd400',
  F: '#00ab4e',
  B: '#0055bf',
  R: '#e01515',
  L: '#ff7300',
};

/**
 * The layer each move turns.
 *
 * For the six faces, `normal` is the outward face normal and `sign` the
 * coordinate of that face along its axis. A clockwise turn as seen from
 * outside a face is a -90 degree right-hand rotation about that outward
 * normal. Verified numerically: a -90 degree rotation about +y maps the front
 * sticker (0,0,1) to (-1,0,0), i.e. U sends front to left, which is the
 * standard Singmaster convention.
 *
 * M/E/S are the middle layers, named for the face whose direction they follow
 * (M follows L, E follows D, S follows F). Their `normal` is that face's and
 * `sign` carries the direction, so the rotation formula above stays the same
 * while the turned layer is the coordinate-0 one.
 */
export const MOVE_AXES: Record<MoveFace, MoveAxis> = {
  U: { normal: [0, 1, 0], axis: 'y', sign: 1 },
  D: { normal: [0, -1, 0], axis: 'y', sign: -1 },
  R: { normal: [1, 0, 0], axis: 'x', sign: 1 },
  L: { normal: [-1, 0, 0], axis: 'x', sign: -1 },
  F: { normal: [0, 0, 1], axis: 'z', sign: 1 },
  B: { normal: [0, 0, -1], axis: 'z', sign: -1 },
  M: { normal: [-1, 0, 0], axis: 'x', sign: -1 },
  E: { normal: [0, -1, 0], axis: 'y', sign: -1 },
  S: { normal: [0, 0, 1], axis: 'z', sign: 1 },
};

/** Human-readable layer names, used for accessible labels. */
export const FACE_NAMES: Record<MoveFace, string> = {
  U: 'Up',
  D: 'Down',
  L: 'Left',
  R: 'Right',
  F: 'Front',
  B: 'Back',
  M: 'Middle',
  E: 'Equator',
  S: 'Standing',
};

export const COLOR_NAMES: Record<FaceLetter, string> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};
