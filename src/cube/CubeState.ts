import { MOVE_AXES, CUBE_COLORS } from './palette';
import type { AxisName, FaceLetter, Mat3, Move, MoveFace, Vec3 } from './types';
import { FACE_LETTERS, IDENTITY, isSliceLetter } from './types';

/** One physical piece of the cube: where it started, where it is, how it is turned. */
export interface Cubie {
  readonly id: number;
  readonly home: Vec3;
  readonly position: Vec3;
  readonly rotation: Mat3;
  /** Sticker normals in the cubie's own frame, paired with the colour they show. */
  readonly stickers: readonly { readonly normal: Vec3; readonly color: string }[];
}

const AXIS_INDEX: Record<AxisName, 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** Quarter-turn rotation matrices about the positive axis, right-hand rule. */
const ROTATION_MATRICES: Record<AxisName, Record<1 | 2 | 3, Mat3>> = {
  x: {
    1: [1, 0, 0, 0, 0, -1, 0, 1, 0],
    2: [1, 0, 0, 0, -1, 0, 0, 0, -1],
    3: [1, 0, 0, 0, 0, 1, 0, -1, 0],
  },
  y: {
    1: [0, 0, 1, 0, 1, 0, -1, 0, 0],
    2: [-1, 0, 0, 0, 1, 0, 0, 0, -1],
    3: [0, 0, -1, 0, 1, 0, 1, 0, 0],
  },
  z: {
    1: [0, -1, 0, 1, 0, 0, 0, 0, 1],
    2: [-1, 0, 0, 0, -1, 0, 0, 0, 1],
    3: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  },
};

function multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out as unknown as Mat3;
}

/** Row-major 3x3 matrix times vector. Accepts any 9-number array (Mat3 or a
 * live rotation read from state), so all consumers share one implementation. */
export function applyMatrix(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * The authoritative cube. All state is integer-valued: a position vector in
 * {-1,0,1} per axis plus an integer rotation matrix, so repeated moves can
 * never accumulate floating-point drift. Rendered meshes mirror this state
 * and are never read back.
 */
export class CubeState {
  private cubies: Cubie[] = [];

  constructor() {
    this.reset();
  }

  reset(): void {
    const next: Cubie[] = [];
    let id = 0;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const home: Vec3 = [x, y, z];
          const stickers: { normal: Vec3; color: string }[] = [];
          for (const face of FACE_LETTERS) {
            const { normal, axis } = MOVE_AXES[face];
            if (home[AXIS_INDEX[axis]] === normal[AXIS_INDEX[axis]]) {
              stickers.push({ normal, color: CUBE_COLORS[face] });
            }
          }
          next.push({ id: id++, home, position: home, rotation: IDENTITY, stickers });
        }
      }
    }
    this.cubies = next;
  }

  all(): readonly Cubie[] {
    return this.cubies;
  }

  byId(id: number): Cubie | undefined {
    return this.cubies[id];
  }

  /** Cubie ids belonging to the layer that `face` turns (the middle layer for M/E/S). */
  layerIds(face: MoveFace): number[] {
    const { axis, sign } = MOVE_AXES[face];
    const index = AXIS_INDEX[axis];
    const layer = isSliceLetter(face) ? 0 : sign;
    return this.cubies.filter((c) => c.position[index] === layer).map((c) => c.id);
  }

  /**
   * Apply one layer turn. `turns` counts clockwise quarter turns seen from
   * outside the face the layer follows, so the right-hand rotation about the
   * positive axis is -turns for a positive sign and +turns for a negative one.
   */
  applyMove(move: Move): void {
    const { axis, sign } = MOVE_AXES[move.face];
    const index = AXIS_INDEX[axis];
    const layer = isSliceLetter(move.face) ? 0 : sign;
    const quarters = ((((-move.turns * sign) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    if (quarters === 0) return;
    const rotation = ROTATION_MATRICES[axis][quarters];

    this.cubies = this.cubies.map((c) =>
      c.position[index] !== layer
        ? c
        : {
            ...c,
            position: applyMatrix(rotation, c.position),
            rotation: multiply(rotation, c.rotation),
          },
    );
  }

  applyMoves(moves: readonly Move[]): void {
    for (const m of moves) this.applyMove(m);
  }

  clone(): CubeState {
    const copy = new CubeState();
    copy.cubies = this.cubies.map((c) => ({ ...c }));
    return copy;
  }

  /**
   * Solved means every face shows one uniform colour, read from logical
   * sticker placement. Deliberately not "identity rotation" — a face centre
   * may be turned about its own axis while the cube remains solved.
   */
  isSolved(): boolean {
    for (const face of FACE_LETTERS) {
      const { normal } = MOVE_AXES[face];
      let seen: string | null = null;
      for (const cubie of this.cubies) {
        for (const sticker of cubie.stickers) {
          if (!sameVec(applyMatrix(cubie.rotation, sticker.normal), normal)) continue;
          if (seen === null) seen = sticker.color;
          else if (seen !== sticker.color) return false;
        }
      }
    }
    return true;
  }

  /** How many stickers of each colour currently face outward on each face. */
  stickerHistogram(): Record<FaceLetter, number> {
    const counts = { U: 0, D: 0, L: 0, R: 0, F: 0, B: 0 } as Record<FaceLetter, number>;
    for (const cubie of this.cubies) {
      for (const sticker of cubie.stickers) {
        const world = applyMatrix(cubie.rotation, sticker.normal);
        for (const face of FACE_LETTERS) {
          if (sameVec(world, MOVE_AXES[face].normal)) counts[face]++;
        }
      }
    }
    return counts;
  }

  /** Stable fingerprint of the logical state, used for equality tests. */
  serialize(): string {
    return this.cubies.map((c) => `${c.position.join('')}|${c.rotation.join('')}`).join(';');
  }
}
