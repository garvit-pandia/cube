import { CubeState } from '../cube/CubeState';
import { stickerWorldNormal } from '../cube/dragTurn';
import { isSolverError, solutionToMoves, toFacelets } from '../cube/facelets';
import { invertMove, invertMoves, simplifyMoves } from '../cube/notation';
import { MOVE_AXES } from '../cube/palette';
import { generateScramble, formatSequence } from '../cube/scramble';
import type { Move, Vec3 } from '../cube/types';
import type { SceneManager } from '../render/SceneManager';
import { CubeRenderer } from '../render/CubeRenderer';
import { SolveSession, type SolveStats, type StorageLike } from '../session/SolveSession';

/** Easing for a layer turn: quick start, gentle settle. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** A double turn covers twice the arc, so it gets a longer window than a quarter. */
function durationFor(turns: 1 | 2 | 3, scale: number): number {
  return (turns === 2 ? 300 : 230) * scale;
}

/** Remove the newest matching entry; the `applied` log may hold repeats. */
function removeLastInstance(log: Move[], move: Move): void {
  for (let index = log.length - 1; index >= 0; index--) {
    if (log[index].face === move.face && log[index].turns === move.turns) {
      log.splice(index, 1);
      return;
    }
  }
}

/** localStorage is unavailable in some privacy modes; never let that break a solve. */
function safeLocalStorage(): StorageLike | null {
  try {
    const probe = '__cube3_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * `idle` — untouched cube. `ready` — scrambled (or otherwise mixed) but the
 * solver has not moved yet. `running` — the clock is going. `solving` — the
 * auto-solve animation is driving the queue. `done` — solved; recorded when
 * the user solved it, bare when the auto-solve did.
 */
export type SolvePhase = 'idle' | 'ready' | 'running' | 'solving' | 'done';

export interface CubeSnapshot {
  readonly history: readonly Move[];
  readonly moveCount: number;
  readonly solved: boolean;
  readonly busy: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly latest: Move | null;
  readonly scramble: readonly Move[];
  readonly phase: SolvePhase;
  readonly elapsedMs: number;
  readonly stats: SolveStats;
  /** Set for the snapshot that first reports a finished solve, for UI feedback. */
  readonly justSolved: boolean;
  /** True when that finished solve was the auto-solve, not the user. */
  readonly autoSolved: boolean;
  /** True while the auto-solve is driving the queue. */
  readonly solving: boolean;
  /** Total turns in the running auto-solve; 0 when not solving. */
  readonly solveTotal: number;
  /** Auto-solve turns that have already landed in the logical state. */
  readonly solveDone: number;
  /** True when `solve()` has work to do. */
  readonly canSolve: boolean;
  /** True when `solveOptimally()` would have something to do. */
  readonly canSolveOptimally: boolean;
}

type SolverApi = {
  readonly solve: (facelets: string) => string;
  readonly randomCube: () => string;
  readonly initFull: () => void;
};

let solverPromise: Promise<SolverApi | null> | null = null;

/** Lazy-load the vendored two-phase solver; warms tables in the background. */
function loadSolver(): Promise<SolverApi | null> {
  if (!solverPromise) {
    solverPromise = import('../cube/min2phase.js')
      .then((module): SolverApi => {
        const api = (module.default ?? module) as SolverApi;
        try {
          api.initFull();
        } catch {
          // Partial init still solves; first call just takes ~200ms.
        }
        return api;
      })
      .catch(() => null);
  }
  return solverPromise;
}

// Warm the solver on module load so it is ready by the time the user asks.
if (typeof window !== 'undefined') {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => void loadSolver());
  } else {
    setTimeout(() => void loadSolver(), 1500);
  }
}

type Listener = (snapshot: CubeSnapshot) => void;

