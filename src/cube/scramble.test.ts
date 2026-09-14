import { describe, expect, it } from 'vitest';

import { formatSequence, generateScramble, hasRedundancy } from './scramble';
import { parseMoves } from './notation';
import { FACE_LETTERS } from './types';
import { mulberry32 } from '../test/support';

describe('scramble generator', () => {
  it('generates the requested number of moves', () => {
    const rng = mulberry32(1);
    for (const length of [1, 20, 22, 25]) {
      expect(generateScramble(length, rng)).toHaveLength(length);
    }
  });

  it('never places two consecutive moves on the same axis', () => {
    const rng = mulberry32(2);
    for (let trial = 0; trial < 500; trial++) {
      expect(hasRedundancy(generateScramble(22, rng))).toBe(false);
    }
  });

  it('never repeats a face back to back', () => {
    const rng = mulberry32(3);
    for (let trial = 0; trial < 500; trial++) {
      const moves = generateScramble(22, rng);
      for (let i = 1; i < moves.length; i++) {
        expect(moves[i].face).not.toBe(moves[i - 1].face);
      }
    }
  });

  it('never emits a pointless cancellation pair', () => {
    const rng = mulberry32(4);
    for (let trial = 0; trial < 500; trial++) {
      const text = formatSequence(generateScramble(22, rng));
      expect(text).not.toMatch(/(\b[UDLRFB])2? \1('|2)\b/);
    }
  });

  it('uses every face across a long run', () => {
    const rng = mulberry32(5);
    const seen = new Set<string>();
    for (let trial = 0; trial < 200; trial++) {
      for (const move of generateScramble(22, rng)) seen.add(move.face);
    }
    expect([...seen].sort()).toEqual([...FACE_LETTERS].sort());
  });

  it('uses quarter, half and inverse turns', () => {
    const rng = mulberry32(6);
    const seen = new Set<number>();
    for (let trial = 0; trial < 300; trial++) {
      for (const move of generateScramble(22, rng)) seen.add(move.turns);
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('is reproducible for a fixed seed', () => {
    const a = formatSequence(generateScramble(22, mulberry32(1234)));
    const b = formatSequence(generateScramble(22, mulberry32(1234)));
    expect(a).toBe(b);
    const c = formatSequence(generateScramble(22, mulberry32(1235)));
    expect(c).not.toBe(a);
  });

  it('is actually a scramble, not a no-op', () => {
    const rng = mulberry32(7);
    const moves = generateScramble(22, rng);
    expect(moves.length).toBeGreaterThanOrEqual(20);
    expect(moves.length).toBeLessThanOrEqual(25);
    expect(hasRedundancy(moves)).toBe(false);
  });
});

describe('scramble formatting', () => {
  it('round-trips through the parser', () => {
    const rng = mulberry32(9);
    const moves = generateScramble(22, rng);
    expect(parseMoves(formatSequence(moves))).toEqual(moves);
  });

  it('renders an empty sequence as an empty string', () => {
    expect(formatSequence([])).toBe('');
  });
});
