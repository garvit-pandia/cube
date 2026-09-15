# SHOWCASE UPDATE — Implementation Handoff

You are implementing this plan **from scratch, in a fresh session**. Everything
you need is in this file plus `AGENTS.md`. You do not need the conversation
that produced it. Follow milestones **in order**; each one is independently
shippable and must end green. Do not redesign the plan; if something is
impossible as written, stop and tell the user what conflicts.

Status: **IN PROGRESS — M1 + M2 committed, M3 half-applied in the working tree.**
See "Progress log & overnight handoff" at the bottom of this file before
touching anything; it records the exact commit hashes, the dirty-tree state,
the locked user decisions, and environment gotchas discovered on the way.

---

## 0. Project facts (memorize before typing)

| Fact | Value |
|---|---|
| Repo | `~/projects2/cube3` — browser 3×3 Rubik's cube sim, React 19 + three.js, no backend |
| Dev server | `npm run dev` → `http://localhost:5179`, `strictPort` (owned port; reuse a running one, never kill) |
| Typecheck | `npx tsc -b` (must be silent) |
| Lint | `npm run lint` (oxlint, cwd, no path arg — 0 warnings/errors required) |
| Unit tests | `npm run test` (vitest run, single pass). 159 tests / 7 suites — all must stay green |
| E2E | `npm run test:e2e` (Playwright, reuses a running dev server; suites set `controller.animationScale = 0.001` themselves). 11 tests — all must stay green |
| Build | `npm run build` (the >500 kB chunk warning is expected — three.js — do not "fix" it) |
| Stale-module check | WSL2 serves stale modules under native watching: after edits, `curl -s http://localhost:5179/src/<File>.ts | grep <new-symbol>` before doubting your code |

**Hard do-not-touch list:**

- `tsconfig.json` — solution-style container; editing it breaks the build.
- `src/cube/min2phase.js` — vendored third-party solver; never reformat/lint it.
- `src/cube/*` and `src/session/*` — **zero changes, zero new imports** in this
  whole project. Every feature lives in `src/render/*` or `src/App.tsx` /
  new `src/app/*` modules.
- `PORT-REGISTRY.md` (in `~/projects2/`) — 5179 is cube3's; never bind or kill
  other owners' ports.
- No new npm dependencies. three@0.180 + browser APIs cover everything here.

**TypeScript rules (TS 6):** `strict` is ON without being written; also
`noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax` (use `import type` for type-only imports),
`erasableSyntaxOnly` (**no `enum`, no `namespace`, no parameter properties**).
Style: PascalCase class modules, lowercase helper modules, `interface` for data
carriers, `type` for unions, `readonly` on interface fields and array params,
explicit `import { describe, expect, it } from 'vitest'` in tests.

**Invariants you must not break (from AGENTS.md, condensed):**

1. Integer state is the only truth; meshes mirror it (`sync` snaps, never the
   reverse). Floats never enter state.
2. `CubeRenderer` invariant: `sync()` writes exact transforms from state;
   `setLayerRotation()` composes temporary transforms; base transforms
   (`basePosition`/`baseQuaternion`) are never mutated by animation.
3. Auto-solve paths (`solve`, `solveOptimally`, and therefore demo mode) use
   `record: false` internally already: no `history` entries, no session record,
   clock frozen, `cancelSolve()` restores the prior phase. Your demo loop just
   calls these — do not enqueue recordable moves itself.
4. `justSolved` / `autoSolved` snapshot flags are **one-shot**: consumed by the
   snapshot that carries them. App already handles them — hook celebrations
   there.
5. `PCFShadowMap` + `shadow.radius = 14` are deliberate. Don't touch shadows.
6. User camera takeover is respected (`userHasMovedCamera` in SceneManager).
7. The sticker-drag handler never toggles `controls.enabled`; **the cinema rig
   is a different, explicit camera-owner mode and may** disable/restore
   `controls.enabled` (document this in AGENTS.md at the end).

**Reduced motion:** everything animated here must no-op or jump instantly when
`reducedMotion` is true (`settings.forceReducedMotion || prefersReducedMotion()`)
or when `settings.animationSpeed === 'instant'`. The App already computes
`reducedMotion`.

---

## 1. Current code — the exact facts you build on

### 1.1 `CubeController` public surface (`src/app/CubeController.ts`)

```ts
export type SolvePhase = 'idle' | 'ready' | 'running' | 'solving' | 'done';

export interface CubeSnapshot {
  readonly history: readonly Move[];
  readonly moveCount: number;
  readonly solved: boolean;
  readonly busy: boolean;            // true while a queued turn animates
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly latest: Move | null;
  readonly scramble: readonly Move[];
  readonly phase: SolvePhase;
  readonly elapsedMs: number;
  readonly stats: SolveStats;
  readonly justSolved: boolean;      // one-shot
  readonly autoSolved: boolean;      // one-shot
  readonly solving: boolean;         // auto-solve running (optimal or replay)
  readonly solveTotal: number;
  readonly solveDone: number;
  readonly canSolve: boolean;
  readonly canSolveOptimally: boolean;
}
```

Public members you will use (all verified present):

- `readonly state: CubeState`, `readonly renderer: CubeRenderer` — **the
  renderer instance lives on the controller**; reach it as
  `controller.renderer`.
- `attach(scene: SceneManager)`, `subscribe(fn) → unsubscribe`,
  `snapshot(): CubeSnapshot`
- `enqueue({ face, turns })`, `enqueueAll(moves)`
- `scrambleOptimally(length = 22): Promise<Move[]>` — enqueues record:false
  scramble turns