interface QueuedMove {
  readonly move: Move;
  /** False for turns the machine plays on the user's behalf. */
  readonly record: boolean;
  /** True for turns belonging to the auto-solve animation. */
  readonly solve?: boolean;
  /** When set, the landing turn cancels this earlier `applied` entry. */
  readonly undoOf?: Move;
  /** When set, the landing turn restores this `applied` entry. */
  readonly redoOf?: Move;
}

interface ActiveTurn {
  readonly entry: QueuedMove;
  readonly ids: readonly number[];
  readonly axis: 'x' | 'y' | 'z';
  readonly angle: number;
  readonly duration: number;
  elapsed: number;
}

/**
 * Drives the cube: owns the authoritative `CubeState`, mirrors it into the
 * `CubeRenderer`, and serialises moves through an animation queue so logical
 * state and visuals can never disagree. A turn's interpolated transform is
 * discarded the moment it finishes and replaced by exact integer-derived
 * transforms, so nothing accumulates drift.
 */
export class CubeController {
  readonly state = new CubeState();
  readonly renderer = new CubeRenderer();
  readonly session: SolveSession;

  history: Move[] = [];
  scramble: Move[] = [];
  phase: SolvePhase = 'idle';
  elapsedMs = 0;
  animationScale = 1;

  private startedAt = 0;

  private queue: QueuedMove[] = [];
  private active: ActiveTurn | null = null;
  private redoStack: Move[] = [];
  private listeners = new Set<Listener>();
  private notifyScheduled = false;
  private justSolved = false;
  private autoSolved = false;

  /**
   * Every turn that has landed in `state`, oldest first — recorded or not.
   * `solve()` is the inverse of this log, so it is the one piece of
   * bookkeeping that makes "solve from any state" exact.
   */
  private applied: Move[] = [];

  private solving = false;
  private solveTotal = 0;
  private solveDone = 0;
  private phaseBeforeSolve: SolvePhase = 'idle';

  constructor(storage: StorageLike | null = safeLocalStorage()) {
    this.session = new SolveSession(storage);
  }

  attach(scene: SceneManager): void {
    this.renderer.build(this.state.all());
    scene.scene.add(this.renderer.object);
    scene.onBeforeRender = (delta) => this.update(delta);
  }

  /**
   * Elapsed solve time. Measured from the wall clock rather than by summing
   * frame deltas: a dropped frame must never make a timed solve read short.
   */
  get elapsed(): number {
    if (this.phase === 'running') return performance.now() - this.startedAt;
    return this.elapsedMs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): CubeSnapshot {
    return {
      history: [...this.history],
      moveCount: this.history.length,
      solved: this.state.isSolved(),
      busy: this.active !== null || this.queue.length > 0,
      canUndo: !this.solving && (this.history.length > 0 || this.queue.length > 0),
      canRedo: this.redoStack.length > 0,
      latest: this.history[this.history.length - 1] ?? null,
      scramble: [...this.scramble],
      phase: this.phase,
      elapsedMs: this.elapsed,
      stats: this.session.stats(),
      justSolved: this.justSolved,
      autoSolved: this.autoSolved,
      solving: this.solving,
      solveTotal: this.solveTotal,
      solveDone: this.solveDone,
      canSolve: this.canSolve(),
      canSolveOptimally: !this.solving && !this.isBusy() && !this.state.isSolved(),
    };
  }

  /** Queue a turn. Any new turn invalidates the redo path. */
  enqueue(move: Move): void {
    if (this.solving) return;
    this.redoStack = [];
    this.queue.push({ move, record: true });
    this.scheduleNotify();
  }

  enqueueAll(moves: readonly Move[]): void {
    if (this.solving || moves.length === 0) return;
    this.redoStack = [];
    for (const move of moves) this.queue.push({ move, record: true });
    this.scheduleNotify();
  }

