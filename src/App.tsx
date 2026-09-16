import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { CubeController, type CubeSnapshot } from './app/CubeController';
import { CaptureManager } from './app/CaptureManager';
import { DemoLoop } from './app/DemoLoop';
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
import { CelebrationRig } from './render/CelebrationRig';
import { CinemaRig } from './render/CinemaRig';
import { PointerTurnHandler } from './render/PointerTurnHandler';
import { SceneManager } from './render/SceneManager';
import { SoundRig } from './render/SoundRig';
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

/** Which session-log tab is open. */
type LogTab = 'scramble' | 'history' | 'solves';

const LOG_TAB_ORDER: readonly LogTab[] = ['scramble', 'history', 'solves'];

const SPEED_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
  { value: 'instant', label: 'Instant' },
] as const;

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<CubeController | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const soundRef = useRef<SoundRig | null>(null);
  const celebrationRef = useRef<CelebrationRig | null>(null);
  const cinemaRef = useRef<CinemaRig | null>(null);
  const historyRef = useRef<HTMLOListElement>(null);
  const logTabsRef = useRef<HTMLDivElement>(null);
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
  const [logTab, setLogTab] = useState<LogTab>('scramble');
  const [explodeOn, setExplodeOn] = useState(false);
  const [demoOn, setDemoOn] = useState(false);
  const demoLoopRef = useRef<DemoLoop | null>(null);
  const [recording, setRecording] = useState(false);
  const [captureReady, setCaptureReady] = useState(false);
  const captureRef = useRef<CaptureManager | null>(null);
  const introPlayedRef = useRef(false);

  // The sound rig reads this at call time, so toggling the setting in the
  // panel takes effect without re-creating the rig.
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new SceneManager(container);
    const controller = new CubeController();
    setOsReducedMotion(prefersReducedMotion());

    controller.attach(scene);
    controller.renderer.setFrameSource(scene);
    const unsubscribe = controller.subscribe(setSnapshot);
    setSnapshot(controller.snapshot());

    // Audio must be created inside a user gesture; the rig is idempotent and
    // stays silent until then. Capture phase on window is required: sticker
    // clicks stop propagation in the container's capture phase, so a
    // bubble-phase window listener would never see them.
    const sound = new SoundRig(() => settingsRef.current.sound);
    soundRef.current = sound;
    const unlockSound = () => sound.unlock();
    window.addEventListener('pointerdown', unlockSound, { once: true, capture: true });

    // Solve burst: one rig per mount, triggered from the justSolved branch;
    // it registers its frame hook only while a burst is live.
    const celebration = new CelebrationRig(scene.scene, controller.renderer, scene);
    celebrationRef.current = celebration;

    // Cinematic orbit rig for demo mode (M7); idle until setActive(true).
    const cinema = new CinemaRig(scene, {
      reducedMotion: () => settingsRef.current.forceReducedMotion,
    });
    cinemaRef.current = cinema;

    // Self-solving demo loop (pure state machine; App owns the wiring).
    const demoLoop = new DemoLoop(controller);
    demoLoopRef.current = demoLoop;

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
      window.removeEventListener('pointerdown', unlockSound, true);
      sound.dispose();
      soundRef.current = null;
      celebration.dispose();
      celebrationRef.current = null;
      cinema.dispose();
      cinemaRef.current = null;
      demoLoop.stop();
      demoLoopRef.current = null;
      captureRef.current?.dispose();
      captureRef.current = null;
      pointerTurn.dispose();
      unsubscribe();
      controller.renderer.setFrameSource(null);
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

  // One-time assembly flight: skipped when motion is reduced or instant so
  // the cube just appears. Guarded for StrictMode's double-mount. A demo
  // autostart (?demo=1) skips the intro so the loop begins on a clean cube.
  useEffect(() => {
    if (!sceneReady || introPlayedRef.current) return;
    introPlayedRef.current = true;
    const autostart =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('demo') === '1';
    if (autostart) return;
    if (!reducedMotion && settings.animationSpeed !== 'instant') {
      controllerRef.current?.renderer.beginIntro(1.2);
    }
  }, [sceneReady, reducedMotion, settings.animationSpeed]);

  // ?demo=1 autostarts once scene-ready (after the intro decision above).
  useEffect(() => {
    if (!sceneReady) return;
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('demo') !== '1') return;
    if (demoLoopRef.current?.state !== 'off') return;
    demoLoopRef.current?.start();
    cinemaRef.current?.setActive(true);
    setDemoOn(true);
  }, [sceneReady]);

  // Capture support is feature-detected once the scene exists; the Record
  // button stays hidden entirely when unsupported. Deferred a frame so the
  // state update never fires synchronously inside the scene-ready effect.
  useEffect(() => {
    if (!sceneReady) return;
    const frame = requestAnimationFrame(() => setCaptureReady(CaptureManager.supported()));
    return () => cancelAnimationFrame(frame);
  }, [sceneReady]);

  useEffect(() => {
    saveSettings(safeStorage(), settings);
  }, [settings]);

  useEffect(() => {
    saveSidebarOpen(safeStorage(), sidebarOpen);
  }, [sidebarOpen]);

  const stopDemo = useCallback(() => {
    const loop = demoLoopRef.current;
    if (!loop || loop.state === 'off') return;
    loop.stop();
    cinemaRef.current?.setActive(false);
    setDemoOn(false);
  }, []);

  const playMove = useCallback(
    (face: MoveFace, turns: 1 | 2 | 3) => {
      stopDemo();
      controllerRef.current?.enqueue({ face, turns });
    },
    [stopDemo],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      soundRef.current?.unlock();
      if (solvingRef.current) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toUpperCase();
      if (!MOVE_FACES.includes(key as MoveFace)) return;
      event.preventDefault();
      // Move keys behave exactly like the on-screen pads: they stop demo.
      stopDemo();
      controllerRef.current?.enqueue({ face: key as MoveFace, turns: event.shiftKey ? 3 : 1 });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stopDemo]);

  // Stage tap stops the demo. Capture phase is required: sticker clicks
  // stop propagation in the container's capture phase, so a bubble-phase
  // listener would never see them.
  useEffect(() => {
    if (!demoOn) return;
    const stage = containerRef.current?.closest('main.stage');
    if (!stage) return;
    const onStagePointerDown = () => stopDemo();
    stage.addEventListener('pointerdown', onStagePointerDown, { capture: true });
    return () => stage.removeEventListener('pointerdown', onStagePointerDown, { capture: true });
  }, [demoOn, stopDemo, sceneReady]);
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

  // Sound observations: the controller stays sound-agnostic; App watches the
  // snapshot streams that every turn source feeds.
  const playedSoundRef = useRef({ history: 0, solveDone: 0 });
  useEffect(() => {
    const playedHistory = snapshot?.history.length ?? 0;
    const playedSolveDone = snapshot?.solveDone ?? 0;
    const previous = playedSoundRef.current;
    if (playedHistory > previous.history) soundRef.current?.click(0.7);
    else if (playedSolveDone > previous.solveDone) soundRef.current?.click(0.45);
    playedSoundRef.current = { history: playedHistory, solveDone: playedSolveDone };
  }, [snapshot]);

  const scrambleSoundRef = useRef(0);
  const scrambleContentRef = useRef('');
  useEffect(() => {
    const scrambleLength = snapshot?.scramble.length ?? 0;
    const content = snapshot ? formatSequence(snapshot.scramble) : '';
    if (scrambleSoundRef.current === 0 && scrambleLength > 0) soundRef.current?.whoosh();
    else if (content !== scrambleContentRef.current && scrambleLength > 0 && demoOn) {
      // Demo cycles 2+ would otherwise be silent until the chime: the length
      // never returns to 0 between loops, so retrigger on content change.
      soundRef.current?.whoosh();
    }
    scrambleSoundRef.current = scrambleLength;
    scrambleContentRef.current = content;
  }, [snapshot, demoOn]);

  useEffect(() => {
    if (!justSolved) return;
    soundRef.current?.chime();
    if (!reducedMotion) celebrationRef.current?.trigger();
  }, [justSolved, reducedMotion]);

  // Roving focus for the log tab row: arrows move both selection and focus,
  // per the ARIA tabs pattern.
  const onLogTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const current = LOG_TAB_ORDER.indexOf(logTab);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % LOG_TAB_ORDER.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + LOG_TAB_ORDER.length) % LOG_TAB_ORDER.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = LOG_TAB_ORDER.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setLogTab(LOG_TAB_ORDER[next]);
    requestAnimationFrame(() => {
      logTabsRef.current
        ?.querySelector<HTMLButtonElement>(`#tab-${LOG_TAB_ORDER[next]}`)
        ?.focus();
    });
  };

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
              <label className="settings-option">
                <input
                  type="checkbox"
                  checked={settings.sound}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, sound: event.target.checked }))
                  }
                />
                <span>Sound</span>
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
            {!autoSolved && stats?.latest
              ? `Solved · ${formatTime(stats.latest.timeMs)}`
              : 'Solved'}
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
        <div className="hero-timer">
          <div className="hero-meta">
            <span>{demoOn ? 'Demo' : PHASE_LABEL[phase]}</span>
            {recording && (
              <span className="hero-rec" aria-hidden="true">
                Rec
              </span>
            )}
            {phase === 'running' && !demoOn && (
              <span className="hero-run" aria-hidden="true">
                Running
              </span>
            )}
          </div>
          <span
            className={`hero-time${phase === 'running' || phase === 'solving' ? ' is-active' : ''}`}
            role="timer"
            aria-label={`Elapsed time ${formatTime(elapsed)}`}
          >
            {formatTime(elapsed)}
          </span>
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
        </div>

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

        <div className="action-groups">
          <div className="action-group">
            <p className="action-group-label">Session</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                stopDemo();
                void controller?.solveOptimally();
              }}
              disabled={!snapshot?.canSolveOptimally}
            >
              Optimal solve
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopDemo();
                void controller?.scrambleOptimally();
              }}
              disabled={solving}
            >
              Scramble
            </button>
            <button
              type="button"
              className={`btn${solving ? ' btn-danger' : ''}`}
              onClick={() => {
                if (solving) controller?.cancelSolve();
                else {
                  stopDemo();
                  controller?.solve();
                }
              }}
              disabled={!solving && !snapshot?.canSolve}
            >
              {solving ? 'Cancel' : 'Replay'}
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={demoOn}
              onClick={() => {
                if (demoOn) {
                  stopDemo();
                  return;
                }
                demoLoopRef.current?.start();
                cinemaRef.current?.setActive(true);
                setDemoOn(true);
              }}
            >
              Demo
            </button>
          </div>
          <div className="action-group">
            <p className="action-group-label">Edit</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopDemo();
                controller?.undo();
              }}
              disabled={solving || !snapshot?.canUndo}
            >
              Undo
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopDemo();
                controller?.redo();
              }}
              disabled={solving || !snapshot?.canRedo}
            >
              Redo
            </button>
          </div>
          <div className="action-group">
            <p className="action-group-label">Device</p>
            {captureReady && (
              <button
                type="button"
                className="btn"
                aria-pressed={recording}
                onClick={() => {
                  // A Record click is a user gesture: unlock sound first so
                  // the muxed audio track exists even with no prior input.
                  soundRef.current?.unlock();
                  const scene = sceneRef.current;
                  if (!scene) return;
                  if (recording) {
                    captureRef.current?.stop();
                    setRecording(false);
                    return;
                  }
                  const canvas = scene.renderer.domElement;
                  const manager = new CaptureManager(canvas, soundRef.current?.audioTrack ?? null);
                  manager.onSaved = (blob, extension) => {
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `cube3-clip.${extension}`;
                    document.body.appendChild(anchor);
                    anchor.click();
                    anchor.remove();
                    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
                  };
                  captureRef.current?.dispose();
                  captureRef.current = manager;
                  if (manager.start()) setRecording(true);
                }}
              >
                {recording ? 'Stop' : 'Record'}
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() => {
                stopDemo();
                sceneRef.current?.resetView(reducedMotion);
              }}
            >
              Reset view
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={explodeOn}
              onClick={() => {
                stopDemo();
                const next = !explodeOn;
                setExplodeOn(next);
                controller?.renderer.setExplode(next ? 1 : 0, reducedMotion);
              }}
            >
              Exploded
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                stopDemo();
                controller?.reset();
              }}
            >
              Reset cube
            </button>
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-section-label" aria-hidden="true">
            <span>Moves — face</span>
            <span>Hold Shift to reverse</span>
          </div>
          <div className="moves" role="group" aria-label="Face turns">
            {FACE_LETTERS.map((face) => (
              <MoveGroup key={face} face={face} disabled={solving} onPlay={playMove} />
            ))}
          </div>
        </div>

        <div className="panel-section">
          <div className="panel-section-label" aria-hidden="true">
            <span>Moves — slice</span>
            <span>M · E · S</span>
          </div>
          <div className="moves" role="group" aria-label="Middle-slice turns">
            {SLICE_LETTERS.map((slice) => (
              <MoveGroup key={slice} face={slice} disabled={solving} onPlay={playMove} />
            ))}
          </div>
        </div>

        <div
          className="log-tabs"
          role="tablist"
          aria-label="Session log"
          ref={logTabsRef}
          onKeyDown={onLogTabKeyDown}
        >
          <button
            type="button"
            role="tab"
            id="tab-scramble"
            aria-selected={logTab === 'scramble'}
            aria-controls="panel-scramble"
            tabIndex={logTab === 'scramble' ? 0 : -1}
            className={`log-tab${logTab === 'scramble' ? ' is-active' : ''}`}
            onClick={() => setLogTab('scramble')}
          >
            Scramble
          </button>
          <button
            type="button"
            role="tab"
            id="tab-history"
            aria-selected={logTab === 'history'}
            aria-controls="panel-history"
            tabIndex={logTab === 'history' ? 0 : -1}
            className={`log-tab${logTab === 'history' ? ' is-active' : ''}`}
            onClick={() => setLogTab('history')}
          >
            History · {historyLength}
          </button>
          <button
            type="button"
            role="tab"
            id="tab-solves"
            aria-selected={logTab === 'solves'}
            aria-controls="panel-solves"
            tabIndex={logTab === 'solves' ? 0 : -1}
            className={`log-tab${logTab === 'solves' ? ' is-active' : ''}`}
            onClick={() => setLogTab('solves')}
          >
            Solves · {stats?.count ?? 0}
          </button>
        </div>

        {logTab === 'scramble' && (
          <div className="log-panel" role="tabpanel" id="panel-scramble" aria-labelledby="tab-scramble">
            <div className="log-panel-head">
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
            <p className={`sequence${scramble.length === 0 ? ' is-empty' : ''}`}>
              {scramble.length > 0 ? formatSequence(scramble) : 'Press Scramble to generate one.'}
            </p>
          </div>
        )}

        {logTab === 'history' && (
          <div className="log-panel" role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            {history.length === 0 ? (
              <p className="sequence is-empty">No moves yet.</p>
            ) : (
              <ol className="history" ref={historyRef}>
                {history.map((move, index) => (
                  <li
                    key={`${index}-${formatMove(move)}`}
                    className={`history-move${index === history.length - 1 ? ' is-latest' : ''}`}
                  >
                    {formatMove(move)}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {logTab === 'solves' && (
          <div className="log-panel" role="tabpanel" id="panel-solves" aria-labelledby="tab-solves">
            <div className="log-panel-head">
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
              <ol className="solves">
                {stats.recent.slice(0, 8).map((record) => (
                  <li key={record.at} className="solve-row">
                    <span className="solve-time">{formatTime(record.timeMs)}</span>
                    <span className="solve-moves">{record.moves} moves</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sequence is-empty">Solve a scramble to record a time.</p>
            )}
          </div>
        )}

        <p className="keyboard-hint">
          Keyboard: <kbd>U</kbd> <kbd>D</kbd> <kbd>L</kbd> <kbd>R</kbd> <kbd>F</kbd>{' '}
          <kbd>B</kbd> to turn a face, <kbd>M</kbd> <kbd>E</kbd> <kbd>S</kbd> a middle
          slice, hold <kbd>Shift</kbd> to reverse. The clock starts on your first turn
          after a scramble.
        </p>
      </section>
    </div>
  );
}
