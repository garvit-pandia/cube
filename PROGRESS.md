# cube3 — Showcase Update Progress

Live state for the overnight session. Read this before touching anything.

Last updated: polish round 1 + QA committed; report page and dev app served for manual testing.

## Live URLs (for manual testing)

| URL | What | Owner / notes |
|---|---|---|
| **http://localhost:5179/** | **The cube3 app itself** — this is the thing to test | cube3's own pinned `strictPort` dev server (`node` pid 56546, started before this session). Already running; do **not** kill or restart it. Add `?demo=1` to autostart the self-solving demo. |
| **http://localhost:5180/** | Session report page (what was built, hashes, measurements, QA) | Ephemeral `node /tmp/opencode/cube3-report/serve.mjs`, process name `cube3-report` (hub). Repo-external: reads `/tmp/opencode/cube3-report/report.html` and serves screenshots from `/tmp/opencode/cube3-design/` under `/shots/`. 5180 was verified free before binding; it is **not** a claimed row in `PORT-REGISTRY.md` — stop it when done. |

Verified live: 5179 boots clean (`.viewport.is-ready`, `window.__cube3` present,
`phase: idle`, `solved: true`, 10 action buttons + 27 move buttons,
**0 page errors**); 5179 serves current code (the polish-round-1
`setContentScale` symbol is present in both `SceneManager.ts` and `App.tsx`,
so it is not serving stale modules).

## Committed (all LOCAL on main — never pushed)

| Milestone | Status | Commit |
|---|---|---|
| M1 frame hooks + persisted `sound` setting | done, verified green | `6b46466` |
| M2 SoundRig + audio track | done, verified green | `b9c8b43` |
| M3 premium sticker/environment pass | done, verified green | `96ab6f0` |
| M4 exploded view + intro assembly | done, verified green | `eed49d3` |
| M5 celebration particles + stats stamp | done, verified green | `0c9a73b` |
| M6 cinematic orbit camera rig | done, verified green | `b2d5bda` |
| M7 self-solving demo loop | done, verified green | `993383d` |
| M8 one-click clip capture | done, verified green | `3a80b37` |
| M9 docs (AGENTS.md + README.md) | done, verified green | `13e844a` |
| Polish round 1 (scene/framing/toggles) | done, verified green | `75c62a6` |
| e2e budgets derived from measurement | done, verified green | `5fba5c4` |
| Progress notes (polish + QA results) | done | `072b2ee` |

Nothing pushed (`main` is ahead of `origin/main` only; pushing deploys Pages).

## M3 A/B verdict

Candidate **B** chosen (plan default rule): stickers `clearcoat 1.0`,
`clearcoatRoughness 0.08`, `roughness 0.24`, `envMapIntensity 1.15`,
`environmentIntensity 0.7`, exposure 1.0. The vision check found no highlight
blow-out on the elevated top-down station, which is where clearcoat blow-out
shows first, so the rule selects B over A. The temporary `?ab` camera lock was
deleted before the commit.

## Polish round 1

Round-1 screenshots critiqued by the vision subagent: **6.5/10**. Applied from
that critique:

- Backdrop/floor/hemisphere/fill/rim de-blued to neutral charcoal (the biggest
  cohesion break — the render looked like a different product from the panel).
- Stickers glossier: `roughness 0.24 → 0.19`, `clearcoatRoughness → 0.045`,
  `envMapIntensity → 1.25`.
- Exploded clipping fixed: spread `1.4 → 0.62` paired with a new
  `SceneManager.setContentScale(1.3)` that pulls the camera back radially and
  restores assembled framing on toggle-off. Verified: `maxCentreDistance 2.352`
  vs `camDist 9.406` (fits), reassembles to `1.732` on toggle-off (exactly the
  assembled corner radius).
- Toggle-on reads as an accent underline; the primary row gets a vertical
  accent edge instead of a filled invert.
- Brand mark rebuilt as a 2×2 sticker-tile cluster from the cube palette.
- Mobile stage hint uses a one-line variant; "Optimal solve" no longer wraps.
- Celebration sparks get a soft radial sprite (was untextured squares).

Only one polish round was run, as instructed — rounds 2–12 were superseded.

## Verification (final)