  /** Reverse the newest user move, after the in-flight turn if any. */
  undo(): void {
    if (this.solving) return;
    if (this.queue.length > 0) {
      const dropped = this.queue.pop();
      if (dropped?.record) this.redoStack.push(dropped.move);
      this.scheduleNotify();
      return;
    }
    const last = this.history.pop();
    if (!last) return;
    this.redoStack.push(last);
    // The inverse is played through the same queue, unrecorded; when it
    // lands, `update()` replays the matching inversion on `applied` so replay
    // still inverts to solved.
    this.queue.push({ move: invertMove(last), record: false, undoOf: last });
    this.scheduleNotify();
  }

  redo(): void {
    if (this.solving) return;
    const next = this.redoStack.pop();
    if (!next) return;
    this.queue.push({ move: next, record: true, redoOf: next });
    this.scheduleNotify();
  }

  /**
   * Play the cube back to solved. The solution is the inverse of every turn
   * that has landed this session, so it is always correct from any mixed
   * state. Turns still waiting in the queue are discarded; the in-flight turn
   * finishes and the solution undoes it too. Auto-solve turns are not
   * recorded: the clock freezes and no session record is written.
   */
  solve(): Move[] | null {
    if (this.solving || !this.canSolve()) return null;

    const log = [...this.applied];
    if (this.active) log.push(this.active.entry.move);
    const solution = simplifyMoves(invertMoves(log));
    if (solution.length === 0) return null;

    this.redoStack = [];
    this.queue = solution.map((move): QueuedMove => ({ move, record: false, solve: true }));
    this.phaseBeforeSolve = this.phase;
    if (this.phase === 'running') this.elapsedMs = this.elapsed;
    this.solving = true;
    this.solveTotal = solution.length;
    this.solveDone = 0;
    this.phase = 'solving';
    this.justSolved = false;
    this.autoSolved = false;
    this.scheduleNotify();
    return [...solution];
  }

  /** Stop the auto-solve after the in-flight turn; already-played turns stay. */
  cancelSolve(): void {
    if (!this.solving) return;
    this.queue = this.queue.filter((entry) => !entry.solve);
    this.solving = false;
    this.solveTotal = 0;
    this.solveDone = 0;
    this.phase = this.phaseBeforeSolve === 'solving' ? 'ready' : this.phaseBeforeSolve;
    // Resume a paused timed attempt from where it stopped.
    if (this.phase === 'running') this.startedAt = performance.now() - this.elapsedMs;
    this.scheduleNotify();
  }

  /**
   * Solve the current cube state optimally using the two-phase algorithm.
   * Unlike `solve()`, this works from any state (not just logged turns) and
   * produces a near-optimal solution (≤21 moves). Falls back to replay solve
   * if the solver is unavailable or rejects the state.
   */
  async solveOptimally(): Promise<Move[] | null> {
    if (this.solving || this.isBusy() || this.state.isSolved()) return null;

    const api = await loadSolver();
    if (!api) {
      // Solver failed to load; fall back to log-inversion.
      return this.solve();
    }
    // The solver loads async; the cube may have changed while we waited.
    if (this.solving || this.isBusy() || this.state.isSolved()) return null;

    const facelets = toFacelets(this.state);
    const solution = api.solve(facelets);
    if (isSolverError(solution)) {
      // Invalid state projection or unsolvable; fall back.
      return this.solve();
    }

    const moves = simplifyMoves(solutionToMoves(solution));
    if (moves.length === 0) return null;

    this.redoStack = [];
    this.queue = moves.map((move): QueuedMove => ({ move, record: false, solve: true }));
    this.phaseBeforeSolve = this.phase;
    if (this.phase === 'running') this.elapsedMs = this.elapsed;
    this.solving = true;
    this.solveTotal = moves.length;
    this.solveDone = 0;
    this.phase = 'solving';
    this.justSolved = false;
    this.autoSolved = false;
    this.scheduleNotify();
    return [...moves];
  }

