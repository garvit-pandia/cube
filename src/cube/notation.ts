import type { FaceLetter, Move } from './types';
import { FACE_LETTERS } from './types';

const SUFFIX_BY_TURNS: Record<1 | 2 | 3, string> = { 1: '', 2: '2', 3: "'" };
const TURNS_BY_SUFFIX: Record<string, 1 | 2 | 3> = { '': 1, '2': 2, "'": 3 };

/** Render one move in Singmaster notation, e.g. `R`, `R2`, `R'`. */
export function formatMove(move: Move): string {
  return `${move.face}${SUFFIX_BY_TURNS[move.turns]}`;
}

export function formatMoves(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

/** Parse a single token such as `R'` or `u2`. Throws on malformed input. */
export function parseMove(token: string): Move {
  const trimmed = token.trim();
  const face = trimmed[0]?.toUpperCase();
  if (!face || !FACE_LETTERS.includes(face as FaceLetter)) {
    throw new Error(`Invalid move: "${token}"`);
  }
  const suffix = trimmed.slice(1);
  const turns = TURNS_BY_SUFFIX[suffix];
  if (turns === undefined) throw new Error(`Invalid move: "${token}"`);
  return { face: face as FaceLetter, turns };
}

export function parseMoves(sequence: string): Move[] {
  return sequence
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map(parseMove);
}

/** The move that undoes `move`: `R` -> `R'`, `R2` -> `R2`. */
export function invertMove(move: Move): Move {
  return { face: move.face, turns: move.turns === 2 ? 2 : ((4 - move.turns) as 1 | 3) };
}

export function invertMoves(moves: readonly Move[]): Move[] {
  return moves.map(invertMove).reverse();
}

/** The layer axis a move turns about, plus its visual quarter count (-1, 1, or 2). */
export function visualTurn(move: Move): { quarters: 1 | 2 | -1; clockWise: 1 | -1 } {
  const quarters: 1 | 2 | -1 = move.turns === 1 ? 1 : move.turns === 2 ? 2 : -1;
  return { quarters, clockWise: -1 };
}

/**
 * Two moves on the same face collapse into one. Returns null when they cancel
 * or combine into a single move, otherwise the replacement.
 */
export function combineMoves(first: Move, second: Move): Move | null {
  if (first.face !== second.face) return null;
  const total = (first.turns + second.turns) % 4;
  if (total === 0) return null;
  return { face: first.face, turns: total as 1 | 2 | 3 };
}

/**
 * Fold adjacent turns on the same face: `R R` -> `R2`, `R2 R` -> `R'`, and
 * pairs that cancel (`R R'`) disappear entirely. Turns on different faces keep
 * their order. Used to shorten auto-solve sequences.
 */
export function simplifyMoves(moves: readonly Move[]): Move[] {
  const out: Move[] = [];
  for (const move of moves) {
    const last = out[out.length - 1];
    if (last && last.face === move.face) {
      const total = (last.turns + move.turns) % 4;
      if (total === 0) out.pop();
      else out[out.length - 1] = { face: move.face, turns: total as 1 | 2 | 3 };
    } else {
      out.push(move);
    }
  }
  return out;
}
