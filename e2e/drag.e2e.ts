import { expect, test } from '@playwright/test';

import {
  enqueueMoves,
  gotoCube,
  MOVE_FACES,
  pollFor,
  snapshot,
  stickerScreenPoint,
  waitIdle,
} from './support';

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
      expect(MOVE_FACES).toContain(move.face);
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

  test('dragging a face centre sideways turns the equator slice', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const unit = Math.min(box.width, box.height);

    // The F centre cubelet sits in the y = 0 slice, so a sideways drag across
    // it must resolve to an E turn (either direction) and be recorded.
    const centre = await stickerScreenPoint(page, [0, 0, 1]);
    const before = (await snapshot(page)).history.length;
    await drag(page, centre.x, centre.y, 0.3 * unit, 0);
    const after = await pollFor(page, (s) => s.history.length === before + 1);
    expect(after.history[after.history.length - 1].face).toBe('E');
  });

  test('dragging a face centre vertically turns the middle slice', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const unit = Math.min(box.width, box.height);

    const centre = await stickerScreenPoint(page, [0, 0, 1]);
    const before = (await snapshot(page)).history.length;
    await drag(page, centre.x, centre.y, 0, -0.3 * unit);
    const after = await pollFor(page, (s) => s.history.length === before + 1);
    expect(after.history[after.history.length - 1].face).toBe('M');
  });

  test('drags never inject moves while the queue is busy', async ({ page }) => {
    await gotoCube(page);
    await waitIdle(page);
    const box = await canvasBox(page);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Baseline before enqueuing: a turn can land in the frame between
    // enqueueMoves and the snapshot, so reading history afterwards would
    // sometimes already include a landed turn and make the expected total
    // unreachable.
    const before = (await snapshot(page)).history.length;
    // Twelve turns, not three: each pointer dispatch costs at least one slow
    // software frame, so a 3-move queue could drain mid-gesture and the drag
    // would legitimately commit a move - testing nothing. A queue this long
    // provably outlives the gesture, so the assertion below is exact.
    const queued = 12;
    await enqueueMoves(
      page,
      Array.from({ length: queued }, (_, index) => ({
        face: (['R', 'U', 'F'] as const)[index % 3],
        turns: 1 as const,
      })),
    );

    // Mid-animation drag: canStart() is false, so the gesture never starts and
    // OrbitControls receives the pointer instead.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 100, cy);
    await page.mouse.up();
    await waitIdle(page);

    // Exactly the queued turns: had the drag injected one, this would be
    // `before + queued + 1`.
    const done = await snapshot(page);
    expect(done.history).toHaveLength(before + queued);
  });
});