  /**
   * Generate a true random-state scramble using the solver's scrambler.
   * Falls back to axis-alternation if the solver is unavailable.
   * A scramble starts a new attempt from the solved cube (see scrambleCube).
   */
  async scrambleOptimally(length = 22): Promise<Move[]> {
    if (this.solving || this.isBusy()) return [...this.scramble];
    const api = await loadSolver();
    if (this.solving || this.isBusy()) return [...this.scramble];
    if (api) {
      const facelets = api.randomCube();
      // Convert to Singmaster by solving from the random state.
      const solution = api.solve(facelets);
      if (!isSolverError(solution)) {
        const scramble = simplifyMoves(invertMoves(solutionToMoves(solution)));
        this.beginAttempt();
        for (const move of scramble) this.queue.push({ move, record: false });
        this.scramble = scramble;
        this.phase = 'ready';
        this.elapsedMs = 0;
        this.justSolved = false;
        this.autoSolved = false;
        this.scheduleNotify();
        return [...scramble];
      }
    }
    // Fallback
    return this.scrambleCube(length);
  }

  /**
   * Scramble the cube. Scramble turns are played through the same queue as
   * user turns so the whole thing animates, but they are not recorded in the
   * move history — the history is the solver's moves, matching a timed solve.
   * A scramble starts a new attempt from the solved cube: the previous attempt
   * is already recorded in the session, so history and the replay log restart
   * here. The state itself resets, so replay inverts exactly this scramble.
   */
  scrambleCube(length = 22): Move[] {
    if (this.solving) return [...this.scramble];
    this.scramble = generateScramble(length);
    this.beginAttempt();
    for (const move of this.scramble) this.queue.push({ move, record: false });
    this.phase = 'ready';
    this.elapsedMs = 0;
    this.justSolved = false;
    this.autoSolved = false;
    this.scheduleNotify();
    return [...this.scramble];
  }

  reset(): void {
    this.queue = [];
    this.redoStack = [];
    this.history = [];
    this.scramble = [];
    this.applied = [];
    this.active = null;
    this.solving = false;
    this.solveTotal = 0;
    this.solveDone = 0;
    this.phaseBeforeSolve = 'idle';
    this.phase = 'idle';
    this.elapsedMs = 0;
    this.justSolved = false;
    this.autoSolved = false;
    this.renderer.clearLayerRotation();
    this.state.reset();
    this.renderer.sync(this.state.all());
    this.scheduleNotify();
  }

  clearSession(): void {
    this.session.clear();
    this.scheduleNotify();
  }

  /**
   * Start a new attempt from the solved cube: drop any queued or in-flight
   * turn, snap the state and renderer back to identity, and restart the
   * history, the replay log, and the redo path. `scramble` itself is left for
   * the caller to set. Both scramble entry points funnel through here so a
   * scramble can never stack on top of a half-finished cube.
   */
  private beginAttempt(): void {
    this.queue = [];
    this.redoStack = [];
    this.history = [];
    this.applied = [];
    this.active = null;
    this.renderer.clearLayerRotation();
    this.state.reset();
    this.renderer.sync(this.state.all());
  }

  isBusy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /**
   * True when a drag gesture may start: the queue must be fully drained so
   * the sticker facts the gesture reads from `state` are the ones it turns.
   */
  canDrag(): boolean {
    return !this.solving && !this.isBusy();
  }

  /**
   * State-derived facts for a sticker mesh hit by a raycast. The world normal
   * is the cubie-local normal carried by the cubelet's integer rotation, so
   * input resolution reads the model, never the meshes.
   */
  stickerInfo(cubeletId: number, stickerIndex: number): { normal: Vec3; position: Vec3 } | null {
    const cubie = this.state.byId(cubeletId);
    const sticker = cubie?.stickers[stickerIndex];
    if (!cubie || !sticker) return null;
    return {
      normal: stickerWorldNormal(cubie.rotation, sticker.normal),
      position: cubie.position,
    };
  }

  /** True when `solve()` would have something to do. */
  private canSolve(): boolean {
    return (
      !this.solving &&
      !this.state.isSolved() &&
      (this.applied.length > 0 || this.active !== null)
    );
  }