- `solveOptimally(): Promise<Move[] | null>`, `solve()`, `cancelSolve()`
- `undo()`, `redo()`, `reset()`, `clearSession()`
- `stickerInfo(cubeletId, stickerIndex)`, `canDrag(): boolean`,
  `get elapsed()`, settable `animationScale`

Queue-drain condition: **`snapshot().busy === false`**. Never poll `requestAnimationFrame`
for this; App already re-renders on snapshots (subscribe).

### 1.2 `SceneManager` (`src/render/SceneManager.ts`) — relevant excerpt facts

- Owns `scene`, `camera` (PerspectiveCamera fov 42), `renderer`
  (pixelRatio ≤ 2, ACESFilmicToneMapping 0.98, SRGB), `controls` (OrbitControls,
  damping 0.075, pan off, polar clamp ±0.18).
- `CONTENT_CENTER = (0, -0.2, 0)`, `CONTENT_RADIUS = 2.62`, `FLOOR_Y = -1.88`.
- `onBeforeRender: ((deltaSeconds, elapsedSeconds) => void) | null` — single
  hook, **owned by `CubeController.attach`**. tick() order: advance reset tween
  → `onBeforeRender?.(delta, elapsed)` → `controls.update()` → render.
- `resetView(reducedMotion)`: flushes controls damping with one
  `enableDamping=false; update();` cycle, then tweens camera to
  `defaultPosition`/`CONTENT_CENTER` over 0.6 s with cubic ease; while tweening
  `resetting = true`; sets `userHasMovedCamera = false` on completion. Controls
  listener sets `userHasMovedCamera = true` + cancels the tween on `'start'`.
- Environment: PMREM + `RoomEnvironment`, `scene.environmentIntensity = 0.5`.
- Lights: hemi 0.22, key dir 2.5 (shadow 2048, radius 14, bias -0.0004),
  fill 0.66, rim 0.62. Floor: shadow catcher + glow + contact decal.

### 1.3 `CubeRenderer` (`src/render/CubeRenderer.ts`) — the hook point

```ts
interface Slot {
  readonly group: THREE.Group;
  readonly basePosition: THREE.Vector3;
  baseQuaternion: THREE.Quaternion;
}
// slots: Map<number, Slot>;  overridden: number[];  object: THREE.Group
```

- `build(cubelets)` — per cubelet: Group → body mesh (`RoundedBoxGeometry`,
  `MeshStandardMaterial({ ...BODY_MATERIAL })`, cast+receive shadow) + sticker
  meshes (`MeshPhysicalMaterial({ ...STICKER_MATERIAL, color })`, receive
  shadow only). Ends with `sync(cubelets)`.
- `sync(cubelets, scratch?)` — writes `slot.basePosition` /
  `slot.baseQuaternion` from integer state, then **copies** them into
  `slot.group.position/quaternion`; clears `overridden`. This is the
  authoritative snap called after every completed turn.
- `setLayerRotation(axis, ids, angle)` — `group.position =
  basePosition.applyQuaternion(q)`; `group.quaternion = q * baseQuaternion`;
  tracks `overridden`. `clearLayerRotation()` restores.
- Sticker mesh names: `sticker-<cubeletId>-<index>`; body/sticker meshes carry
  `userData.cubeletId`. Sticker world transforms can be read via
  `slot.group` + each sticker's local `position/quaternion`.
- `materials: Map<string, THREE.MeshPhysicalMaterial>` shared per color.

**Consequence for explode/intro (M4):** all three of `sync`,
`setLayerRotation`, `clearLayerRotation` end with the same "copy base → group"
step. Your offsets must be composed **inside all three**, immediately after
each copy, so the post-turn snap re-applies them instead of erasing them.

### 1.4 `palette.ts` (`src/render/palette.ts`) — current values (M3 tunes these)

```ts
BODY_COLOR = '#131316';  SPACING = 1;
BODY_SIZE = 0.955;  BODY_RADIUS = 0.085;
STICKER_SIZE = 0.78;  STICKER_THICKNESS = 0.035;  STICKER_RADIUS = 0.055;
STICKER_OFFSET = BODY_SIZE / 2 - STICKER_THICKNESS / 2 + 0.017;
BODY_MATERIAL     = { color: BODY_COLOR, roughness: 0.42, metalness: 0 };
STICKER_MATERIAL  = { roughness: 0.22, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.14 };
```

`CUBE_COLORS` / `FACE_NAMES` are re-exported from `../cube/palette` (do not
duplicate them).

### 1.5 `settings.ts` (`src/app/settings.ts`) — current shape

```ts
export interface Settings {
  readonly animationSpeed: 'normal' | 'fast' | 'instant';
  readonly forceReducedMotion: boolean;
}
export const DEFAULT_SETTINGS: Settings = { animationSpeed: 'normal', forceReducedMotion: false };
// STORAGE_KEY 'cube3:settings'; loadSettings is defensive per-field with
// try/catch → DEFAULT_SETTINGS (house style: corrupt payload never throws).
```

`prefersReducedMotion()` uses `matchMedia` in a try/catch. Tests:
`src/app/settings.test.ts` (16 cases) — extend, don't rewrite.

### 1.6 `App.tsx` wiring facts

- Mount effect: `new SceneManager(container)` → `new CubeController()` →
  `controller.attach(scene)` → `subscribe(setSnapshot)` → `PointerTurnHandler`
  → `__cube3` seam (DEV only: `{ controller, scene, pause, resume }`) →
  strict teardown (StrictMode double-mounts; keep setup/teardown symmetric).
