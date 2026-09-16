import { expect, test } from '@playwright/test';

import { pollFor, snapshot, waitIdle } from './support';

test.describe('demo loop (via __cube3 seam)', () => {
  test('?demo=1 autostarts, cycles phases, stage tap stops it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/?demo=1');
    await page.waitForFunction(() => {
      const candidate = (window as unknown as Record<string, { controller?: unknown }>).__cube3;
      return typeof candidate?.controller === 'object';
    });
    await page.evaluate(() => {
      const controller = (
        window as unknown as { __cube3: { controller: { animationScale: number } } }
      ).__cube3.controller;
      controller.animationScale = 0.001;
    });

    // Autostart: the loop scrambles, then solves. Wait for the phase to
    // visibly leave idle/ready and enter an auto-solving state.
    const solving = await pollFor(
      page,
      (s) => s.phase === 'solving' || s.solving,
      90_000,
    );
    expect(solving.solving || solving.phase === 'solving').toBe(true);

    // Cinema owns the camera while demo is on.
    const controlsDisabled = await page.evaluate(() => {
      const scene = (window as unknown as { __cube3: { scene: { controls: { enabled: boolean } } } })
        .__cube3.scene;
      return scene.controls.enabled;
    });
    expect(controlsDisabled).toBe(false);

    // Let it run into the next cycle, then screenshot mid-demo.
    await page.waitForTimeout(3000);
    await page.screenshot({ path: '/tmp/opencode/cube3-design/demo.png' });

    // Stage pointerdown stops the demo and restores the camera.
    const box = await page.locator('.viewport canvas').boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(800);

    const controlsRestored = await page.evaluate(() => {
      const scene = (window as unknown as { __cube3: { scene: { controls: { enabled: boolean } } } })
        .__cube3.scene;
      return scene.controls.enabled;
    });
    expect(controlsRestored).toBe(true);

    const after = await snapshot(page);
    expect(after.solving).toBe(false);
    await waitIdle(page);
    expect(errors).toEqual([]);
  });
});