- `npx tsc -b` clean, `npm run lint` (oxlint) clean.
- `npm run test`: **165 passed / 8 suites**.
- `npm run test:e2e`: **14 passed** with `workers: 2` pinned.

### The e2e timeouts were a frame-throughput budget, not flaky logic

Measured, not guessed: headless chromium here has no GPU and falls back to
software WebGL, which is fill-rate bound — **2.8 fps at 1280×800**, 5 fps at
800×600, 56 fps at 400×300, with shadows making no difference. `update()`
advances exactly **one queued turn per animation frame**, so a queue of *N*
moves needs *N* rendered frames regardless of `animationScale`. A 22-move
scramble is ~11 s of pure frame time; the solve tests stack a scramble and a
solve (~43 turns). The old 60 s test deadline had no headroom, and ambient load
on this box (vscode-server alone holds load ~10) starved it further. Fixes:
`workers: 2`, test budget 120 s, `waitIdle`/`pollFor` defaults 90 s. **If these
time out again, check `uptime` before suspecting the code.**

A genuine test bug was also found and fixed: the busy-queue drag test sampled
`history.length` *after* enqueueing, so a turn landing in between made the
expected total unreachable. It now baselines before enqueueing and queues 12
turns so the busy window provably outlives the gesture.

## UX QA (both viewports, real user surfaces)

45/45 checks in the first harness plus 20/20 in the gesture/endurance harness,
**zero console or page errors throughout**.

Desktop 1440×900: layout (stage left / 380px sidebar right, no overflow), face
buttons (R), slice buttons (M2), keyboard turns (`u`, `Shift+U` → `turns: 3`),
Undo/Redo, Scramble, Optimal solve, Reset view, Reset cube, Exploded on/off
with turns while exploded, log-tab arrow-key roving focus, sound-toggle
persistence, capture start/stop.

Mobile 390×844: no overflow, compact stage hint, panel stacks under the stage
(`.sidebar-toggle` is `display:none` below 720px by design), scramble+solve,
sticker drag.

Cross-cutting: sticker drags, face-centre drags resolving to slices, background
orbit (no turn), scroll zoom (7.19 → 5.66), celebration burst, intro assembly on
fresh load, intro skipped under reduced motion and with `?demo=1`, demo
endurance **4 unattended solve cycles**, an action button stops the demo,
`?demo=1` autostart, reduced-motion pass, settings persistence across reload,
capture matrix (chromium verified).

### Two behaviours worth recording (verified, not bugs)

- **Auto-solve never records a session solve** (invariant 15): `count` stays 0
  after Optimal solve. The recording path was verified separately by solving a
  scramble with real button clicks → `count 0 → 1`.
- **The solved stamp stays mounted at `opacity: 0`** after the burst, because it
  carries `animation-fill-mode: forwards`; it is replaced by the next snapshot
  that re-renders without `justSolved`. "One-shot" therefore means faded out,
  not unmounted — note that Playwright's visibility test treats `opacity: 0` as
  **visible**, so a `waitForSelector` on `.solved-flash` can pass on a stamp
  nobody can see. The visible end state is asserted by opacity in the QA harness.

## Environment notes

- **Ports:** before binding or killing anything, read `../PORT-REGISTRY.md` AND
  run `ss -ltnp`. 5179 (cube3 dev) and 5180 (this report) are live; 9222
  (Playwright chromium) and 46537 (vscode-server) are never killable.
- **The `browser.*` eval helpers can fail on cleanup** with
  `Failed to clear browser request interception after browser.run`. That is a
  harness bug, not an app bug — fall back to a throwaway Playwright script run
  from the repo root (`node ./.probe.tmp.mjs`, then delete it) so `@playwright/test`
  resolves out of `node_modules`.
- Load average on this box is dominated by vscode-server (~10). Screenshot
  probes that boot a second chromium take 30 s+ and often time out; run one
  browser at a time and expect the app to need ~10–30 s to reach scene-ready.
- WSL2 polling watcher: verify fresh modules with
  `curl -s http://localhost:5179/src/<File>.ts | grep <symbol>`, grepping
  **minified** shapes (esbuild rewrites `1.0` → `1`, `0.55` → `.55`).
- Never wait a fixed 600 ms for a turn; wait for `snapshot().busy === false`.
- `PointerTurnHandler` stops propagation in the container's **capture** phase —
  window pointerdown listeners need `{ capture: true }`.
