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

1. **Integer state, zero drift** (`CubeState.ts:58-63`). Position ∈ {-1,0,1}³ plus an integer 3×3 matrix. Never write a float into state.
2. **Move convention** (`CubeState.ts:115`). `quarters = ((((-turns * sign) % 4) + 4) % 4)` — clockwise-from-outside is `-turns` about the positive axis for `sign +1`. Flipping the sign inverts every turn. Rationale in `palette.ts` (`FACE_AXES` comment).
3. **`turns` numbering** (`types.ts:23-30`, mirrored in `CubeController.startTurn` `:235-244`): `1` = `R`, `2` = `R2`, `3` = `R'`.
4. **Sticker normals are cubie-local** (`CubeState.ts:11`). They never change; rotation carries them. Sticker meshes attach once at build (`CubeRenderer.ts:85-88`) — never reposition them.
5. **Solved ≠ identity** (`CubeState.ts:140-145`). Solved = every face one uniform colour by logical placement; a centre may be spun. `CubeController.afterTurnCompleted` also requires `history.length > 0` so a fresh cube can't score.
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
17. **Drag-to-turn resolves through the model, then the queue** (`src/cube/dragTurn.ts`, `src/render/PointerTurnHandler.ts`). A gesture reads the sticker's world normal and cubelet position from `CubeState` (integer math via `stickerInfo`), never from meshes; the resolved move enters through `enqueue()` like any button press. The handler intercepts pointerdown in the container's capture phase (so OrbitControls never sees the gesture) and never toggles `controls.enabled`. Drags only start when `canDrag()` is true (queue drained), so the facts the gesture read are the facts it turns.
18. **`src/cube/min2phase.js` is vendored third-party code** (cs0x7f/min2phase.js, MIT; loaded lazily by `CubeController.loadSolver`). Do not reformat, lint, or refactor it; the only local change is the ESM export shim at the bottom, and it is excluded from oxlint via `ignorePatterns`.

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

## Testing & QA

- Vitest 5, **no vitest config** — defaults (`environment: 'node'`, `globals: false`), so every suite imports `{ describe, expect, it } from 'vitest'` explicitly.
- **130 tests, 7 colocated unit suites** (`<Module>.test.ts`), all pure logic — no DOM/WebGL/three.js. Plus 10 Playwright e2e tests in `e2e/*.e2e.ts` that drive the real browser through the `__cube3` seam. All green with build + lint.

| Suite | Pins |
|---|---|
| `src/cube/CubeState.test.ts` (52) | 27 cubelets / 54 stickers; `it.each` face-identity sequences; inverse round-trips; 5000-turn drift invariants; layer selection; Singmaster direction table |
| `src/session/SolveSession.test.ts` (16) | trimmed Ao5/Ao12, recent-first, persistence round-trip, corrupt-JSON + per-entry validation, 200-record cap, `formatTime` |
| `src/app/settings.test.ts` (16) | settings defaults/round-trip/corrupt payload/per-field rejection + sidebar-open persistence (corrupt → open, null storage safe) |
| `src/cube/dragTurn.test.ts` (15) | drag→move resolution table; slice/centre/degenerate rejections; 192-combination check that every resolved turn initially moves the sticker along the drag, against `CubeState` conventions |
| `src/cube/facelets.test.ts` (9) | solved cube → canonical URFDLB string; 9-per-face histogram; solver round-trips on seeded scrambles (≤21 moves); `solutionToMoves` padding + malformed rejection |
| `src/cube/notation.test.ts` (12) | `simplifyMoves` cancellation/combination invariants + seeded `invertMoves`→`simplifyMoves` round-trip against `CubeState` (the auto-solve math) |
| `src/cube/scramble.test.ts` (10) | axis alternation, no back-to-back face/cancellation, full face coverage, seeded reproducibility, parse/format round-trip |

E2E (`e2e/`, Playwright, chromium): optimal solve from scramble ends solved ≤21; replay solve from manual moves ends solved; auto-solve never records; cancel restores prior phase; blocked solver chunk falls back to replay; sticker drags commit valid moves; background/slice drags do not; drags are dropped while the queue is busy. The suite sets `controller.animationScale = 0.001` because headless software rendering plus the delta clamp makes real easing crawl.

- New tests: colocate, import vitest explicitly, use seeded `mulberry32(seed)` from `src/test/support.ts` (not `Math.random`), inject fakes (`fakeStorage`, `() => number`). Reuse `expectLegalCube` / `expectIntegralRigidBody` / `independentSolvedCheck` from `CubeState.test.ts`.
- **Gaps (intentional):** no unit tests for `CubeController` (its solve state machine is covered end-to-end by Playwright), `src/render/` internals, palettes/types, `App`/`main`. Rendering and interaction are verified in a real browser via the `window.__cube3` seam — do not add jsdom to test it.
