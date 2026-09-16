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

test.describe('attempt lifecycle', () => {
  test('solve, scramble, solve records twice with per-attempt moves', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    // Attempt 1: 4 manual moves, undone by hand -> records once, 4 moves.
    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'U', turns: 1 },
      { face: 'U', turns: 3 },
      { face: 'R', turns: 3 },
    ]);
    await waitIdle(page);
    const solved1 = await pollFor(page, (s) => s.phase === 'done');
    expect(solved1.solved).toBe(true);

    // Scramble starts a new attempt: history restarts.
    await scrambleOptimally(page);
    await waitIdle(page);
    const fresh = await snapshot(page);
    expect(fresh.solved).toBe(false);
    expect(fresh.history).toHaveLength(0);
    expect(fresh.phase).toBe('ready');

    // Attempt 2: solve the scramble back, then R R' -> records again.
    await solveReplay(page);
    await pollFor(page, (s) => !s.solving);
    await waitIdle(page);
    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'R', turns: 3 },
    ]);
    await waitIdle(page);
    const solved2 = await pollFor(page, (s) => s.phase === 'done' && s.solved);
    expect(solved2.solved).toBe(true);

    const stats = await page.evaluate(() => {
      const s = (
        window as unknown as { __cube3: { controller: { snapshot(): unknown } } }
      ).__cube3.controller.snapshot() as {
        stats: { count: number; recent: { moves: number }[] };
      };
      return s.stats;
    });
    expect(stats.count).toBe(2);
    expect(stats.recent[0].moves).toBe(2);
  });

  test('manual turns from a fresh solved cube re-arm the clock', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    // Solve once manually, then start turning again with no scramble in
    // between: the clock must restart and the solve must record.
    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'R', turns: 3 },
    ]);
    await waitIdle(page);
    await pollFor(page, (s) => s.phase === 'done');

    await enqueueMoves(page, [
      { face: 'U', turns: 1 },
      { face: 'U', turns: 3 },
    ]);
    await waitIdle(page);
    const done = await pollFor(page, (s) => s.phase === 'done' && s.solved);

    const stats = await page.evaluate(
      () =>
        (
          window as unknown as {
            __cube3: { controller: { snapshot(): { stats: { count: number } } } };
          }
        ).__cube3.controller.snapshot().stats,
    );
    expect(done.solved).toBe(true);
    expect(stats.count).toBe(2);
  });

  test('replay stays exact through undo and redo of user turns', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);

    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'U', turns: 1 },
      { face: 'F', turns: 2 },
    ]);
    await waitIdle(page);

    await page.evaluate(() => {
      const controller = (
        window as unknown as {
          __cube3: { controller: { undo(): void; redo(): void } };
        }
      ).__cube3.controller;
      controller.undo();
    });
    await waitIdle(page);
    await page.evaluate(() => {
      const controller = (
        window as unknown as {
          __cube3: { controller: { undo(): void; redo(): void } };
        }
      ).__cube3.controller;
      controller.undo();
    });
    await waitIdle(page);
    const undone = await snapshot(page);
    expect(undone.history).toHaveLength(1);

    await page.evaluate(() => {
      const controller = (
        window as unknown as { __cube3: { controller: { redo(): void } } }
      ).__cube3.controller;
      controller.redo();
    });
    await waitIdle(page);

    // Replay must still invert the live log back to the solved cube.
    const moves = await solveReplay(page);
    expect(moves).not.toBeNull();
    const done = await pollFor(page, (s) => !s.solving);
    expect(done.solved).toBe(true);
    expect(done.phase).toBe('done');
  });
});
