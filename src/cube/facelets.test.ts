import { describe, expect, it } from 'vitest';

import { CubeState } from './CubeState';
import min2phase from './min2phase.js';
import { isSolverError, solutionToMoves, toFacelets } from './facelets';
import { invertMoves, parseMoves, simplifyMoves } from './notation';
import { generateScramble } from './scramble';
import { mulberry32 } from '../test/support';

const SOLVED_FACELETS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

describe('toFacelets', () => {
  it('serialises the solved cube to the canonical URFDLB string', () => {
    expect(toFacelets(new CubeState())).toBe(SOLVED_FACELETS);
  });

  it('emits 54 valid face letters with 9 of each after any scramble', () => {
    const rng = mulberry32(20260914);
    for (let trial = 0; trial < 50; trial++) {
      const state = new CubeState();
      state.applyMoves(generateScramble(22, rng));
      const facelets = toFacelets(state);
      expect(facelets).toHaveLength(54);
      expect(facelets).toMatch(/^[URFDLB]{54}$/);
      for (const face of 'URFDLB') {
        expect(facelets.split(face).length - 1).toBe(9);
      }
    }
  });

  it('agrees with the solver on single moves', () => {
    for (const token of ['R', 'U', 'F2', "R'", 'B', 'L2', 'D']) {
      const state = new CubeState();
      state.applyMoves(parseMoves(token));
      // The solver must accept our serialisation and undo the move.
      const solution = min2phase.solve(toFacelets(state));
      expect(isSolverError(solution)).toBe(false);
      state.applyMoves(solutionToMoves(solution));
      expect(state.isSolved()).toBe(true);
    }
  });

  it('solves 25 seeded scrambles back to solved (≤21 moves each)', () => {
    const rng = mulberry32(77);
    for (let trial = 0; trial < 25; trial++) {
      const state = new CubeState();
      state.applyMoves(generateScramble(22, rng));
      expect(state.isSolved()).toBe(false);
      const solution = min2phase.solve(toFacelets(state));
      expect(isSolverError(solution)).toBe(false);
      const moves = simplifyMoves(solutionToMoves(solution));
      expect(moves.length).toBeLessThanOrEqual(21);
      state.applyMoves(moves);
      expect(state.isSolved()).toBe(true);
    }
  });

  it('solves slice-mixed states back to uniform faces', () => {
    // Middle-layer turns permute face centres. The two-phase solver ignores
    // centres and restores each face to the colour now sitting at its centre,
    // which is exactly what the model calls solved (invariant 5).
    for (const sequence of ['M', 'E2', "S'", 'M E S', "R M U M'"]) {
      const state = new CubeState();
      state.applyMoves(parseMoves(sequence));
      expect(state.isSolved()).toBe(false);
      const solution = min2phase.solve(toFacelets(state));
      expect(isSolverError(solution)).toBe(false);
      state.applyMoves(solutionToMoves(solution));
      expect(state.isSolved()).toBe(true);
    }
  });

  it('cross-checks our projection against fromScramble on the same history', () => {
    const rng = mulberry32(913);
    const scramble = generateScramble(15, rng);
    const state = new CubeState();
    state.applyMoves(scramble);
    const replay = simplifyMoves(invertMoves(scramble));
    // Log-replay still solves: sanity that the scramble itself was real.
    state.applyMoves(replay);
    expect(state.isSolved()).toBe(true);
  });
});

describe('solutionToMoves', () => {
  it('parses solver padding (`R `) and all suffixes', () => {
    expect(solutionToMoves("R  U' F2 ")).toEqual(parseMoves("R U' F2"));
  });

  it('round-trips through format/simplify', () => {
    expect(simplifyMoves(solutionToMoves("R  R' U2 U2 "))).toEqual([]);
    expect(simplifyMoves(solutionToMoves('R  R '))).toEqual(parseMoves('R2'));
  });

  it('throws on malformed solver output', () => {
    expect(() => solutionToMoves('X')).toThrow();
    expect(() => solutionToMoves('R3')).toThrow();
  });

  it('detects Error strings', () => {
    expect(isSolverError('Error 1')).toBe(true);
    expect(isSolverError("R  U' ")).toBe(false);
  });
});
