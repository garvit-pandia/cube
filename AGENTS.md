# Repository Guidelines

Handbook for AI/human contributors to **cube3**: a browser 3×3 Rubik's Cube simulator — a mathematically exact integer engine driving a three.js presenter.

Core property: **the integer logical state is the only source of truth.** Meshes mirror it and are never read back. Turns play through an animation queue for looks; the model decides truth.

- No backend, database, or `.env`. Static bundle in `dist/`; GitHub Pages deploy via workflow.
- Dev server pinned to **port 5179** (`strictPort`, see `../PORT-REGISTRY.md`).

## Architecture & Data Flow

One-directional layers:

```
src/app  ──►  src/cube      (pure logic)
   │     ──►  src/session   (pure logic)
   └─────►  src/render  ──►  src/cube   (types/palette only)
App.tsx  ──►  app + cube + render + session + react
```

- `src/cube/*` imports nothing outside `src/cube` (non-test). `src/session/SolveSession.ts` has zero imports.
- `src/render/*` is the only three.js consumer; it reads `src/cube` for types/palette only (`render/types.ts:1`, `render/palette.ts:1`).
- `src/app/CubeController.ts` is the only module crossing all three layers. `src/App.tsx` is the React shell.
- **Never** import three.js/React/DOM into `src/cube/` or `src/session/` — that split keeps logic testable without a DOM.

One turn: `App.playMove` → `CubeController.enqueue()` (queues `{move, record:true}`, **no motion starts**) → next `SceneManager.tick()` fires the `onBeforeRender` hook (`SceneManager.ts:353`, installed by `attach`) → `update` shifts the queue, `startTurn` computes `layerIds(face)` + axis/sign/angle → per-frame `setLayerRotation()` overrides group transforms → on completion `state.applyMove()`, then the **authoritative snap** `renderer.sync(state.all())` (`CubeController.ts:271`) rewrites exact integer-derived transforms and discards interpolated floats.

### Invariants — do not break

