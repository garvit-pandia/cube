import { expect, test } from '@playwright/test';

import { enqueueMoves, gotoCube, snapshot, solveOptimally, waitIdle } from './support';

test.describe('exploded view (via __cube3 seam)', () => {
  test('toggle on, play moves, toggle off, optimal solve ends solved', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await gotoCube(page);
    await waitIdle(page);

    await page.getByRole('button', { name: 'Exploded' }).click();
    await expect(page.getByRole('button', { name: 'Exploded' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Let the explode tween run partway so turns land mid-spread.
    await page.waitForTimeout(400);

    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'U', turns: 1 },
      { face: 'F', turns: 1 },
    ]);
    await waitIdle(page);
    // Capture the spread lattice while still exploded (the definition-of-done
    // shot), then fold back before the no-drift solve.
    await page.screenshot({ path: '/tmp/opencode/cube3-design/exploded.png' });

    await page.getByRole('button', { name: 'Exploded' }).click();
    await expect(page.getByRole('button', { name: 'Exploded' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Tween back to assembled before solving.
    await page.waitForTimeout(600);

    const moves = await solveOptimally(page);
    expect(moves).not.toBeNull();
    await waitIdle(page);
    expect((await snapshot(page)).solved).toBe(true);
    expect(errors).toEqual([]);
  });
});