- `reducedMotion = settings.forceReducedMotion || osReducedMotion`.
- Settings effect: `controller.animationScale = reducedMotion ? 0.001 : animationScaleFor(settings)`.
- `phase` effect: while `phase === 'running'`, rAF-polls
  `controller.elapsed` into `runningMs`.
- `justSolved`/`autoSolved` are read off the snapshot each render; the solved
  stamp element is `.solved-flash` inside `main.stage.is-celebrating`; the
  screen-reader announcement is a separate `sr-only` `role="status"` — **leave
  the SR paragraph alone**, upgrade only the visual stamp.
- Panel structure (post-Swiss-redesign): `.hero-timer` (`.hero-meta`, `.hero-time`),
  `.stats`, `.action-groups` → `.action-group` ×3 (`Session` / `Edit` /
  `Device`) with `.action-group-label` and `.btn` rows (`.btn-primary` on
  Optimal solve, `.btn-danger` on Reset cube / Cancel), `.panel-section` ×2 for
  move pads, `.log-tabs` `role="tablist"`, `.log-panel`, `.keyboard-hint`.
- e2e locates only `.viewport canvas` and drives the controller via
  `window.__cube3.controller` — DOM changes in the panel are safe; **button
  labels `Scramble`, `Replay`, `Optimal solve`, `Undo`, `Redo`, `Reset view`,
  `Reset cube` must not change.**

---

## 2. Milestones

Execute in order. Each milestone lists: goal → files → spec → acceptance →
commit message. Run the full verification after each:

```
npx tsc -b && npm run lint && npm run test && npm run test:e2e
```

---

### M1 — Frame-hook list + `sound` setting *(foundation)*

**Goal:** multiple render-frame consumers without touching
`CubeController.attach`, plus the persisted `sound` setting.

**Modify `src/render/SceneManager.ts`:**

```ts
private frameHooks = new Set<(delta: number, elapsed: number) => void>();

/** Register a per-frame callback. Returns an unregister function. */
registerFrameHook(fn: (delta: number, elapsed: number) => void): () => void {
  this.frameHooks.add(fn);
  return () => this.frameHooks.delete(fn);
}
```

- In `tick()`, keep the existing `onBeforeRender?.(delta, ...)` call **and**
  iterate `frameHooks` with the same arguments (before `controls.update()`).
- In `dispose()`, `this.frameHooks.clear()`.

**Modify `src/app/settings.ts`:** add `readonly sound: boolean` to `Settings`,
`sound: true` to `DEFAULT_SETTINGS`, and per-field validation in `loadSettings`
(`typeof candidate.sound === 'boolean'`, else default). Nothing else changes.

**Modify `src/App.tsx`:** "Sound" checkbox in the settings panel, same pattern
as the existing "Reduce motion" checkbox (`settings-option` class,
`accent-color` handled by CSS).

**Modify `src/app/settings.test.ts`:** extend the round-trip case (sound
persists), the corrupt-payload case (`sound: 'yes'` → falls back to `true`),
and the defaults case. Match existing test style — no new suite.

**Acceptance:**
- [ ] `CubeController.attach` unchanged; pause/resume via `__cube3` still works
- [ ] Settings round-trip includes `sound`; corrupt JSON → defaults
- [ ] Full verification green

**Commit:** `feat(app): frame hook list and persisted sound setting`

---

### M2 — Sound design *(small)*

**Create `src/render/SoundRig.ts`.** Render-layer module → **no unit tests**
(repo rule), all failures swallowed (never break a solve):

```ts
export class SoundRig {
  constructor(private readonly isEnabled: () => boolean) {}
  /** Lazily create the AudioContext; safe to call repeatedly. Call from a
      user-gesture handler (autoplay policy). If construction throws, the rig
      stays dead and every method no-ops forever. */
  unlock(): void;
  /** Short mechanical turn click. intensity 0..1 (default 0.6). */
  click(intensity?: number): void;
  /** ~300 ms filtered-noise sweep for scramble starts. */
  whoosh(): void;
  /** Solve finale: stacked detuned sines, slow exponential decay. */
  chime(): void;
  /** Audio track for the clip recorder (M8); null until unlock() succeeds. */
  get audioTrack(): MediaStreamTrack | null;
  dispose(): void;  // close context, disconnect nodes
}
```

- Graph: master `GainNode` → `ctx.destination` **and** →
  `MediaStreamAudioDestinationNode` (kept for M8). `isEnabled()` false or
  context state `'suspended'` (after resume attempt fails) → skip.
- `click`: 6–10 ms white-noise buffer through BiquadFilter
  (bandpass, 1800–2600 Hz with ±10% random jitter, Q ≈ 1.2) + a 55 ms
  140 Hz sine thump, exp ramps. Jitter the level ±15% so bursts of clicks
  sound mechanical.
- `whoosh`: 300 ms noise, bandpass sweep 300 → 2200 Hz.
- `chime`: sines at C5/E5/G5/C6, staggered 30 ms, detune ±4 cents, 1.2 s
  exp decay through a shared gain.
- All node params via `setValueAtTime` + `exponentialRampToValueAtTime`
  (never linear to 0 — use `0.0001`).

**Wire in `App.tsx` (observation route — do NOT modify CubeController):**

- One `SoundRig` per mount, `useRef`; `unlock()` on first `pointerdown`/
  `keydown` (once listener, `window`, `{ once: true}` is not enough — call
  `unlock()` inside the existing keydown handler and add a one-shot
  pointerdown listener; both cheap and idempotent).
