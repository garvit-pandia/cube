import { useCallback, useEffect, useRef, useState } from 'react';

import { CubeController, type CubeSnapshot } from './app/CubeController';
import {
  DEFAULT_SETTINGS,
  animationScaleFor,
  loadSettings,
  loadSidebarOpen,
  prefersReducedMotion,
  safeStorage,
  saveSettings,
  saveSidebarOpen,
  type Settings,
} from './app/settings';
import { formatMove } from './cube/notation';
import { FACE_NAMES } from './cube/palette';
import { formatSequence } from './cube/scramble';
import type { MoveFace } from './cube/types';
import { FACE_LETTERS, MOVE_FACES, SLICE_LETTERS } from './cube/types';
import { PointerTurnHandler } from './render/PointerTurnHandler';
import { SceneManager } from './render/SceneManager';
import { formatTime } from './session/SolveSession';

const MOVE_VARIANTS: readonly { suffix: string; turns: 1 | 2 | 3; title: string }[] = [
  { suffix: '', turns: 1, title: 'clockwise' },
  { suffix: "'", turns: 3, title: 'counter-clockwise' },
  { suffix: '2', turns: 2, title: 'half turn' },
];

/** One labelled group of three buttons: a layer and its quarter turns. */
function MoveGroup({
  face,
  disabled,
  onPlay,
}: {
  face: MoveFace;
  disabled: boolean;
  onPlay: (face: MoveFace, turns: 1 | 2 | 3) => void;
}) {
  return (
    <div className="move-group">
      <span className="move-face" aria-hidden="true">
        {FACE_NAMES[face]}
      </span>
      <div className="move-buttons">
        {MOVE_VARIANTS.map((variant) => (
          <button
            type="button"
            key={variant.suffix}
            className="btn btn-move"
            onClick={() => onPlay(face, variant.turns)}
            aria-label={`${FACE_NAMES[face]} ${variant.title}`}
            disabled={disabled}
          >
            {face}
            {variant.suffix}
          </button>
        ))}
      </div>
    </div>
  );
}

const PHASE_LABEL: Record<CubeSnapshot['phase'], string> = {
  idle: 'Ready',
  ready: 'Scrambled',
  running: 'Solving',
  solving: 'Auto-solving',
  done: 'Solved',
};

