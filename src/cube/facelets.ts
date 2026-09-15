import { applyMatrix } from './CubeState';
import { CUBE_COLORS, MOVE_AXES } from './palette';
import type { FaceLetter, Move, Vec3 } from './types';
import { FACE_LETTERS } from './types';

/** Reverse lookup: hex colour -> face letter whose home stickers carry it. */
const FACE_BY_COLOR: Record<string, FaceLetter> = Object.fromEntries(
  FACE_LETTERS.map((face) => [CUBE_COLORS[face], face]),
) as Record<string, FaceLetter>;

/** min2phase facelet offsets: U0 R9 F18 D27 L36 B45. */
const OFFSET: Record<FaceLetter, number> = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };

/**
 * Which sticker of `face` (index 0-8 in min2phase URFDLB order) a cubie at
 * integer position shows, or -1 when the cubie has no sticker on that face.
 *
 * Row/column conventions follow the cubejs facelet diagram
 * (https://github.com/ldez/cubejs#cubefromstringstr): rows run top to bottom
 * as seen from outside the face, columns left to right.
 */
function stickerIndex(face: FaceLetter, position: Vec3): number {
  const [x, y, z] = position;
  switch (face) {
    case 'U': // y=+1, row = z+1 (B row first), col = x+1
      return y === 1 ? (z + 1) * 3 + (x + 1) : -1;
    case 'D': // y=-1, row = 1-z (F row first), col = x+1
      return y === -1 ? (1 - z) * 3 + (x + 1) : -1;
    case 'F': // z=+1, row = 1-y, col = x+1
      return z === 1 ? (1 - y) * 3 + (x + 1) : -1;
    case 'B': // z=-1, row = 1-y, col = 1-x (R side first)
      return z === -1 ? (1 - y) * 3 + (1 - x) : -1;
    case 'R': // x=+1, row = 1-y, col = 1-z (F side first)
      return x === 1 ? (1 - y) * 3 + (1 - z) : -1;
    case 'L': // x=-1, row = 1-y, col = z+1 (B side first)
      return x === -1 ? (1 - y) * 3 + (z + 1) : -1;
  }
}

export interface FaceletSource {
  readonly all: () => readonly {
    readonly position: Vec3;
    readonly rotation: readonly number[];
    readonly stickers: readonly { readonly normal: Vec3; readonly color: string }[];
  }[];
}

/**
 * Serialise logical cube state to a 54-char min2phase facelet string in
 * URFDLB order. Pure projection of the integer state — the same code path as
 * `CubeState.isSolved`, so it cannot disagree with the model.
 */
export function toFacelets(source: FaceletSource): string {
  const out = new Array<string>(54);
  for (const cubie of source.all()) {
    for (const sticker of cubie.stickers) {
      const world = applyMatrix(cubie.rotation, sticker.normal);
      for (const face of FACE_LETTERS) {
        if (stickerIndex(face, cubie.position) === -1) continue;
        const { normal } = MOVE_AXES[face];
        if (world[0] !== normal[0] || world[1] !== normal[1] || world[2] !== normal[2]) continue;
        out[OFFSET[face] + stickerIndex(face, cubie.position)] = FACE_BY_COLOR[sticker.color];
      }
    }
  }
  return out.join('');
}

/** Face of the home outward normal a sticker colour belongs to. */
export function faceOfColor(color: string): FaceLetter {
  return FACE_BY_COLOR[color];
}

/** True when the solver refused the input (`"Error N"` strings). */
export function isSolverError(output: string): boolean {
  return output.startsWith('Error');
}

/**
 * Convert a min2phase solution string (`"R U R' ..."`, single spaces, `X `
 * quarter padding) into Moves. Throws on malformed programmer input, like
 * `parseMove`.
 */
export function solutionToMoves(solution: string): Move[] {
  const moves: Move[] = [];
  for (const token of solution.split(/\s+/)) {
    if (token.length === 0) continue;
    const face = token[0] as FaceLetter;
    if (!FACE_LETTERS.includes(face)) throw new Error(`Invalid solution move: "${token}"`);
    const suffix = token.slice(1);
    const turns = suffix === '' ? 1 : suffix === '2' ? 2 : suffix === "'" ? 3 : undefined;
    if (turns === undefined) throw new Error(`Invalid solution move: "${token}"`);
    moves.push({ face, turns });
  }
  return moves;
}