  private scheduleNotify(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      const snapshot = this.snapshot();
      // `justSolved` / `autoSolved` are one-shot flags: they are consumed by
      // the notification that carries them, so the UI can celebrate once.
      this.justSolved = false;
      this.autoSolved = false;
      for (const listener of this.listeners) listener(snapshot);
    });
  }

  private startTurn(entry: QueuedMove): void {
    const { axis, sign } = MOVE_AXES[entry.move.face];
    const quarters = entry.move.turns === 1 ? 1 : entry.move.turns === 2 ? 2 : -1;
    this.active = {
      entry,
      ids: this.state.layerIds(entry.move.face),
      axis,
      angle: quarters * (Math.PI / 2) * -sign,
      duration: durationFor(entry.move.turns, this.animationScale),
      elapsed: 0,
    };
  }

  private update(rawDelta: number): void {
    // A backgrounded tab can deliver a huge delta; cap it so a move never
    // teleports through several queued turns of easing in one frame.
    const delta = Math.min(rawDelta, 0.1);

    if (!this.active) {
      const next = this.queue.shift();
      if (!next) return;
      this.startTurn(next);
    }

    const active = this.active;
    if (!active) return;

    active.elapsed += delta * 1000;
    const progress = Math.min(active.elapsed / active.duration, 1);
    this.renderer.setLayerRotation(active.axis, active.ids, active.angle * easeInOutCubic(progress));

    if (progress >= 1) {
      this.state.applyMove(active.entry.move);
      if (active.entry.undoOf) {
        // Undo: the inverse landed, so the undone turn leaves the log.
        removeLastInstance(this.applied, active.entry.undoOf);
      } else if (active.entry.redoOf) {
        // Redo: the re-applied turn rejoins the log.
        this.applied.push(active.entry.redoOf);
      } else {
        this.applied.push(active.entry.move);
      }
      if (active.entry.solve) this.solveDone++;
      if (active.entry.record) this.history.push(active.entry.move);
      this.active = null;
      // Exact integer-derived transforms replace the interpolated ones.
      this.renderer.sync(this.state.all());
      this.afterTurnCompleted(active.entry);
      this.scheduleNotify();
    }
  }

  /** Advance the solve lifecycle once a turn has landed in the logical state. */
  private afterTurnCompleted(entry: QueuedMove): void {
    // The clock starts on the attempt's first real turn, not on the scramble.
    // A user turn still in flight when the auto-solve starts must not tick it.
    if (!this.solving && entry.record && this.phase !== 'running') {
      if (this.phase === 'done') {
        // A new manual attempt starts from a solved cube: the previous attempt
        // is already in the session, so history and the scramble label restart
        // here, mirroring what a scramble does (see scrambleCube). The push in
        // update() already ran, so keep just this turn instead of clearing.
        this.history = [entry.move];
        this.scramble = [];
      }
      this.phase = 'running';
      this.startedAt = performance.now();
      this.elapsedMs = 0;
    }

    if (this.solving) {
      // Last auto-solve turn landed: back to solved, but not the user's solve,
      // so no record is written and the clock stays at zero.
      if (this.queue.length === 0) {
        this.solving = false;
        this.solveTotal = 0;
        this.solveDone = 0;
        this.elapsedMs = 0;
        this.phase = 'done';
        this.justSolved = this.state.isSolved();
        this.autoSolved = this.justSolved;
        this.applied = [];
      }
      return;
    }

    if (this.phase === 'running' && this.state.isSolved() && this.history.length > 0) {
      this.elapsedMs = performance.now() - this.startedAt;
      this.phase = 'done';
      this.justSolved = true;
      this.autoSolved = false;
      this.session.add({
        timeMs: Math.round(this.elapsedMs),
        moves: this.history.length,
        scramble: formatSequence(this.scramble),
        at: Date.now(),
      });
      // The cube is at the identity again; the turn log restarts with it.
      this.applied = [];
    }
  }
}
