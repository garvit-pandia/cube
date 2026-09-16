import { expect, test } from '@playwright/test';

import { gotoCube, scrambleOptimally, solveOptimally, waitIdle } from './support';

test.describe('solve celebration (via __cube3 seam)', () => {
  test('optimal solve ends solved with no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await gotoCube(page);
    await waitIdle(page);

    const scramble = await scrambleOptimally(page);
    expect(scramble.length).toBeGreaterThan(0);
    await waitIdle(page);

    const moves = await solveOptimally(page);
    expect(moves).not.toBeNull();

    // Catch the celebration mid-burst: the solved stamp renders on the
    // one-shot justSolved snapshot, before the phase settles to done. Wait
    // past the stamp's fade-in so both it and the burst are visible.
    await page.waitForSelector('.solved-flash', { timeout: 90_000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/opencode/cube3-design/celebration.png' });
    await waitIdle(page);
    const solved = await page.evaluate(() => {
      const controller = (
        window as unknown as { __cube3: { controller: { state: { isSolved(): boolean } } } }
      ).__cube3.controller;
      return controller.state.isSolved();
    });
    expect(solved).toBe(true);
    expect(errors).toEqual([]);
  });
});
