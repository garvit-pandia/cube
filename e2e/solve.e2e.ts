import { expect, test } from '@playwright/test';

import {
  cancelSolve,
  enqueueMoves,
  FACE_LETTERS,
  gotoCube,
  pollFor,
  scrambleOptimally,
  scrambleRandomMoves,
  solveOptimally,
  solveReplay,
  snapshot,
  waitIdle,
} from './support';

test.describe('solve modes (via __cube3 seam)', () => {
  test('optimal solve from a scramble ends solved in at most 21 moves', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    const scramble = await scrambleOptimally(page);
    expect(scramble.length).toBeGreaterThan(0);
    await waitIdle(page);
    expect((await snapshot(page)).solved).toBe(false);

    const moves = await solveOptimally(page);
    expect(moves).not.toBeNull();
    expect(moves!.length).toBeGreaterThan(0);
    expect(moves!.length).toBeLessThanOrEqual(21);

    const done = await pollFor(page, (s) => s.phase === 'done' && !s.solving);
    expect(done.solved).toBe(true);
  });

  test('replay solve from manual random moves ends solved', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'U', turns: 1 },
      { face: 'R', turns: 3 },
      { face: 'U', turns: 3 },
      { face: 'F', turns: 2 },
      { face: 'L', turns: 3 },
    ]);
    await waitIdle(page);
    const mixed = await snapshot(page);
    expect(mixed.solved).toBe(false);
    expect(mixed.history).toHaveLength(6);

    const moves = await solveReplay(page);
    expect(moves).not.toBeNull();

    const done = await pollFor(page, (s) => s.phase === 'done' && !s.solving);
    expect(done.solved).toBe(true);
  });

  test('auto-solve never records a session entry and leaves history empty', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    await scrambleOptimally(page);
    await waitIdle(page);
    await solveOptimally(page);

    const done = await pollFor(page, (s) => s.phase === 'done' && !s.solving);
    expect(done.solved).toBe(true);
    expect(done.history).toHaveLength(0);
    expect(done.solveTotal).toBe(0);
  });

  test('cancelling mid auto-solve restores the prior phase and stays mixed', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    await scrambleOptimally(page);
    await waitIdle(page);

    await solveOptimally(page);
    await pollFor(page, (s) => s.solving && s.solveDone >= 3);
    await cancelSolve(page);

    const after = await pollFor(page, (s) => !s.solving);
    expect(after.phase).toBe('ready');
    expect(after.solved).toBe(false);
  });

  test('optimal solve falls back to replay when the solver chunk is blocked', async ({ page }) => {
    // Abort the min2phase module so loadSolver() rejects; solveOptimally must
    // fall back to the log-inversion path and still end solved.
    await page.route('**/min2phase*', (route) => route.abort());
    await gotoCube(page);
    await waitIdle(page);

    await scrambleRandomMoves(page);
    await waitIdle(page);
    const moves = await solveOptimally(page);
    expect(moves).not.toBeNull();

    const done = await pollFor(page, (s) => s.phase === 'done' && !s.solving);
    expect(done.solved).toBe(true);
  });

  test('every landed turn stays a legal Singmaster move through both solve paths', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    await scrambleOptimally(page);
    await waitIdle(page);
    await solveOptimally(page);
    const done = await pollFor(page, (s) => s.phase === 'done' && !s.solving);
    for (const move of done.history) {
      expect(FACE_LETTERS).toContain(move.face);
      expect([1, 2, 3]).toContain(move.turns);
    }
    expect(done.solved).toBe(true);
  });
});
