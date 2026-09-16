import type { CubeSnapshot } from './CubeController';
import type { Move } from '../cube/types';

export type DemoState = 'off' | 'scrambling' | 'solving' | 'celebrating' | 'resting';

/** Minimal controller surface — lets tests inject fakes. */
export interface DemoControllerLike {
  snapshot(): CubeSnapshot;
  scrambleOptimally(length?: number): Promise<Move[]>;
  solveOptimally(): Promise<Move[] | null>;
  cancelSolve(): void;
}

interface DemoLoopOptions {
  readonly restMs?: number;
  readonly celebrateMs?: number;
  readonly pollMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/**
 * Self-solving demo loop: scramble → optimal solve → celebrate → rest →
 * repeat, forever. A pure state machine (no three.js, no DOM, no window):
 * App wires it to the cinema rig, the Demo toggle, and the stop guards.
 * Demo only ever drives `record: false` paths (scrambleOptimally /
 * solveOptimally), so history and the session are never polluted.
 */
export class DemoLoop {
  private stateValue: DemoState = 'off';
  onTransition: ((state: DemoState) => void) | null = null;

  private readonly controller: DemoControllerLike;
  private readonly restMs: number;
  private readonly celebrateMs: number;
  private readonly pollMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timer: unknown = null;
  private stopped = true;

  constructor(controller: DemoControllerLike, opts?: DemoLoopOptions) {
    this.controller = controller;
    this.restMs = opts?.restMs ?? 2500;
    this.celebrateMs = opts?.celebrateMs ?? 1600;
    this.pollMs = opts?.pollMs ?? 50;
    this.setTimer = opts?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = opts?.clearTimer ?? ((handle) => clearTimeout(handle as number));
  }

  get state(): DemoState {
    return this.stateValue;
  }

  /** No-op if already running. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.transition('scrambling');
    this.runScramble();
  }

  /** cancelSolve() if mid-solve; clears timers; → 'off'. */
  stop(): void {
    if (this.stopped && this.stateValue === 'off') return;
    this.stopped = true;
    this.clearPending();
    if (this.stateValue === 'solving' || this.stateValue === 'scrambling') {
      this.controller.cancelSolve();
    }
    this.transition('off');
  }

  private transition(state: DemoState): void {
    this.stateValue = state;
    this.onTransition?.(state);
  }

  private clearPending(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private later(fn: () => void, ms: number): void {
    this.clearPending();
    this.timer = this.setTimer(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private runScramble(): void {
    let fired: Promise<Move[]>;
    try {
      fired = this.controller.scrambleOptimally();
    } catch {
      this.failOff();
      return;
    }
    fired.then(
      () => {
        if (this.stopped) return;
        this.pollUntilIdle(() => this.runSolve());
      },
      () => this.failOff(),
    );
  }

  private runSolve(): void {
    if (this.stopped) return;
    this.transition('solving');
    let fired: Promise<Move[] | null>;
    try {
      fired = this.controller.solveOptimally();
    } catch {
      this.failOff();
      return;
    }
    fired.then(
      (moves) => {
        if (this.stopped) return;
        if (moves === null) {
          // Nothing to solve (already solved): rest, then loop.
          this.transition('resting');
          this.later(() => {
            if (!this.stopped) this.loopAgain();
          }, this.restMs);
          return;
        }
        this.pollUntilIdle(() => this.celebrate());
      },
      () => this.failOff(),
    );
  }

  private celebrate(): void {
    if (this.stopped) return;
    this.transition('celebrating');
    this.later(() => {
      if (this.stopped) return;
      this.transition('resting');
      this.later(() => {
        if (!this.stopped) this.loopAgain();
      }, this.restMs);
    }, this.celebrateMs);
  }

  private loopAgain(): void {
    if (this.stopped) return;
    this.transition('scrambling');
    this.runScramble();
  }

  private pollUntilIdle(next: () => void): void {
    const poll = (): void => {
      if (this.stopped) return;
      let busy: boolean;
      try {
        busy = this.controller.snapshot().busy;
      } catch {
        this.failOff();
        return;
      }
      if (!busy) {
        next();
        return;
      }
      this.later(poll, this.pollMs);
    };
    this.later(poll, this.pollMs);
  }

  private failOff(): void {
    this.stopped = true;
    this.clearPending();
    this.transition('off');
  }
}
