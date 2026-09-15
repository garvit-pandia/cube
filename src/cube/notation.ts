import type { Move, MoveFace } from './types';
import { MOVE_FACES } from './types';

const SUFFIX_BY_TURNS: Record<1 | 2 | 3, string> = { 1: '', 2: '2', 3: "'" };
const TURNS_BY_SUFFIX: Record<string, 1 | 2 | 3> = { '': 1, '2': 2, "'": 3 };

/** Render one move in Singmaster notation, e.g. `R`, `R2`, `R'`, `M`, `S2`. */
export function formatMove(move: Move): string {
  return `${move.face}${SUFFIX_BY_TURNS[move.turns]}`;
}

export function formatMoves(moves: readonly Move[]): string {
  return moves.map(formatMove).join(' ');
}

/** Parse a single token such as `R'`, `u2` or `M'`. Throws on malformed input. */
export function parseMove(token: string): Move {
  const trimmed = token.trim();
  const face = trimmed[0]?.toUpperCase();
  if (!face || !MOVE_FACES.includes(face as MoveFace)) {
    throw new Error(`Invalid move: "${token}"`);
  }
  const suffix = trimmed.slice(1);
  const turns = TURNS_BY_SUFFIX[suffix];
  if (turns === undefined) throw new Error(`Invalid move: "${token}"`);
  return { face: face as MoveFace, turns };
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

/**
 * Fold adjacent turns on the same layer: `R R` -> `R2`, `R2 R` -> `R'`, and
 * pairs that cancel (`R R'`) disappear entirely. Turns on different layers
 * keep their order. Used to shorten auto-solve sequences.
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
