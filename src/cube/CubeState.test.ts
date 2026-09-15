import { describe, expect, it } from 'vitest';

import { CubeState } from './CubeState';
import { invertMoves, parseMoves } from './notation';
import type { Move, MoveFace } from './types';
import { FACE_LETTERS, IDENTITY, MOVE_FACES, SLICE_LETTERS } from './types';
import { mulberry32 } from '../test/support';

function apply(state: CubeState, sequence: string): void {
  state.applyMoves(parseMoves(sequence));
}

function play(sequence: string): CubeState {
  const state = new CubeState();
  apply(state, sequence);
  return state;
}

const SUFFIXES = ['', "'", '2'] as const;

function randomMove(rng: () => number): Move {
  const face = MOVE_FACES[Math.floor(rng() * MOVE_FACES.length)];
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)];
  return { face, turns: suffix === '' ? 1 : suffix === '2' ? 2 : 3 };
}

function randomSequence(rng: () => number, length: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < length; i++) moves.push(randomMove(rng));
  return moves;
}

/** Every colour must face outward exactly nine times, and every face must show nine stickers. */
function expectLegalCube(state: CubeState): void {
  const histogram = state.stickerHistogram();
  for (const face of FACE_LETTERS) expect(histogram[face]).toBe(9);
}

/** Positions stay in {-1,0,1}; rotations stay proper signed permutation matrices. */
function expectIntegralRigidBody(state: CubeState): void {
  for (const cubie of state.all()) {
    for (const component of cubie.position) {
      expect(Number.isInteger(component)).toBe(true);
      expect(Math.abs(component)).toBeLessThanOrEqual(1);
    }
    const m = cubie.rotation;
    for (const value of m) expect(Number.isInteger(value)).toBe(true);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) dot += m[row * 3 + k] * m[col * 3 + k];
        expect(dot).toBe(row === col ? 1 : 0);
      }
    }
    const det =
      m[0] * (m[4] * m[8] - m[5] * m[7]) -
      m[1] * (m[3] * m[8] - m[5] * m[6]) +
      m[2] * (m[3] * m[7] - m[4] * m[6]);
    expect(det).toBe(1);
  }
}

const PRISTINE = new CubeState().serialize();

describe('cube construction', () => {
  it('builds 27 cubelets with 54 outward stickers in the solved state', () => {
    const state = new CubeState();
    expect(state.all()).toHaveLength(27);
    const total = state.all().reduce((sum, cubie) => sum + cubie.stickers.length, 0);
    expect(total).toBe(54);
    expect(state.isSolved()).toBe(true);
    expectLegalCube(state);
  });
});

describe('documented sequence tests', () => {
  it.each(MOVE_FACES)('returns to solved after four clockwise %s turns', (face) => {
    expect(play(`${face} ${face} ${face} ${face}`).isSolved()).toBe(true);
  });

  it.each(MOVE_FACES)('returns to solved after two %s2 double turns', (face) => {
    expect(play(`${face}2 ${face}2`).isSolved()).toBe(true);
  });

  it.each(MOVE_FACES)('returns to solved after %s followed by its inverse', (face) => {
    expect(play(`${face} ${face}'`).isSolved()).toBe(true);
  });

  it.each(MOVE_FACES)('returns to solved after %s %s %s2', (face) => {
    expect(play(`${face} ${face} ${face}2`).isSolved()).toBe(true);
  });

  it.each(MOVE_FACES)('treats three clockwise %s turns as one inverse turn', (face) => {
    expect(play(`${face} ${face} ${face}`).serialize()).toBe(play(`${face}'`).serialize());
  });

  it("solves R U F D L B followed by B' L' D' F' U' R'", () => {
    expect(play("R U F D L B B' L' D' F' U' R'").isSolved()).toBe(true);
  });

  it('leaves the cube mixed after a single quarter turn of any layer', () => {
    for (const face of MOVE_FACES) expect(play(face).isSolved()).toBe(false);
  });

  it('leaves the cube mixed after R U', () => {
    expect(play('R U').isSolved()).toBe(false);
  });

  it('leaves the cube mixed after a full scramble', () => {
    expect(play("R U R' U' F2 D L2 B").isSolved()).toBe(false);
  });
});

