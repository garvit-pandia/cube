import type { FaceAxis, FaceLetter } from './types';

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
 * Each face's outward normal and the signed axis it lies on.
 *
 * A clockwise turn as seen from outside a face is a -90 degree right-hand
 * rotation about that outward normal. Verified numerically: a -90 degree
 * rotation about +y maps the front sticker (0,0,1) to (-1,0,0), i.e. U sends
 * front to left, which is the standard Singmaster convention.
 */
export const FACE_AXES: Record<FaceLetter, FaceAxis> = {
  U: { normal: [0, 1, 0], axis: 'y', sign: 1 },
  D: { normal: [0, -1, 0], axis: 'y', sign: -1 },
  R: { normal: [1, 0, 0], axis: 'x', sign: 1 },
  L: { normal: [-1, 0, 0], axis: 'x', sign: -1 },
  F: { normal: [0, 0, 1], axis: 'z', sign: 1 },
  B: { normal: [0, 0, -1], axis: 'z', sign: -1 },
};

/** Human-readable face names, used for accessible labels. */
export const FACE_NAMES: Record<FaceLetter, string> = {
  U: 'Up',
  D: 'Down',
  L: 'Left',
  R: 'Right',
  F: 'Front',
  B: 'Back',
};

export const COLOR_NAMES: Record<FaceLetter, string> = {
  U: 'white',
  D: 'yellow',
  F: 'green',
  B: 'blue',
  R: 'red',
  L: 'orange',
};