- **Clicks:** track `snapshot.solveDone` and `history.length`; when either
  increments vs a ref of the previous values → `rig.click(0.5 + ...)`
  (history increments are user turns — intensity 0.7; solveDone increments
  are auto-solve turns — intensity 0.45 for a softer machine-gun feel).
- **Whoosh:** when `scramble.length` transitions `0 → >0`.
- **Chime:** inside the existing `justSolved`/`autoSolved` branch where
  `.is-celebrating` is applied.
- Do not fire sounds while `reducedMotion` is true? — no: sound is orthogonal
  to motion; gate only on the `sound` setting (`isEnabled: () => settings.sound`).

**Acceptance:**
- [ ] No console errors; sounds play after first interaction; silent before
- [ ] Turning sound off in settings silences instantly
- [ ] 159+ unit tests still green (rig untested by design)

**Commit:** `feat(render): synthesized turn, scramble and solve sounds`

---

### M3 — Premium look pass *(small-medium, screenshot-driven)*

**Goal:** make the cube read as glossy showroom tiles on camera. Scene
lighting/env already exist — this is constants tuning only.

**Modify `src/render/palette.ts`** (and `SceneManager` env exposure only if the
A/B says so). Procedure — do not skip the A/B:

1. Add a **temporary** DEV-only camera lock: in `App.tsx`, if
   `new URLSearchParams(location.search).has('ab')`, call
   `scene.resetView(reducedMotion)` after ready and skip (this is just to
   normalize screenshots). Screenshot with Playwright at 1440×900
   (deviceScaleFactor 2) before changing anything → save as "before".
   Capture **two camera stations and one motion frame** per candidate — the
   default 3/4 view, an elevated near-top-down view (clearcoat/env blowouts
   show from above first), and one frame mid-turn (moving speculars across
   the faces). Judge on all three, not the idle view alone.
2. Apply candidate set A: stickers `clearcoat: 1.0`,
   `clearcoatRoughness: 0.08`, `roughness: 0.24`; body `roughness: 0.55`;
   `scene.environmentIntensity 0.5 → 0.7`. Screenshot → "A".
3. Candidate set B: A + `envMapIntensity: 1.15` on sticker materials,
   exposure 1.0. Screenshot → "B".
4. Pick the best (with the user if possible; otherwise choose B if stickers
   show crisp highlights without blowing out, else A). **Delete the `?ab`
   param code** before committing.

Guardrails: don't touch shadow params (invariant #10); don't add
postprocessing/bloom; keep changes confined to `palette.ts` +
`environmentIntensity`/`exposure`.

**Acceptance:**
- [ ] Before/A/B screenshots saved to `/tmp/opencode/cube3-design/`
- [ ] `?ab` code removed from the final commit
- [ ] Full verification green (pure param change, but run it anyway)

**Commit:** `style(render): premium sticker and environment tuning`

---

### M4 — Exploded view + intro assembly *(medium — shared mechanics)*