const SPEED_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'instant', label: 'Instant' },
] as const;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CubeController | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const solvingRef = useRef(false);
  const [snapshot, setSnapshot] = useState<CubeSnapshot | null>(null);
  const [settings, setSettings] = useState<Settings>(() =>
    loadSettings(typeof window === 'undefined' ? null : safeStorage()),
  );
  const [osReducedMotion, setOsReducedMotion] = useState(false);
  const [runningMs, setRunningMs] = useState(0);
  const [sceneReady, setSceneReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() =>
    loadSidebarOpen(typeof window === 'undefined' ? null : safeStorage()),
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SceneManager(container);
    const controller = new CubeController();
    setOsReducedMotion(prefersReducedMotion());

    controller.attach(scene);
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.snapshot());

    // Sticker drags become face or slice turns; background drags stay orbit.
    const pointerTurn = new PointerTurnHandler(scene, {
      stickerInfo: (cubeletId, stickerIndex) => controller.stickerInfo(cubeletId, stickerIndex),
      canStart: () => controller.canDrag(),
      onMove: (move) => controller.enqueue(move),
    });

    sceneRef.current = scene;
    controllerRef.current = controller;

    // Reveal only once the first frame has actually been drawn, so the
    // viewport never flashes an empty canvas.
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => setSceneReady(true));
    });

    if (import.meta.env.DEV) {
      // Test seam: lets automated browser checks drive the cube and stop the
      // render loop without reaching through React internals.
      (window as unknown as Record<string, unknown>).__cube3 = {
        controller,
        scene,
        pause: () => scene.renderer.setAnimationLoop(null),
        resume: () => scene.renderer.setAnimationLoop(() => scene.tick()),
      };
    }

    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      setSceneReady(false);
      pointerTurn.dispose();
      unsubscribe();
      scene.dispose();
      controller.renderer.dispose();
      sceneRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  const reducedMotion = settings.forceReducedMotion || osReducedMotion;

  // Declared after the mount effect so the controller already exists on the
  // first run, and re-runs on its own whenever settings change.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.animationScale = reducedMotion ? 0.001 : animationScaleFor(settings);
  }, [settings, reducedMotion]);

  useEffect(() => {
    saveSettings(safeStorage(), settings);
  }, [settings]);

  useEffect(() => {
    saveSidebarOpen(safeStorage(), sidebarOpen);
  }, [sidebarOpen]);

  const playMove = useCallback((face: MoveFace, turns: 1 | 2 | 3) => {
    controllerRef.current?.enqueue({ face, turns });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (solvingRef.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toUpperCase();
      if (!MOVE_FACES.includes(key as MoveFace)) return;
      event.preventDefault();
      playMove(key as MoveFace, event.shiftKey ? 3 : 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playMove]);

  // The stored snapshot only lands on turn boundaries; while the clock is
  // running the display reads the controller each frame.
  const phase = snapshot?.phase ?? 'idle';
  useEffect(() => {
    if (phase !== 'running') return;
    let frame = 0;
    const loop = () => {
      setRunningMs(Math.floor((controllerRef.current?.elapsed ?? 0) / 10) * 10);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const historyLength = snapshot?.history.length ?? 0;
  useEffect(() => {
    const element = historyRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [historyLength]);

  const controller = controllerRef.current;
  const history = snapshot?.history ?? [];
  const scramble = snapshot?.scramble ?? [];
  const stats = snapshot?.stats;
  const elapsed = phase === 'running' ? runningMs : (snapshot?.elapsedMs ?? 0);
  const justSolved = snapshot?.justSolved ?? false;
  const solved = snapshot?.solved ?? true;
  const solving = snapshot?.solving ?? false;
  const autoSolved = snapshot?.autoSolved ?? false;

  // Keep the keydown handler's view of `solving` current without re-binding
  // the listener on every snapshot.
  useEffect(() => {
    solvingRef.current = solving;
  }, [solving]);

  const cubeDescription = solved
    ? 'Solved 3 by 3 Rubik\u2019s cube, every face showing one colour.'
    : `Mixed 3 by 3 Rubik\u2019s cube with ${historyLength} ${
        historyLength === 1 ? 'move' : 'moves'
      } played.`;

  return (
    <div className={`app${sidebarOpen ? '' : ' is-sidebar-collapsed'}`}>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Cube&sup3;</h1>
            <p>3&times;3 Rubik&rsquo;s Cube simulator</p>
          </div>
        </div>
        <div className="header-status">
          <button
            type="button"
            className="btn sidebar-toggle"
            aria-expanded={sidebarOpen}
            aria-controls="controls-panel"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            Controls
          </button>
          <span className={`status-pill is-${phase}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {PHASE_LABEL[phase]}
          </span>
          <details className="settings">
            <summary className="btn btn-ghost settings-toggle">Settings</summary>
            <div className="settings-panel">
              <fieldset>
                <legend>Turn speed</legend>
                {SPEED_OPTIONS.map((option) => (
                  <label key={option.value} className="settings-option">
                    <input
                      type="radio"
                      name="animation-speed"
                      value={option.value}
                      checked={settings.animationSpeed === option.value}
                      onChange={() =>
                        setSettings((current) => ({ ...current, animationSpeed: option.value }))
                      }
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={settings.forceReducedMotion}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      forceReducedMotion: event.target.checked,
                    }))
                  }
                />
                <span>Reduce motion</span>
              </label>
              {osReducedMotion && (
                <p className="settings-note">
                  Your system already requests reduced motion; turns are instant.
                </p>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-micro settings-reset"
                onClick={() => setSettings(DEFAULT_SETTINGS)}
              >
                Reset settings
              </button>
            </div>
          </details>
        </div>
      </header>

      <main className={`stage ${justSolved ? 'is-celebrating' : ''}`}>
        <div
          className={`viewport ${sceneReady ? 'is-ready' : ''}`}
          ref={containerRef}
          role="img"
          aria-label={cubeDescription}
        />
        <div className="stage-hint" aria-hidden="true">
          Drag a sticker to turn a face or middle slice &middot; drag the background to
          orbit &middot; scroll to zoom
        </div>
        {!sceneReady && (
          <div className="stage-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            Preparing cube
          </div>
        )}
        {justSolved && (
          <div className="solved-flash" aria-hidden="true">
            Solved
          </div>
        )}
      </main>

      {/* Screen readers get the result once, rather than a chattering clock. */}
      <p className="sr-only" role="status" aria-live="polite">
        {justSolved
          ? autoSolved
            ? 'Cube solved automatically.'
            : stats?.latest
              ? `Solved in ${formatTime(stats.latest.timeMs)} using ${stats.latest.moves} moves.`
              : ''
          : ''}
      </p>

      <section className="panel" id="controls-panel" aria-label="Cube controls">
        <div className="timer-bar">
          <div className="timer">
            <span
              className={`timer-value is-${phase}`}
              role="timer"
              aria-label={`Elapsed time ${formatTime(elapsed)}`}
            >
              {formatTime(elapsed)}
            </span>
            <span className="timer-label">{PHASE_LABEL[phase]}</span>
          </div>
          {solving && (
            <div className="solve-progress" role="status" aria-live="polite">
              <span className="solve-label">
                <span>Auto-solving</span>
                <span>
                  {snapshot?.solveDone ?? 0}/{snapshot?.solveTotal ?? 0}
                </span>
              </span>
              <span className="solve-bar">
                <span
                  style={{
                    width: `${snapshot && snapshot.solveTotal > 0 ? Math.round((snapshot.solveDone / snapshot.solveTotal) * 100) : 0}%`,
                  }}
                />
              </span>
            </div>
          )}
          <dl className="stats">
            <div>
              <dt>Best</dt>
              <dd>{stats?.best ? formatTime(stats.best.timeMs) : '\u2014'}</dd>
            </div>
            <div>
              <dt>Ao5</dt>
              <dd>{stats?.averageOf5 != null ? formatTime(stats.averageOf5) : '\u2014'}</dd>
            </div>
            <div>
              <dt>Ao12</dt>
              <dd>{stats?.averageOf12 != null ? formatTime(stats.averageOf12) : '\u2014'}</dd>
            </div>
            <div>
              <dt>Solves</dt>
              <dd>{stats?.count ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="panel-row">
          <button
            type="button"
            className="btn"
            onClick={() => void controller?.scrambleOptimally()}
            disabled={solving}
          >
            Scramble
          </button>
          <button
            type="button"
            className={`btn ${solving ? 'btn-danger' : 'btn-solve'}`}
            onClick={() => (solving ? controller?.cancelSolve() : controller?.solve())}
            disabled={!solving && !snapshot?.canSolve}
          >
            {solving ? 'Cancel' : 'Replay'}
          </button>
          <button
            type="button"
            className={`btn ${solving ? 'btn-danger' : 'btn-solve'}`}
            onClick={() => (solving ? undefined : controller?.solveOptimally())}
            disabled={!solving && !snapshot?.canSolveOptimally}
          >
            Optimal (~20)
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => controller?.undo()}
            disabled={solving || !snapshot?.canUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => controller?.redo()}
            disabled={solving || !snapshot?.canRedo}
          >
            Redo
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => sceneRef.current?.resetView(reducedMotion)}
          >
            Reset view
          </button>
          <button type="button" className="btn btn-danger" onClick={() => controller?.reset()}>
            Reset cube
          </button>
        </div>

        <div className="moves" role="group" aria-label="Face turns">
          {FACE_LETTERS.map((face) => (
            <MoveGroup key={face} face={face} disabled={solving} onPlay={playMove} />
          ))}
        </div>

        <div className="moves" role="group" aria-label="Middle-slice turns">
          {SLICE_LETTERS.map((slice) => (
            <MoveGroup key={slice} face={slice} disabled={solving} onPlay={playMove} />
          ))}
        </div>

        <p className="keyboard-hint">
          Keyboard: <kbd>U</kbd> <kbd>D</kbd> <kbd>L</kbd> <kbd>R</kbd> <kbd>F</kbd>{' '}
          <kbd>B</kbd> to turn a face, <kbd>M</kbd> <kbd>E</kbd> <kbd>S</kbd> a middle
          slice, hold <kbd>Shift</kbd> to reverse. The clock starts on your first turn
          after a scramble.
        </p>

        <div className="info">
          <div className="info-block">
            <div className="info-head">
              <h2 id="scramble-heading">Scramble</h2>
              <button
                type="button"
                className="btn btn-micro"
                onClick={() => {
                  void navigator.clipboard?.writeText(formatSequence(scramble));
                }}
                disabled={scramble.length === 0}
              >
                Copy
              </button>
            </div>
            <p
              className={`sequence ${scramble.length === 0 ? 'is-empty' : ''}`}
              aria-labelledby="scramble-heading"
            >
              {scramble.length > 0 ? formatSequence(scramble) : 'Press Scramble to generate one.'}
            </p>
          </div>

          <div className="info-block">
            <div className="info-head">
              <h2 id="history-heading">History</h2>
              <span className="info-count">{history.length}</span>
            </div>
            {history.length === 0 ? (
              <p className="sequence is-empty" aria-labelledby="history-heading">
                No moves yet.
              </p>
            ) : (
              <ol className="history" ref={historyRef} aria-labelledby="history-heading">
                {history.map((move, index) => (
                  <li
                    key={`${index}-${formatMove(move)}`}
                    className={`history-move ${index === history.length - 1 ? 'is-latest' : ''}`}
                  >
                    {formatMove(move)}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="info-block info-block-wide">
            <div className="info-head">
              <h2 id="solves-heading">Recent solves</h2>
              <button
                type="button"
                className="btn btn-micro"
                onClick={() => controller?.clearSession()}
                disabled={(stats?.count ?? 0) === 0}
              >
                Clear
              </button>
            </div>
            {stats && stats.recent.length > 0 ? (
              <ol className="solves" aria-labelledby="solves-heading">
                {stats.recent.slice(0, 8).map((record) => (
                  <li key={record.at} className="solve-row">
                    <span className="solve-time">{formatTime(record.timeMs)}</span>
                    <span className="solve-moves">{record.moves} moves</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sequence is-empty" aria-labelledby="solves-heading">
                Solve a scramble to record a time.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
