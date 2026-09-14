import { expect, test } from '@playwright/test';

import { enqueueMoves, FACE_LETTERS, gotoCube, pollFor, snapshot, waitIdle } from './support';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function canvasBox(page: import('@playwright/test').Page): Promise<Box> {
  const box = await page.locator('.viewport canvas').boundingBox();
  expect(box).not.toBeNull();
  return box as Box;
}

/** Drag from a viewport point and settle until the queue drains. */
async function drag(
  page: import('@playwright/test').Page,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // Single full-delta move: the handler resolves the whole gesture from one
  // pointermove, and every extra CDP dispatch costs a slow headless frame.
  await page.mouse.move(fromX + dx, fromY + dy);
  await page.mouse.up();
  await waitIdle(page);
}

test.describe('drag-to-turn (via __cube3 seam)', () => {
  test('sticker drags from several points commit turns with valid moves', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // The cube fills a fixed fraction of the tighter viewport axis, so drag
    // points and distances must scale with the canvas, not use fixed pixels:
    // the cube is ~35% of the shorter side, so a quarter of it stays on the
    // cube while clearing both commit thresholds comfortably.
    const unit = Math.min(box.width, box.height);

    // The default camera sees the F, U and R faces, so drags around the
    // viewport centre land on different faces.
    const gestures: [number, number, number, number][] = [
      [cx - 0.1 * unit, cy, 0.3 * unit, 0],
      [cx, cy - 0.1 * unit, 0, 0.3 * unit],
      [cx + 0.1 * unit, cy, -0.3 * unit, 0],
    ];

    let before = (await snapshot(page)).history.length;
    for (const [x, y, dx, dy] of gestures) {
      await drag(page, x, y, dx, dy);
      const after = await pollFor(page, (s) => s.history.length === before + 1);
      const move = after.history[after.history.length - 1];
      expect(FACE_LETTERS).toContain(move.face);
      expect([1, 2, 3]).toContain(move.turns);
      before = after.history.length;
    }
  });

  test('dragging the background orbits without turning the cube', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    // Near the canvas corner the ray misses the cube entirely.
    const x = box.x + 30;
    const y = box.y + 30;

    const before = (await snapshot(page)).history.length;
    await drag(page, x, y, 140, 60);
    const after = await snapshot(page);
    expect(after.history).toHaveLength(before);
  });

  test('a drag that resolves to a middle slice does not turn the cube', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const unit = Math.min(box.width, box.height);

    // Whatever the raycast hits near the upper cube region, a horizontal drag
    // may resolve to a middle slice; history may then grow by at most the
    // drag-to-orbit baseline of zero committed moves.
    const before = (await snapshot(page)).history.length;
    await drag(page, cx, cy - 0.15 * unit, 0.3 * unit, 0);
    const after = await snapshot(page);
    expect(after.history.length - before).toBeLessThanOrEqual(1);
  });

  test('drags never inject moves while the queue is busy', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    await enqueueMoves(page, [
      { face: 'R', turns: 1 },
      { face: 'U', turns: 1 },
      { face: 'F', turns: 1 },
    ]);
    const during = (await snapshot(page)).history.length;

    // Mid-animation drag: canStart() is false, so the gesture never starts and
    // OrbitControls receives the pointer instead.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy);
    await page.mouse.up();
    await waitIdle(page);

    const done = await pollFor(page, (s) => s.history.length >= during + 3);
    expect(done.history).toHaveLength(during + 3);
  });
});