describe('inverse sequences', () => {
  it('restores the exact pristine state for random sequences', () => {
    const rng = mulberry32(20240913);
    let meaningfullyTested = 0;
    for (let trial = 0; trial < 300; trial++) {
      const sequence = randomSequence(rng, 8 + Math.floor(rng() * 24));
      const state = new CubeState();
      state.applyMoves(sequence);
      if (state.serialize() === PRISTINE) continue;
      meaningfullyTested++;
      state.applyMoves(invertMoves(sequence));
      expect(state.serialize()).toBe(PRISTINE);
      expect(state.isSolved()).toBe(true);
    }
    expect(meaningfullyTested).toBeGreaterThan(295);
  });

  it('restores the exact scrambled state for long random sequences', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 20; trial++) {
      const sequence = randomSequence(rng, 200);
      const state = new CubeState();
      state.applyMoves(sequence);
      const scrambled = state.serialize();
      state.applyMoves(invertMoves(sequence));
      expect(state.serialize()).toBe(PRISTINE);
      state.applyMoves(sequence);
      expect(state.serialize()).toBe(scrambled);
    }
  });

  it('scrambles to a state distinct from another instance before inversion', () => {
    const rng = mulberry32(99);
    const scramble = randomSequence(rng, 25);
    const scrambledCube = new CubeState();
    const untouched = new CubeState();
    scrambledCube.applyMoves(scramble);
    expect(scrambledCube.serialize()).not.toBe(untouched.serialize());
    scrambledCube.applyMoves(invertMoves(scramble));
    expect(scrambledCube.serialize()).toBe(untouched.serialize());
  });
});

describe('long-session invariants', () => {
  it('stays a legal, drift-free cube across 5000 random turns', () => {
    const rng = mulberry32(4242);
    const state = new CubeState();
    for (let i = 0; i < 5000; i++) {
      state.applyMove(randomMove(rng));
      if (i % 500 === 0) {
        expectLegalCube(state);
        expectIntegralRigidBody(state);
      }
    }
    expectLegalCube(state);
    expectIntegralRigidBody(state);
  });

  it('never reports solved for a randomly scrambled cube', () => {
    const rng = mulberry32(555);
    for (let trial = 0; trial < 200; trial++) {
      const state = new CubeState();
      state.applyMoves(randomSequence(rng, 20));
      expect(state.isSolved()).toBe(false);
    }
  });

  it('agrees with an independent colour-uniformity check on every face', () => {
    const rng = mulberry32(8675309);
    for (let trial = 0; trial < 50; trial++) {
      const state = new CubeState();
      state.applyMoves(randomSequence(rng, 1 + (trial % 30)));
      expect(state.isSolved()).toBe(independentSolvedCheck(state));
    }
  });
});

/**
 * Recomputes solved-ness from the raw sticker data with a different code path
 * than CubeState.isSolved, so the two can disagree only if one is wrong.
 */
function independentSolvedCheck(state: CubeState): boolean {
  const faces: Record<string, string[]> = {};
  for (const cubie of state.all()) {
    for (const sticker of cubie.stickers) {
      const n = sticker.normal;
      const m = cubie.rotation;
      const wx = m[0] * n[0] + m[1] * n[1] + m[2] * n[2];
      const wy = m[3] * n[0] + m[4] * n[1] + m[5] * n[2];
      const wz = m[6] * n[0] + m[7] * n[1] + m[8] * n[2];
      const key = `${wx},${wy},${wz}`;
      (faces[key] ??= []).push(sticker.color);
    }
  }
  const keys = Object.keys(faces);
  if (keys.length !== 6) return false;
  return keys.every((key) => new Set(faces[key]).size === 1 && faces[key].length === 9);
}

