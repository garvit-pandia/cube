import type { Page } from '@playwright/test';

/** Minimal shape of the controller snapshot, serialised across the seam. */
export interface CubeSnapshotLike {
  solved: boolean;
  phase: string;
  solving: boolean;
  busy: boolean;
  solveTotal: number;
  solveDone: number;
  history: { face: string; turns: number }[];
}

export interface MoveLike {
  face: string;
  turns: number;
}

export const FACE_LETTERS = ['U', 'D', 'L', 'R', 'F', 'B'];
export const SLICE_LETTERS = ['M', 'E', 'S'];
export const MOVE_FACES = [...FACE_LETTERS, ...SLICE_LETTERS];

/**
 * Client-space position of a sticker's centre, projected through the live
 * camera. Lets a test aim a drag at a specific sticker (e.g. the F centre)
 * instead of hoping a fixed viewport point lands on it. The cubelet's own
 * centre is not enough: the sticker floats ~0.48 in front of it, which is a
 * large perspective offset at this camera distance.
 */
export async function stickerScreenPoint(
  page: Page,
  home: [number, number, number],
): Promise<{ x: number; y: number }> {
  return page.evaluate((homePos) => {
    interface Point3 {
      x: number;
      y: number;
      clone(): Point3;
      project(camera: unknown): Point3;
    }
    interface Node3 {
      children: Node3[];
      userData: { cubeletId?: number; stickerIndex?: number };
      position: Point3;
      getWorldPosition(target: Point3): Point3;
    }
    const seam = (
      window as unknown as {
        __cube3: {
          scene: { camera: unknown; renderer: { domElement: HTMLCanvasElement } };
          controller: {
            state: { all(): { id: number; home: readonly number[] }[] };
            renderer: { object: Node3 & { getObjectByName(name: string): Node3 | null } };
          };
        };
      }
    ).__cube3;
    const cubie = seam.controller.state.all().find((c) =>
      c.home.every((value, index) => value === homePos[index]),
    );
    if (!cubie) throw new Error(`cubelet ${homePos.join(',')} not found`);
    const group = seam.controller.renderer.object.getObjectByName(`cubelet-${cubie.id}`);
    const sticker = group?.children.find((child) => child.userData.stickerIndex !== undefined);
    if (!sticker) throw new Error(`cubelet ${homePos.join(',')} has no sticker`);
    const world = sticker.getWorldPosition(sticker.position.clone());
    const ndc = world.project(seam.scene.camera);
    const rect = seam.scene.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }, home);
}

export async function gotoCube(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => {
    const candidate = (window as unknown as Record<string, { controller?: unknown }>).__cube3;
    return typeof candidate?.controller === 'object';
  });
  // Headless software rendering runs at a few fps, and the deliberate delta
  // clamp (invariant 9) would stretch every 230ms turn to seconds of wall
  // time. Tests verify state transitions, not easing curves, so drive the
  // public animation scale down to near-instant.
  await page.evaluate(() => {
    const controller = (
      window as unknown as { __cube3: { controller: { animationScale: number } } }
    ).__cube3.controller;
    controller.animationScale = 0.001;
  });
}

export async function snapshot(page: Page): Promise<CubeSnapshotLike> {
  return page.evaluate<CubeSnapshotLike>(
    () =>
      (window as unknown as { __cube3: { controller: { snapshot(): CubeSnapshotLike } } }).__cube3
        .controller.snapshot(),
  );
}

/** Wait until every queued turn has landed and no auto-solve is driving. */
export async function waitIdle(page: Page, timeout = 45_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const current = (
        window as unknown as { __cube3?: { controller?: { snapshot(): CubeSnapshotLike } } }
      ).__cube3?.controller?.snapshot();
      return current !== undefined && !current.busy && !current.solving;
    },
    undefined,
    { timeout },
  );
}

/** Poll `snapshot()` from Node until `predicate` holds, then return it. */
export async function pollFor(
  page: Page,
  predicate: (snapshot: CubeSnapshotLike) => boolean,
  timeout = 45_000,
): Promise<CubeSnapshotLike> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const current = await snapshot(page);
    if (predicate(current)) return current;
    if (Date.now() > deadline) throw new Error('timeout waiting for snapshot condition');
    await page.waitForTimeout(120);
  }
}

export async function enqueueMoves(page: Page, moves: MoveLike[]): Promise<void> {
  await page.evaluate((queue) => {
    const controller = (
      window as unknown as { __cube3: { controller: { enqueue(m: MoveLike): void } } }
    ).__cube3.controller;
    for (const move of queue) controller.enqueue(move);
  }, moves);
}

export async function scrambleOptimally(page: Page): Promise<MoveLike[]> {
  return page.evaluate(async () => {
    const controller = (
      window as unknown as {
        __cube3: { controller: { scrambleOptimally(): Promise<MoveLike[]> } };
      }
    ).__cube3.controller;
    return controller.scrambleOptimally();
  });
}

export async function scrambleRandomMoves(page: Page): Promise<MoveLike[]> {
  return page.evaluate(() => {
    const controller = (
      window as unknown as { __cube3: { controller: { scrambleCube(): MoveLike[] } } }
    ).__cube3.controller;
    return controller.scrambleCube();
  });
}

export async function solveReplay(page: Page): Promise<MoveLike[] | null> {
  return page.evaluate(() => {
    const controller = (
      window as unknown as { __cube3: { controller: { solve(): MoveLike[] | null } } }
    ).__cube3.controller;
    return controller.solve();
  });
}

export async function solveOptimally(page: Page): Promise<MoveLike[] | null> {
  return page.evaluate(async () => {
    const controller = (
      window as unknown as {
        __cube3: { controller: { solveOptimally(): Promise<MoveLike[] | null> } };
      }
    ).__cube3.controller;
    return controller.solveOptimally();
  });
}

export async function cancelSolve(page: Page): Promise<void> {
  await page.evaluate(() => {
    const controller = (
      window as unknown as { __cube3: { controller: { cancelSolve(): void } } }
    ).__cube3.controller;
    controller.cancelSolve();
  });
}
