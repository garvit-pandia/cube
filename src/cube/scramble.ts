import type { Move } from './types';
import { FACE_LETTERS } from './types';

const AXIS_OF: Record<string, 'x' | 'y' | 'z'> = {
  U: 'y',
  D: 'y',
  R: 'x',
  L: 'x',
  F: 'z',
  B: 'z',
};

const SUFFIX_BY_TURNS: Record<1 | 2 | 3, string> = { 1: '', 2: '2', 3: "'" };

export function formatSequence(moves: readonly Move[]): string {
  return moves.map((m) => `${m.face}${SUFFIX_BY_TURNS[m.turns]}`).join(' ');
}

/**
 * Random-state-style scramble following WCA scrambler constraints: no two
 * consecutive moves may share an axis. That single rule rules out both `R R`
 * repeats and `R L` pairs, so cancellation like `R R'` is unreachable.
 */
export function generateScramble(length = 22, random: () => number = Math.random): Move[] {
  const moves: Move[] = [];
  let previousAxis: string | null = null;

  while (moves.length < length) {
    const face = FACE_LETTERS[Math.floor(random() * FACE_LETTERS.length)];
    if (AXIS_OF[face] === previousAxis) continue;
    const turns = (1 + Math.floor(random() * 3)) as 1 | 2 | 3;
    moves.push({ face, turns });
    previousAxis = AXIS_OF[face];
  }

  return moves;
}

/** True when a sequence contains two neighbouring moves on the same axis. */
export function hasRedundancy(moves: readonly Move[]): boolean {
  for (let i = 1; i < moves.length; i++) {
    if (AXIS_OF[moves[i - 1].face] === AXIS_OF[moves[i].face]) return true;
  }
  return false;
}