describe('layer selection', () => {
  it('selects exactly nine distinct cubelets per face', () => {
    const state = new CubeState();
    for (const face of FACE_LETTERS) {
      const ids = state.layerIds(face);
      expect(ids).toHaveLength(9);
      expect(new Set(ids).size).toBe(9);
    }
  });

  it('selects exactly nine distinct middle cubelets per slice', () => {
    const state = new CubeState();
    for (const slice of SLICE_LETTERS) {
      const ids = state.layerIds(slice);
      expect(ids).toHaveLength(9);
      expect(new Set(ids).size).toBe(9);
    }
  });

  it('selects the same nine cubelets per layer after the cube is turned', () => {
    const state = play('R U F');
    for (const face of MOVE_FACES) {
      expect(state.layerIds(face)).toHaveLength(9);
    }
  });

  it('selects only coordinate-zero cubelets for a slice', () => {
    const state = play('M E S');
    const cases: [MoveFace, 0 | 1 | 2][] = [
      ['M', 0],
      ['E', 1],
      ['S', 2],
    ];
    for (const [slice, index] of cases) {
      for (const id of state.layerIds(slice)) {
        expect(state.byId(id)!.position[index]).toBe(0);
      }
    }
  });

  it('keeps the core cubelet out of every face layer', () => {
    const state = new CubeState();
    const core = state.all().find((c) => c.home.every((v) => v === 0));
    expect(core).toBeDefined();
    for (const face of FACE_LETTERS) expect(state.layerIds(face)).not.toContain(core!.id);
    // The core sits at the centre of all three slices. It has no stickers, so
    // turning it is invisible, but it is physically part of those layers.
    for (const slice of SLICE_LETTERS) expect(state.layerIds(slice)).toContain(core!.id);
  });
});

describe('move conventions', () => {
  const cases: [string, [number, number, number], [number, number, number]][] = [
    ['R', [1, 0, 1], [1, 1, 0]],
    ['U', [0, 1, 1], [-1, 1, 0]],
    ['F', [0, 1, 1], [1, 0, 1]],
    ['D', [0, -1, 1], [1, -1, 0]],
    ['L', [-1, 1, 1], [-1, -1, 1]],
    ['B', [0, 1, -1], [-1, 0, -1]],
    // Slices turn the middle layer the way the face they follow turns its own.
    ['M', [0, 1, 0], [0, 0, 1]],
    ['M', [0, 1, 1], [0, -1, 1]],
    ['E', [0, 0, 1], [1, 0, 0]],
    ['S', [0, 1, 0], [1, 0, 0]],
  ];

  it.each(cases)('sends the %s layer where Singmaster says it goes', (face, from, to) => {
    const state = new CubeState();
    const cubie = state.all().find((c) => c.home.every((v, i) => v === from[i]));
    expect(cubie).toBeDefined();
    apply(state, face);
    expect(state.byId(cubie!.id)!.position).toEqual(to);
  });

  it('turns only the middle layer, leaving outer cubelets untouched', () => {
    const cases: [MoveFace, 0 | 1 | 2][] = [
      ['M', 0],
      ['E', 1],
      ['S', 2],
    ];
    for (const [slice, index] of cases) {
      const state = play(slice);
      for (const cubie of state.all()) {
        if (cubie.home[index] === 0) continue;
        expect(cubie.position).toEqual(cubie.home);
        expect(cubie.rotation).toEqual(IDENTITY);
      }
    }
  });

  it('moves every layer away from the pristine state for each turn variant', () => {
    for (const face of MOVE_FACES) {
      expect(play(face).serialize()).not.toBe(PRISTINE);
      expect(play(`${face}'`).serialize()).not.toBe(PRISTINE);
      expect(play(`${face}2`).serialize()).not.toBe(PRISTINE);
    }
  });

  it('treats a prime turn as the opposite quarter turn', () => {
    for (const face of MOVE_FACES) {
      expect(play(`${face} ${face}'`).serialize()).toBe(PRISTINE);
      expect(play(`${face}2 ${face}2`).serialize()).toBe(PRISTINE);
      expect(play(`${face} ${face}2`).serialize()).toBe(play(`${face}'`).serialize());
    }
  });
});
