export { CUBE_COLORS, MOVE_AXES, FACE_NAMES, COLOR_NAMES } from '../cube/palette';

/** Very dark near-black plastic for the cubelet bodies. */
export const BODY_COLOR = '#131316';

/** Cubelet pitch — centre-to-centre distance between adjacent cubelets. */
export const SPACING = 1;

export const BODY_SIZE = 0.955;
export const BODY_RADIUS = 0.085;

export const STICKER_SIZE = 0.78;
export const STICKER_THICKNESS = 0.035;
export const STICKER_RADIUS = 0.055;

/** Distance from cubelet centre to the sticker's mid-plane. */
export const STICKER_OFFSET =
  BODY_SIZE / 2 - STICKER_THICKNESS / 2 + 0.017;

export const BODY_MATERIAL = {
  color: BODY_COLOR,
  roughness: 0.55,
  metalness: 0,
} as const;

export const STICKER_MATERIAL = {
  roughness: 0.24,
  metalness: 0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.08,
  envMapIntensity: 1.15,
} as const;
