import { describe, expect, it } from 'vitest';

import { CubeState } from './CubeState';
import { invertMoves, parseMoves, simplifyMoves } from './notation';
import type { Move } from './types';
import { FACE_LETTERS } from './types';
import { mulberry32 } from '../test/support';

function randomMove(rng: () => number): Move {
  const face = FACE_LETTERS[Math.floor(rng() * FACE_LETTERS.length)];
  const turns = (1 + Math.floor(rng() * 3)) as 1 | 2 | 3;
  return { face, turns };
}

function randomSequence(rng: () => number, length: number): Move[] {
  const moves: Move[] = [];
  for (let i = 0; i < length; i++) moves.push(randomMove(rng));
  return moves;
}

describe('simplifyMoves', () => {
  it('returns an empty array unchanged', () => {
    expect(simplifyMoves([])).toEqual([]);
  });

  it('does not mutate its input', () => {
    const input = parseMoves("R R' U2 F B'");
    const before = input.map((move) => ({ ...move }));
    const result = simplifyMoves(input);
    expect(result).not.toBe(input);
    expect(input).toEqual(before);
  });

  it('cancels opposite turns into nothing', () => {
    expect(simplifyMoves(parseMoves("R R'"))).toEqual([]);
    expect(simplifyMoves(parseMoves("R' R"))).toEqual([]);
    expect(simplifyMoves(parseMoves('R2 R2'))).toEqual([]);
  });

  it('combines same-face turns', () => {
    expect(simplifyMoves(parseMoves('R R'))).toEqual(parseMoves('R2'));
    expect(simplifyMoves(parseMoves('R2 R'))).toEqual(parseMoves("R'"));
    expect(simplifyMoves(parseMoves('R R2'))).toEqual(parseMoves("R'"));
    expect(simplifyMoves(parseMoves("R' R'"))).toEqual(parseMoves('R2'));
  });

  it('keeps turns on different faces in order', () => {
    expect(simplifyMoves(parseMoves('R U'))).toEqual(parseMoves('R U'));
    expect(simplifyMoves(parseMoves('R U R'))).toEqual(parseMoves('R U R'));
  });

  it('cancels a full four-turn chain', () => {
    expect(simplifyMoves(parseMoves('R R R R'))).toEqual([]);
  });

  it('never leaves two adjacent moves on the same face', () => {
    const rng = mulberry32(11);
    for (let trial = 0; trial < 200; trial++) {
      const result = simplifyMoves(randomSequence(rng, 40));
      for (let i = 1; i < result.length; i++) {
        expect(result[i].face).not.toBe(result[i - 1].face);
      }
    }
  });

  it.each([1, 2, 3, 4, 5])(
    'returns a random 120-move sequence to the start after invert + simplify (seed %i)',
    (seed) => {
      const state = new CubeState();
      const initial = state.serialize();
      const sequence = randomSequence(mulberry32(seed), 120);
      state.applyMoves(sequence);
      state.applyMoves(simplifyMoves(invertMoves(sequence)));
      expect(state.serialize()).toBe(initial);
    },
  );
});
