import { describe, expect, it, vi } from 'vitest';

import type { CubeSnapshot } from './CubeController';
import { DemoLoop, type DemoControllerLike } from './DemoLoop';
import type { Move } from '../cube/types';

interface FakeTimers {
  queue: { fn: () => void; ms: number }[];
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  advance: (count?: number) => void;
}

function makeTimers(): FakeTimers {
  const queue: { fn: () => void; ms: number }[] = [];
  return {
    queue,
    setTimer: (fn: () => void, _ms: number) => {
      const handle = { fn };
      queue.push({ fn, ms: _ms });
      return handle;
    },
    clearTimer: (handle: unknown) => {
      const index = queue.findIndex((entry) => entry.fn === (handle as { fn: () => void }).fn);
      if (index >= 0) queue.splice(index, 1);
    },
    advance: (count = 1) => {
      for (let i = 0; i < count && queue.length > 0; i++) {
        const entry = queue.shift();
        entry?.fn();
      }
    },
  };
}

function makeSnapshot(partial?: Partial<CubeSnapshot>): CubeSnapshot {
  return {
    history: [],
    moveCount: 0,
    solved: true,
    busy: false,
    canUndo: false,
    canRedo: false,
    latest: null,
    scramble: [],
    phase: 'idle',
    elapsedMs: 0,
    stats: { count: 0, best: null, averageOf5: null, averageOf12: null, latest: null, recent: [] },
    justSolved: false,
    autoSolved: false,
    solving: false,
    solveTotal: 0,
    solveDone: 0,
    canSolve: false,
    canSolveOptimally: false,
    ...partial,
  } as CubeSnapshot;
}

interface FakeController extends DemoControllerLike {
  busyValue: boolean;
  scrambleCalls: number;
  solveCalls: number;
  cancelCalls: number;
  scrambleRejects: boolean;
  solveRejects: boolean;
  solveNull: boolean;
}

function makeController(): FakeController {
  const fake: FakeController = {
    busyValue: false,
    scrambleCalls: 0,
    solveCalls: 0,
    cancelCalls: 0,
    scrambleRejects: false,
    solveRejects: false,
    solveNull: false,
    snapshot: () => makeSnapshot({ busy: fake.busyValue }),
    scrambleOptimally: () => {
      fake.scrambleCalls++;
      if (fake.scrambleRejects) return Promise.reject(new Error('solver blocked'));
      return Promise.resolve([{ face: 'R', turns: 1 } as Move]);
    },
    solveOptimally: () => {
      fake.solveCalls++;
      if (fake.solveRejects) return Promise.reject(new Error('solver blocked'));
      if (fake.solveNull) return Promise.resolve(null);
      return Promise.resolve([{ face: 'R', turns: 3 } as Move]);
    },
    cancelSolve: () => {
      fake.cancelCalls++;
    },
  };
  return fake;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DemoLoop', () => {
  it('cycles scrambling → solving → celebrating → resting → scrambling', async () => {
    vi.useFakeTimers();
    try {
      const controller = makeController();
      const timers = makeTimers();
      const seen: string[] = [];
      const loop = new DemoLoop(controller, {
        restMs: 100,
        celebrateMs: 100,
        pollMs: 10,
        setTimer: timers.setTimer,
        clearTimer: timers.clearTimer,
      });
      loop.onTransition = (state) => seen.push(state);
      loop.start();
      expect(loop.state).toBe('scrambling');
      await flush();
      timers.advance();
      await flush();
      expect(loop.state).toBe('solving');
      await flush();
      timers.advance();
      await flush();
      expect(loop.state).toBe('celebrating');
      timers.advance();
      await flush();
      expect(loop.state).toBe('resting');
      timers.advance();
      await flush();
      expect(loop.state).toBe('scrambling');
      expect(seen).toEqual(['scrambling', 'solving', 'celebrating', 'resting', 'scrambling']);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop during solving calls cancelSolve exactly once and lands off', async () => {
    const controller = makeController();
    controller.busyValue = true;
    const timers = makeTimers();
    const loop = new DemoLoop(controller, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    loop.start();
    await flush();
    // Polls see busy until the stop; then solving begins on idle.
    timers.advance();
    await flush();
    controller.busyValue = false;
    timers.advance();
    await flush();
    expect(loop.state).toBe('solving');
    controller.busyValue = true;
    loop.stop();
    expect(controller.cancelCalls).toBe(1);
    expect(loop.state).toBe('off');
  });

  it('stop during resting clears the pending loop timer', async () => {
    const controller = makeController();
    const timers = makeTimers();
    const seen: string[] = [];
    const loop = new DemoLoop(controller, {
      restMs: 100,
      celebrateMs: 100,
      pollMs: 10,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    loop.onTransition = (state) => seen.push(state);
    loop.start();
    await flush();
    timers.advance();
    await flush();
    timers.advance();
    await flush();
    expect(loop.state).toBe('celebrating');
    timers.advance();
    await flush();
    expect(loop.state).toBe('resting');
    const transitions = seen.length;
    loop.stop();
    expect(loop.state).toBe('off');
    timers.advance(5);
    await flush();
    expect(seen.length).toBe(transitions + 1);
    expect(seen[seen.length - 1]).toBe('off');
  });

  it('start while running is a no-op', async () => {
    const controller = makeController();
    const timers = makeTimers();
    const loop = new DemoLoop(controller, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    loop.start();
    loop.start();
    await flush();
    expect(controller.scrambleCalls).toBe(1);
    loop.stop();
  });

  it('solveOptimally rejection ends the loop at off without throwing', async () => {
    const controller = makeController();
    controller.solveRejects = true;
    const timers = makeTimers();
    const loop = new DemoLoop(controller, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    loop.start();
    await flush();
    timers.advance();
    await flush();
    await flush();
    expect(loop.state).toBe('off');
    expect(timers.queue.length).toBe(0);
  });

  it('scrambleOptimally rejection ends the loop at off without throwing', async () => {
    const controller = makeController();
    controller.scrambleRejects = true;
    const timers = makeTimers();
    const loop = new DemoLoop(controller, {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    loop.start();
    await flush();
    await flush();
    expect(loop.state).toBe('off');
    expect(timers.queue.length).toBe(0);
  });
});