1. **Integer state, zero drift** (`CubeState.ts:60-67`). Position ∈ {-1,0,1}³ plus an integer 3×3 matrix. Never write a float into state.
2. **Move convention** (`CubeState.ts:119`). `quarters = ((((-turns * sign) % 4) + 4) % 4)` — clockwise-from-outside is `-turns` about the positive axis for `sign +1`. Flipping the sign inverts every turn. Rationale in `palette.ts` (`MOVE_AXES` comment). Middle slices use the same table: the letter fixes the axis and the direction it follows (M→L, E→D, S→F), the turned layer is the coordinate-0 one (`CubeState.applyMove`/`layerIds`).
3. **`turns` numbering** (`types.ts:35-41`, mirrored in `CubeController.startTurn` `:462-473`): `1` = `R`, `2` = `R2`, `3` = `R'`, and the same suffixes on `M`/`E`/`S`.
4. **Sticker normals are cubie-local** (`CubeState.ts:11`). They never change; rotation carries them. Sticker meshes attach once at build (`CubeRenderer.ts:85-88`) — never reposition them.
5. **Solved ≠ identity** (`CubeState.ts:142-149`). Solved = every face one uniform colour by logical placement; a centre may be spun. `CubeController.afterTurnCompleted` also requires `history.length > 0` so a fresh cube can't score.
6. **`record: false`** (`CubeController.QueuedMove`). Undo inverses and scramble turns animate through the queue but must not enter `history` nor start the clock.
7. **`justSolved` / `autoSolved` are one-shot** (`CubeController.scheduleNotify`). Consumed by the snapshot that carries them, cleared before listeners run — celebrate exactly once.
8. **Wall-clock timer** (`CubeController.get elapsed`). `performance.now() - startedAt`, never summed frame deltas.
9. **Delta clamp** (`CubeController.update`). `Math.min(rawDelta, 0.1)` stops a backgrounded tab teleporting through queued turns.
10. **`PCFShadowMap` is deliberate** (`SceneManager.ts:160-162`). `PCFSoft` ignores `shadow.radius` (fixed kernel); `radius = 14` (`:251`) needs PCF tap scaling. Don't "upgrade" it.
11. **`resetView` flushes OrbitControls inertia** (`:319-322`). One `update()` with damping off zeroes `sphericalDelta`; without it drag inertia fights the reset lerp.
12. **`setLayerRotation` never touches base transforms** (`CubeRenderer.ts:127-142`); `sync` always restores exact alignment.
13. **Camera framing is computed** (`SceneManager.ts:126-145`, `CONTENT_RADIUS`). Fits the tighter FOV axis so narrow viewports can't clip the cube; `handleResize` (`:300-310`) only re-frames if the user hasn't taken over the camera.
14. **The turn log drives auto-solve** (`CubeController.applied`). Every turn that lands in `state` — user, undo inverse, scramble, or solve — is appended in `update()`. `solve()` plays `simplifyMoves(invertMoves(applied + in-flight))`, which is correct from any session state; skip the push and every later solution is silently wrong. Cleared on `reset()` and whenever the cube reaches solved.
15. **Auto-solve is not a solve** (`solve`/`cancelSolve`). Solve turns are `record: false, solve: true`: no `history`, no session record, clock frozen (phase `solving`), `canUndo` false, input guarded at the controller and disabled in the UI. Cancel drops remaining solve turns, restores the prior phase, and re-bases `startedAt` when resuming a running attempt. `autoSolved` is one-shot and drives the separate screen-reader announcement.
16. **`solve()` snapshots the log synchronously.** It captures `applied` + the in-flight turn and replaces the queue in one turn; yielding in between would let an unaccounted turn land and break the inversion.
17. **Drag-to-turn resolves through the model, then the queue** (`src/cube/dragTurn.ts`, `src/render/PointerTurnHandler.ts`). A gesture reads the sticker's world normal and cubelet position from `CubeState` (integer math via `stickerInfo`), never from meshes; the resolved move enters through `enqueue()` like any button press. Every sticker is draggable, and the cubelet's coordinate on the resolved axis selects the layer — ±1 a face, 0 a middle slice (`M`/`E`/`S`) — with the direction following the move convention. The handler intercepts pointerdown in the container's capture phase (so OrbitControls never sees the gesture) and never toggles `controls.enabled`. Drags only start when `canDrag()` is true (queue drained), so the facts the gesture read are the facts it turns.
18. **`src/cube/min2phase.js` is vendored third-party code** (cs0x7f/min2phase.js, MIT; loaded lazily by `CubeController.loadSolver`). Do not reformat, lint, or refactor it; the only local change is the ESM export shim at the bottom, and it is excluded from oxlint via `ignorePatterns`.
19. **Cinema owns `controls.enabled`** (`src/render/CinemaRig.ts`). It is the only module allowed to toggle it (explicit camera-owner mode); it stores the prior value on entry, restores it verbatim on exit, and never calls `controls.update()` while it owns the camera. The drag handler never touches it.
20. **Explode/intro are derived visual offsets** (`src/render/CubeRenderer.ts`). `applyVisualOffset` composes them onto group transforms right after every base→group copy in `sync`, `setLayerRotation`, and `clearLayerRotation`; `basePosition`/`baseQuaternion` are never written (extends #12).
21. **Demo only drives `record: false` paths** (`src/app/DemoLoop.ts`). It calls `scrambleOptimally`/`solveOptimally` in a loop, so history and the session are never polluted; `stop()` calls `cancelSolve()` mid-solve (extends #14/#15).
22. **SoundRig and CaptureManager never throw into the solve path** (`src/render/SoundRig.ts`, `src/app/CaptureManager.ts`). Every public method swallows failures; the rig stays dead / capture returns false, and the solve continues silently.
23. **Attempt lifecycle: `history` restarts per attempt** (`CubeController.beginAttempt`/`afterTurnCompleted`). Both scramble paths funnel through `beginAttempt()`, which drops any queued/in-flight turn, snaps state and renderer back to identity, and restarts `history`/`applied`/redo — so replay always inverts exactly the live scramble and undo/redo of user turns replay against `applied` (`undoOf`/`redoOf` entries add/remove the matching log instance on landing). A recorded turn from `done` also starts a new attempt: phase returns to `running`, `history` restarts with just that turn, the scramble label clears. The clock starts on the attempt's first recorded turn, and a session record requires phase `running` + solved + `history.length > 0`. `SolveRecord.moves` is the attempt's own count. `reset()` still clears everything. Don't "fix" one half of this without the other.
24. **Throwaway browser probes are `*.tmp.mjs`, deleted after use.** One-off Playwright checks run from the repo root as `node ./.probe.tmp.mjs` (so `@playwright/test` resolves out of `node_modules`) and are removed immediately; automated coverage belongs in `e2e/*.e2e.ts`. `thread.local/` is gitignored scratch (ad-hoc notes, launch pages) — both patterns live in `.gitignore`.

## Development Commands

| Command | Effect |
|---|---|
| `npm run dev` | Vite on `http://localhost:5179/`, `strictPort` — fails fast on collision, never drifts |
| `npm run test` | `vitest run` — single pass, no watch |
| `npx vitest run <file>` | Focused suite, e.g. `npx vitest run src/cube/CubeState.test.ts` (`npx vitest` alone = watch) |
| `npm run test:e2e` | Playwright browser tests (`e2e/*.e2e.ts`) against the dev server; reuses a running one |
| `npm run build` | `tsc -b && vite build` → `dist/` (the >500 kB chunk warning is expected — three.js) |
| `npm run lint` | `oxlint` (cwd, no path arg) |
| `npm run preview` | Serve built `dist/` |

Stale-module check (WSL2 polling hazard, below): `curl -s http://localhost:5179/src/render/SceneManager.ts | grep -n "environmentIntensity"`.

## Code Conventions

- **Naming:** PascalCase class modules (`CubeState`, `CubeRenderer`, `SceneManager`, `SolveSession`, `CubeController`); lowercase helpers (`types`, `palette`, `notation`, `scramble`, `settings`). `interface` for data carriers, `type` for unions/aliases, no `I`/`T` prefix.
- **Types:** `readonly` on interface/type fields and array params (`readonly Move[]`). `import type` for type-only imports.
- **Errors:** throw only on malformed programmer input (`parseMove`, `notation.ts:17-27`); swallow-and-fall-back for environment (`localStorage`, `matchMedia`, `JSON.parse`) — see `safeLocalStorage` (`CubeController.ts:20-30`), `settings.ts`, `SolveSession.load`/`persist`. Quota/private-mode must never break a solve.
- **DI:** constructor/parameter defaults so tests inject fakes: `new CubeController(storage = safeLocalStorage())`, `new SolveSession(storage = null)`, `generateScramble(length = 22, random = Math.random)` (axis-alternation rule inside — no two consecutive moves share an axis). Clock is **not** injected (`performance.now()` vs `THREE.Clock`).
- **State:** React reads `controller.snapshot()` via `subscribe()` (returns unsubscribe); `scheduleNotify()` coalesces bursts into one microtask. Don't bypass with direct field reads + manual re-renders.
- **No second conventions.** Extend `palette.ts` / `notation.ts` rather than adding a parallel helper.

## Tooling Gotchas

- **Node 22+, npm**, `package-lock.json` committed. `"type": "module"`, bundler resolution with `allowImportingTsExtensions` — `main.tsx` imports `./App.tsx` **with** extension.
- **TypeScript 6: `strict` is ON though unwritten** in any tsconfig (TS 6 defaults `strict: true`; verified — implicit-`any` and null-assignment errors fire). Also on: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `erasableSyntaxOnly` (no `enum`/`namespace`).
- **Don't touch `tsconfig.json`.** Solution-style container (`files: []` + two references, neither `composite`); `tsc -b` passes only because the container has zero inputs. Adding any file/include breaks the build (TS6306/TS6310).
- **three skew:** runtime `three@0.180.0` vs `@types/three@0.186.0` (verified: `three` ships no `.d.ts`, so the types package is the sole, slightly-ahead source). Prefer APIs present in the runtime.
- **Ports:** 5179 is cube3's row in `../PORT-REGISTRY.md`. Before binding/killing anything: read that file + run `ss -ltnp`. Owner rows are off-limits; on `EADDRINUSE` open the owner's URL, never kill. 9222 (Playwright) and 46537 (vscode-server) are never killable. Only kill processes you started and verified.
- **GitHub Pages:** `base: '/cube/'` in `vite.config.ts` — project site at `https://garvit-pandia.github.io/cube/`, deployed by `.github/workflows/deploy.yml` (build `dist/`, deploy on push to `main`). Dev server unaffected.
- **WSL2 watcher:** `server.watch.usePolling: true` (250 ms) in `vite.config.ts` — native watching silently serves stale modules here. Don't remove; use the curl check above before doubting your code.
- **StrictMode:** `main.tsx` mounts in `<StrictMode>` so the `App` setup effect runs twice in dev — keep setup/teardown symmetric (`App.tsx:53-96`, dispose path `:86-95`).
- **DEV-only seam** (`App.tsx:75-84`, stripped from prod): `window.__cube3 = { controller, scene, pause(), resume() }` for automated browser checks. Don't add product behaviour there.
- **Lint** is minimal by design: `react/rules-of-hooks` error, `react/only-export-components` warn; correctness defaults to warn.
- **165 tests, 8 colocated unit suites** (`<Module>.test.ts`), all pure logic — no DOM/WebGL/three.js. Plus 17 Playwright e2e tests in `e2e/*.e2e.ts` that drive the real browser through the `__cube3` seam. All green with build + lint.

| Suite | Pins |
|---|---|
| `src/cube/CubeState.test.ts` (74) | 27 cubelets / 54 stickers; `it.each` layer-identity sequences for faces and slices; inverse round-trips; 5000-turn drift invariants; layer selection; Singmaster direction table including M/E/S |
| `src/session/SolveSession.test.ts` (16) | trimmed Ao5/Ao12, recent-first, persistence round-trip, corrupt-JSON + per-entry validation, 200-record cap, `formatTime` |
| `src/app/settings.test.ts` (16) | settings defaults/round-trip/corrupt payload/per-field rejection + sidebar-open persistence (corrupt → open, null storage safe) |
| `src/app/DemoLoop.test.ts` (6) | pure state-machine cycle scrambling→solving→celebrating→resting→scrambling; stop mid-solve cancels once; stop mid-rest clears the timer; double-start no-op; both solver-rejection paths land `off` without throwing |
| `src/cube/dragTurn.test.ts` (19) | drag→move resolution table (faces and slices); degenerate rejections; 216-combination check that every resolved turn initially moves the sticker along the drag, against `CubeState` conventions |
| `src/cube/facelets.test.ts` (10) | solved cube → canonical URFDLB string; 9-per-face histogram; solver round-trips on seeded scrambles (≤21 moves) and on slice-mixed states (centres may be permuted); `solutionToMoves` padding + malformed rejection |
| `src/cube/notation.test.ts` (14) | `simplifyMoves` cancellation/combination invariants (faces and slices) + seeded `invertMoves`→`simplifyMoves` round-trip against `CubeState` (the auto-solve math) |
| `src/cube/scramble.test.ts` (10) | axis alternation, no back-to-back face/cancellation, full face coverage, seeded reproducibility, parse/format round-trip |

E2E (`e2e/`, Playwright, chromium): optimal solve from scramble ends solved ≤21; replay solve from manual moves ends solved; auto-solve never records; cancel restores prior phase; blocked solver chunk falls back to replay; sticker drags commit valid moves; background drags orbit without turning; face-centre drags turn the middle M/E/S slices; drags are dropped while the queue is busy; exploded toggle plays moves then solves with no drift; celebration burst fires with no errors; `?demo=1` autostarts, cycles, and stage-tap stops with the camera restored. The suite sets `controller.animationScale = 0.001` because headless software rendering plus the delta clamp makes real easing crawl.

- **Timeout budgets are frame-throughput derived, not guesses.** Headless chromium here has no GPU and falls back to software WebGL, which is fill-rate bound — measured **2.8 fps at 1280×800**, 5 fps at 800×600, 56 fps at 400×300, with shadows making no difference. `CubeController.update()` advances exactly **one queued turn per animation frame**, so a queue of *N* moves needs *N* frames no matter how short `animationScale` makes each turn; a 22-move scramble is ~11 s of pure frame time and the solve tests stack a scramble and a solve (~43 turns). Hence `playwright.config.ts` pins `workers: 2` (the default, half the cores, oversubscribes and starves the render loop) and the test/poll budgets sit above that measured floor. If these tests ever time out, **check machine load first** — an extra chromium or any CPU-heavy job will starve the render loop, and the assertions themselves are state-based and correct.

- New tests: colocate, import vitest explicitly, use seeded `mulberry32(seed)` from `src/test/support.ts` (not `Math.random`), inject fakes (`fakeStorage`, `() => number`). Reuse `expectLegalCube` / `expectIntegralRigidBody` / `independentSolvedCheck` from `CubeState.test.ts`.
- **Gaps (intentional):** no unit tests for `CubeController` (its solve state machine is covered end-to-end by Playwright), `src/render/` internals, palettes/types, `App`/`main`. Rendering and interaction are verified in a real browser via the `window.__cube3` seam — do not add jsdom to test it.