**Goal:** a toggle that eases the 26 cubelets apart into an orbitable lattice,
and a one-time assembly animation on load. Both are **derived offsets** —
`basePosition`/`baseQuaternion` are never mutated (invariant: extends #12).

**Modify `src/render/CubeRenderer.ts`:**

```ts
private explode = 0;                    // 0..1 current
private explodeTarget = 0;              // 0..1 tween target
private intro: {
  offsets: Map<number, { pos: THREE.Vector3; quat: THREE.Quaternion; delay: number }>;
  elapsed: number;
  duration: number;
} | null = null;
private unregisterFrame: (() => void) | null = null;
```

- `setExplode(target: number, immediate = false)` — clamps target to [0,1];
  `immediate` also snaps current (used for reduced motion / instant speed).
- `beginIntro(duration = 1.2)` — for each slot compute
  `dir = basePosition.clone().normalize()` (zero-length → skip intro for the
  centre cubie), scatter distance `2.5 + rand*0.8` along `dir`, random scatter
  quaternion, `delay = 0.15 * (1 - dir.y) + rand*0.1` (top layer lands last
  reads nicely — any deterministic-but-varied stagger is acceptable). Store
  per-slot; register the frame hook if not registered. **Scatter stays
  ≤ ~3.3 units from centre on purpose** — the key-light shadow frustum is
  ±3.4 orthographic; scattering farther makes cubelets pop in/out of shadow
  casting mid-intro.
- Frame hook (registered in `build()`, unregistered in `clear()` and
  `dispose()`; guard `unregisterFrame` double-call): advance explode toward
  target (`k += (target - k) * min(1, delta*6)` — exponential approach, snap
  when |Δ|<0.001); advance intro `elapsed += delta`, per-slot
  `t = clamp((elapsed - delay) / duration, 0..1)` with cubic ease-out; when
  all `t === 1`, null out intro.
- **Offset application — the critical part.** Add a private
  `applyVisualOffset(slot)` that composes onto `slot.group`:
  `group.position.copy(basePosition).addScaledVector(dir, explode * 1.4)`
  plus, while intro is active and `t < 1`, `lerp` from the intro scatter pos
  to the base pos by `ease(t)`, and premultiply the scatter quaternion
  slerped to identity by `ease(t)`. Then call `applyVisualOffset(slot)`
  at the end of **`sync`** (for every slot — replacing the bare copies),
  **`setLayerRotation`** (after the rotated copy), and
  **`clearLayerRotation`** (after the restore copy). The rotated-copy lines in
  `setLayerRotation` still start from `basePosition`; just run
  `applyVisualOffset` after them, applying the explode offset to the already
  rotated position (offset direction from the *rotated* base position is fine
  and looks better — document your choice in a comment).
- `dispose()` must also null `intro` and reset explode fields.

**Modify `src/App.tsx`:**

- "Exploded" toggle button in the **Device** action group (between
  "Reset view" and "Reset cube"; label exactly `Exploded`,
  `aria-pressed={explodeOn}`); local state; on toggle:
  `controller.renderer.setExplode(on ? 1 : 0, reducedMotion)` — tween runs
  inside the renderer; the button is a pure state flip.
- Intro: once `sceneReady` is true, if `!reducedMotion &&
  settings.animationSpeed !== 'instant'`, call
  `controller.renderer.beginIntro(1.2)` once (guard with a ref so StrictMode
  double-mount doesn't replay it twice — replaying is acceptable but ugly;
  prefer the guard).
- No interaction gating: turns during explode/intro are safe (offsets compose);
  `canDrag` already guards queue-busy drags.

**Create `e2e/explode.e2e.ts`** (follow existing e2e style in `e2e/`): set
`animationScale = 0.001`, toggle the Exploded button **on**, play 3 moves via
`__cube3.controller.enqueue`, toggle it **off**, then run
`controller.solveOptimally()` and assert `controller.state.isSolved()` — that
is the actual no-drift property this milestone protects; `isSolved()` "still
behaving" after 3 moves would pass even with broken offsets. Also assert no
console errors; screenshot the exploded state to `/tmp/opencode/cube3-design/`.

**Acceptance:**
- [ ] Explode toggle tweens out and back; scramble/solve/undo visibly work
      while exploded
- [ ] After 20 explode-toggled moves, cube still solves correctly (no visual
      drift after the snap)
- [ ] Intro plays once on load; `?instant` speed / reduced motion skip it
- [ ] New e2e green; full verification green

**Commit:** `feat(render): exploded view toggle and intro assembly`

---

### M5 — Celebration 2.0 *(medium)*

**Goal:** replace the plain `Solved` text flash with 54 sticker-colored sparks
that burst, fall, and get re-absorbed, plus a typographic stats stamp.

**Create `src/render/CelebrationRig.ts`:**

```ts
export class CelebrationRig {
  constructor(scene: THREE.Scene, renderer: CubeRenderer) {}
  /** Spawns the burst if idle; cancels any prior burst first. Self-disposes
      after re-absorption (~1.6 s). */
  trigger(): void;
  dispose(): void;
}
```

- On `trigger()`: walk `CubeRenderer` slots; for each sticker mesh compute
  world position (slot group matrix × sticker local position) and read its
  material color (the shared `MeshPhysicalMaterial.color`) → 54 particles.
- Use `THREE.Points` + `BufferGeometry` (position, color, size attributes)
  with a small `PointsMaterial` (`vertexColors: true`, `size ≈ 0.09`,
  `transparent`, `depthWrite: false`) — simple is fine; upgrade to
  `InstancedMesh` only if Points look bad on camera.
- Motion: outward radial velocity (away from CONTENT_CENTER, magnitude
  2.5–4 u/s) + up bias 1–2 u/s; gravity −6 u/s²; drag `v *= exp(-1.8*dt)`;
  phase 1 (0–0.9 s) fly, phase 2 (0.9–1.6 s) ease positions back to their
  spawn points with cubic ease-in-out, then remove the Points from the scene
  and dispose geometry (self-cleanup; the rig object itself is reusable).
- Register its frame hook (M1 API) only while a burst is live.

**Modify `src/App.tsx`:**

- Instantiate one `CelebrationRig(scene, controller.renderer)` at mount;
  dispose at teardown. In the existing `justSolved &&` block (the one that
  renders `.solved-flash`), call `rig.trigger()` — but only when
  `!reducedMotion` (under reduced motion the stamp still shows, instantly).
- Upgrade the stamp markup: `.solved-flash` currently renders the text
  `Solved`. Change it to `Solved · {time}` where time comes from
  `stats?.latest ? formatTime(stats.latest.timeMs) : ''` (fallback: just
  `Solved`) — **but only when `!autoSolved`**. `stats.latest` is the last
  *recorded* (manual) solve and persists across auto-solves; showing it next
  to an auto-solve would quote a stale personal best. Auto-solve stamp is
  plain `Solved`. Keep `aria-hidden="true"` as-is (the separate sr-only
  announcement is the accessible channel). Sound: call the M2 `chime()` here.

**Modify `src/index.css`:** restyle `.solved-flash` into the stamp: big
tabular time, `color: var(--accent)` (orange), scale 0.94→1 + letter-spacing
ease-in animation, keep the existing fade keyframe shape. Keep the
`prefers-reduced-motion` override (instant, opacity 1).

**Create `e2e/celebration.e2e.ts`:** reuse the scramble→optimal-solve pattern
from `e2e/solve.e2e.ts`; after the solve resolves, assert no console errors and
grab a screenshot mid-celebration. (Don't assert particle counts — visual.)

**Acceptance:**
- [ ] Burst + re-absorption plays on user solve and auto-solve; consecutive
      rapid solves don't stack bursts (re-trigger cancels prior)
- [ ] Reduced motion: instant stamp, no particles, no errors
- [ ] New e2e green; full verification green

**Commit:** `feat(render): solve celebration particles and stats stamp`

---

### M6 — Cinematic camera rig *(medium)*

**Create `src/render/CinemaRig.ts`:**

```ts
export class CinemaRig {
  constructor(scene: SceneManager) {}
  /** Enter/exit cinema mode. Entering: stores controls state, sets
      controls.enabled = false (explicit camera-owner mode — allowed here,
      unlike the drag handler; add an AGENTS.md note at the end). Exiting:
      tweens back to defaultPosition/CONTENT_CENTER (reuse resetView's cubic
      ease + damping-flush pattern), then restores controls.enabled = true and
      controls.update(). Idempotent both ways. */
  setActive(active: boolean): void;
  get active(): boolean;
  dispose(): void;
}
```

- While active, each frame (own registered frame hook): orbit azimuth around
  `CONTENT_CENTER` at ~9°/s (full rev ≈ 40 s); polar = base ± 0.12 rad sine
  (period ≈ 13 s); distance = `frameDistance()` breathing 0.85→1.05 via slow
  sine (period ≈ 23 s). Compute the position directly
  (`Spherical → Vector3 + CONTENT_CENTER`), set `camera.position`,
  `controls.target.copy(CONTENT_CENTER)`, then `camera.lookAt(controls.target)`.
  **Do not call `controls.update()` while disabled** (it would fight the rig).
- Respect framing: recompute `frameDistance()` via a small public getter you
  add to SceneManager (`get framedDistance(): number`) — do not duplicate the
  math. If adding the getter feels invasive, an acceptable alternative is
  reading `controls.minDistance / 0.72` — prefer the getter.
- Reduced motion: `setActive(true)` still works but the rig holds a static
  pleasing angle (no orbit) — camera must not move on its own.
- Exit handoff is the same tween pattern `SceneManager.resetView` uses
  (damping flush first, 0.6 s cubic ease, `userHasMovedCamera = false` at end).

**Modify `src/App.tsx`:** one `CinemaRig(scene)` per mount; used by M7 (auto
on while demo active) — expose a ref. Standalone UI control for cinema is
**not** required in this milestone.

**Acceptance:**
- [ ] While active: controls dead, camera orbits smoothly, cube never clipped
      (polar/distance guards)
- [ ] On exit: camera returns exactly to the default framing; user can orbit
      again immediately
- [ ] Reduced motion: static angle, no drift
- [ ] Full verification green

**Commit:** `feat(render): cinematic orbit camera rig`

---

### M7 — Demo mode: the self-solving loop ⭐ *(small-medium)*

**Goal:** one toggle → scramble → optimal solve → celebration → rest → repeat,
forever, with cinema camera on. This is the recordable centerpiece.

**Create `src/app/DemoLoop.ts` — a PURE state machine** (no three.js, no DOM)
so it is unit-testable:

```ts
export type DemoState = 'off' | 'scrambling' | 'solving' | 'celebrating' | 'resting';

/** Minimal controller surface — lets tests inject fakes. */
export interface DemoControllerLike {
  snapshot(): CubeSnapshot;
  scrambleOptimally(length?: number): Promise<Move[]>;
  solveOptimally(): Promise<Move[] | null>;
  cancelSolve(): void;
}

export class DemoLoop {
  readonly state: DemoState = 'off';
  onTransition: ((state: DemoState) => void) | null = null;
  constructor(
    controller: DemoControllerLike,
    private readonly opts?: {
      restMs?: number;                                   // default 2500
      celebrateMs?: number;                              // default 1600
      pollMs?: number;                                   // default 50
      setTimer?: (fn: () => void, ms: number) => unknown;   // default setTimeout
      clearTimer?: (handle: unknown) => void;               // default clearTimeout
    },
  ) {}
  start(): void;   // no-op if already running
  stop(): void;    // cancelSolve() if mid-solve; clears timers; → 'off'
}
```

- Flow: `start()` → `scrambling`: fire `controller.scrambleOptimally()`; poll
  `snapshot().busy === false` every `pollMs` (injected timer) → `solving`:
  `controller.solveOptimally()`; poll busy === false → `celebrating` for
  `celebrateMs` (the App's own `justSolved` trigger handles visuals/sound —
  DemoLoop does not know about them) → `resting` for `restMs` → loop to
  `scrambling`. Every state change fires `onTransition` **after** assignment.
  **Both fired promises are guarded**: a rejection from `scrambleOptimally()`
  (solver chunk blocked) ends the loop at `'off'` exactly like a
  `solveOptimally()` rejection — no unhandled rejection, no throw.
- `stop()`: if `solving`/`scrambling` and a solve is in flight →
  `controller.cancelSolve()` (it already restores the prior phase —
  invariant #15); clear every pending timer; state `'off'`.
- No busy-wait, no rAF, no window access. `CubeSnapshot`/`Move` imported as
  **types only**.

**Create `src/app/DemoLoop.test.ts`** — new suite, explicit vitest imports,
fake controller (hand-written object with `snapshot()` returning a mutable
fixture and immediately-resolving promises):

- [ ] start → transitions scrambling→solving→celebrating→resting→scrambling
      (advance via injected fake timers; use `vi.useFakeTimers()`)
- [ ] stop during `solving` calls `cancelSolve` exactly once and lands `'off'`
- [ ] stop during `resting` clears the pending loop timer (no further
      transitions)
- [ ] `start()` while running is a no-op
- [ ] a controller whose `solveOptimally` rejects (solver failure) ends the
      loop at `'off'` without throwing
- [ ] a controller whose `scrambleOptimally` rejects ends the loop at `'off'`
      without throwing (same guarantee as the solve path)

**Modify `src/App.tsx`:**

- "Demo" toggle button in the **Session** action group (after "Replay"; label
  exactly `Demo`, `aria-pressed={demoOn}`).
- While demo is on: `cinemaRig.setActive(true)`; on stop/off:
  `setActive(false)`.
- User-gesture guard: while `demoOn`, a `pointerdown` on the stage element or
  any move keypress (the existing keydown handler) stops the loop. Add
  listeners when demo starts, remove when it stops. **The on-screen move pads
  stop it too** (route their clicks through the same stop — keyboard and
  pointer inputs must behave identically). Remember the capture-phase gotcha:
  the stage listener must be capture-phase or sticker clicks never reach it.
- Sound across cycles: M2's whoosh fires on scramble `0 → >0`, so demo
  cycles 2+ would be silent until the chime. In App, retrigger the whoosh
  when the **scramble sequence content changes** (compare the formatted
  sequence, not the length) — do this here, not by reopening M2.
- `hero-meta` shows `Demo` on the left while active (keep the phase label
  semantics; the right slot keeps its current content).
- `?demo=1`: at mount, if `new URLSearchParams(location.search).get('demo')
  === '1'`, start the loop once scene-ready (after the intro decision — skip
  intro when autostarting). Sound will stay silent until the first gesture
  (autoplay policy) — acceptable, note it in the PR.
- Demo + manual actions: all existing buttons keep working; if the user hits
  "Scramble" manually mid-demo, that's just extra queue turns — the loop
  tolerates it (busy-wait). Simpler and stricter alternative: stop the demo
  when any Session/Edit/Device button is clicked except the Demo toggle.
  **Implement the stricter version** (stop on any other action button).

**Acceptance:**
- [ ] Demo runs ≥3 loops unattended: scramble → solve → celebration → rest
- [ ] History/session unchanged after demo (solve a manual scramble after
      demo; times record as before — demo polluted nothing)
- [ ] Stop mid-solve restores prior phase (existing cancel behavior)
- [ ] Any action button stops the demo; stage tap stops it; move-pad clicks
      stop it
- [ ] `?demo=1` autostarts; unit suite green with the new cases; full
      verification green

**Create `e2e/demo.e2e.ts`** (the centerpiece needs browser coverage, unit
tests alone are not enough): set `animationScale = 0.001`; load with
`?demo=1`; assert the loop autostarts and the phase visibly progresses
scrambling → solving → (celebrating/resting) → scrambling again within a
generous timeout; assert `controls.enabled === false` while demo is on
(cinema owns the camera — M6 integration); then dispatch a stage
`pointerdown` and assert the demo stops, `controls.enabled` is restored, and
the phase returns to a non-solving state. No console errors throughout.

**Commit:** `feat(app): self-solving demo loop`

---

### M8 — Capture button *(small-medium — recommended add-on)*

**Create `src/app/CaptureManager.ts`:**

```ts
export class CaptureManager {
  static supported(): boolean;   // 'MediaRecorder' in window && canvas.captureStream exists
  constructor(canvas: HTMLCanvasElement, audioTrack: MediaStreamTrack | null) {}
  start(): boolean;              // false if unsupported/negotiation fails
  stop(): void;
  onSaved: ((blob: Blob, extension: string) => void) | null;
  dispose(): void;               // stop recorder/tracks if live
}
```

- `getDisplayMedia` is NOT used — this records **this app's own canvas** via
  `canvas.captureStream(60)`. Add the M2 audio track
  (`new MediaStream([videoTrack, audioTrack])` when present).
- Codec negotiation order: `video/webm;codecs=vp9` → `vp8` → `video/webm` →
  `video/mp4` (first `MediaRecorder.isTypeSupported` win; extension follows
  the chosen type). `videoBitsPerSecond: 8_000_000`.
- Hard cap 60 s (internal timer → auto `stop()`).
- No recorder APIs in unit tests (browser-only); keep the class thin.

**Modify `src/App.tsx`:**

- "Record" button in the **Device** group (before "Reset view"), label toggles
  `Record` / `Stop` (exact strings), `aria-pressed` while recording; hidden
  entirely when `CaptureManager.supported()` is false. **The Record click is a
  user gesture — call `soundRef.current?.unlock()` in its handler first**, so
  the muxed audio track exists even if the user never interacted with the page
  before recording. Note the limitation in code: toggling the sound setting
  *mid-recording* cannot join the live `MediaStream` — the track set is fixed
  at start; that is acceptable.
- While recording, `.hero-meta` gains a red pulsing dot + `REC` label (CSS
  reuse of `.hero-run` pattern with `--danger` color).
- `onSaved`: create an object URL, synthesize
  `<a download="cube3-clip.<ext>">` click, revoke the URL. Also fire
  `sound: 'click'`? No — keep silent.

**Acceptance:**
- [ ] In Chrome: record ~10 s of demo (with sound), stop → downloaded webm
      plays in a video tag / VLC
- [ ] Button hidden in unsupported browsers (feature-detect, no crash)
- [ ] Recording survives scene resize (stream follows canvas)
- [ ] Full verification green (no new unit tests; manual QA matrix: Chrome ✓,
      Firefox, Android Chrome — record findings in the PR)

**Commit:** `feat(app): one-click clip capture`

---

### M9 — Docs closeout *(mandatory, small)*

- **AGENTS.md**: add to Invariants — (a) cinema rig may toggle
  `controls.enabled` as an explicit camera-owner mode and must restore it
  verbatim; (b) explode/intro are derived visual offsets composed after the
  `sync` snap — base transforms are never written (extends #12); (c) demo mode
  only ever drives `record: false` paths (extends #14/#15); (d) SoundRig and
  CaptureManager are best-effort, must never throw into the solve path.
  Update the test-count line and the e2e list.
- **README.md**: feature-table rows for Demo mode, Exploded view, Sound,
  Capture, Celebration; note `?demo=1`.
- Full verification one last time; update the test-count numbers everywhere
  they appear.

**Commit:** `docs: showcase update in AGENTS and README`

---

## 3. Whole-project definition of done

- [ ] All milestones committed in order; working tree clean
- [ ] `npx tsc -b` + `npm run lint` + `npm run test` + `npm run test:e2e` all
      green at final HEAD
- [ ] Manual pass recorded in the PR: desktop demo loop ≥3 cycles, mobile
      (390×844) demo + stop-on-tap, reduced-motion pass, capture matrix
- [ ] 10-minute unattended demo run with no console errors and flat memory
- [ ] Screenshots at `/tmp/opencode/cube3-design/` (before/after M3, celebration
      mid-burst, exploded state, demo in progress)

## 4. When something fails

- Red `tsc`: read the error — TS 6 strict/noUnused rules catch most mistakes;
  never silence with `any` unless interoperating with three examples code.
- Tests fail after a visual change: unit tests never depended on render
  internals, so a failure means you touched logic — re-read the invariant list.
- E2E fails on dev server: it reuses the running server; if `EADDRINUSE`, read
  `~/projects2/PORT-REGISTRY.md` — 5179 is cube3's own row, reuse the running
  server, never kill it.
- Suspicious "my code doesn't run": run the stale-module curl check (§0).
- Anything in `src/cube` or `src/session` seems like it needs a change: stop —
  that's a plan conflict; report instead of improvising.

## 5. Explicitly out of scope

Bloom/postprocessing · smart-cube Bluetooth (cubing.js — separate track) ·
other puzzle sizes · cloud sync/accounts · new npm dependencies · changes to
`src/cube/*` or `src/session/*`.

---

## 6. Progress log & overnight handoff (updated live; read first)

| Milestone | State | Commit |
|---|---|---|
| M1 frame hooks + `sound` setting | ✅ done, verified green | `6b46466` |
| M2 SoundRig | ✅ done, verified green | `b9c8b43` |
| M3 premium look pass | 🔶 half-applied (see below) | — |
| M4–M9 | ⬜ not started | — |

### M3 dirty-tree state (intentional, do not revert)

- `src/render/palette.ts` + `src/render/SceneManager.ts` carry **candidate A**
  (stickers `clearcoat 1.0` / `clearcoatRoughness 0.08` / `roughness 0.24`,
  body `roughness 0.55`, `environmentIntensity 0.7`) — uncommitted, per the
  M3 procedure. `before.png` is already saved.
- `src/App.tsx` carries the **temporary DEV-only `?ab` camera lock**. It must
  be **deleted before the M3 commit**.
- Screenshots dir: `/tmp/opencode/cube3-design/` (`before.png`,
  `screenshot.mjs` — the 1440×900 @2x Playwright shot helper, run as
  `node /tmp/opencode/cube3-design/screenshot.mjs <name>` from the repo root;
  it loads `http://localhost:5179/?ab`, waits for `.viewport.is-ready` +1.5 s).
- Remaining M3 steps: shot `A` → apply candidate B (A + `envMapIntensity 1.15`
  on `STICKER_MATERIAL`, `toneMappingExposure 1.0`) → shot `B` → pick per the
  §M3 rule (B unless highlights blow out; judge via the vision subagent, the
  main model cannot see images) → **remove `?ab` code** → full verification →
  commit `style(render): premium sticker and environment tuning`. If the
  winner is A, revert the B-only extras (`envMapIntensity`, exposure) but keep
  the A set. If the winner is B, keep everything.

### Locked user decisions (2026-09-15, do not re-ask)

1. **M3 A/B pick:** plan-default rule — B unless stickers blow out, judged
   from the screenshots (vision subagent), no user review overnight.
2. **No push:** all commits stay **local on main**. Pushing triggers the
   GitHub Pages deploy; the user reviews and pushes in the morning.
3. **Manual QA findings** (demo ≥3 loops, reduced-motion pass, capture matrix
   incl. "Firefox/Android untested here") go into the **final report message
   only** — no QA file in the repo.

### Gotchas discovered this session (verified)

- **Capture-phase clicks:** `PointerTurnHandler` calls
  `event.stopPropagation()` in the container's **capture** phase
  (`PointerTurnHandler.ts:61,94`), so window **bubble**-phase listeners never
  see canvas clicks. Any window-level `pointerdown` wiring (sound unlock,
  demo stop) must register with `{ capture: true }` and remove with the same
  flag. M2's unlock already does this (`App.tsx`).
- **Headless timing:** software WebGL renders slowly; a fixed 600 ms wait is
  not enough for a turn's completing snapshot. Always wait for
  `controller.snapshot().busy === false`, then a ~800 ms beat for React
  effects.
- **Stale-module curl check:** esbuild **minifies** dev-served modules — grep
  minified shapes (`clearcoat: 1`, `environmentIntensity = .7`), not the
  source text (`1.0`, `0.7`).
- **Dev server:** already running on 5179 (cube3's own row) — reuse it, never
  kill; e2e reuses it too.
