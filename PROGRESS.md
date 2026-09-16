# cube3 — Showcase Update Progress

Live state for the overnight session. Read this before touching anything.
Committed so a fresh clone/continuation still sees it.

Last updated: after M9 commit + polish round 1.

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

Full sequence is contiguous after `b9c8b43`. Nothing pushed.

## M3 A/B verdict

Candidate **B** chosen (plan default rule): stickers `clearcoat 1.0`,
`clearcoatRoughness 0.08`, `roughness 0.24`, `envMapIntensity 1.15`,
`environmentIntensity 0.7`, exposure 1.0. Vision check (low variant) found no
highlight blow-out on the elevated top-down station, which is where clearcoat
blow-out shows first, so the rule selects B over A. The temporary `?ab` camera
lock was deleted before the commit.

## Polish round 1 (in progress)

Round-1 screenshot set captured (`/tmp/opencode/cube3-design/round-1-*.png`:
idle, exploded, celebration, demo, panel, mobile-idle) and routed through the
vision subagent for a /10 critique. Score **6.5/10**.

Applied from that critique:

- **Backdrop and floor neutralized.** The blue-hour studio gradient was the
  single biggest cohesion break (the render read as a different product from
  the charcoal panel). Backdrop stops are now charcoal; the floor glow and
  hemisphere/fill/rim lights no longer push blue.
- **Sticker material glossier.** `roughness 0.24 → 0.19`,
  `clearcoatRoughness 0.08 → 0.045`, `envMapIntensity 1.15 → 1.25`.
- **Exploded state was clipped by the stage** (the round-1 `exploded.png` had
  the outer layer running off the frame). Fixed by pairing a smaller spread
  (`explode * 1.4 → 0.62` in `CubeRenderer.applyVisualOffset`) with a new
  `SceneManager.setContentScale()`, which pulls the camera back radially for
  the spread and restores the assembled framing on toggle-off.
- **Toggle state now reads as on.** `[aria-pressed='true']` rows get an accent
  underline; the primary row gets a vertical accent edge instead of a filled
  invert.
- **Brand mark rebuilt** as a 2x2 sticker-tile cluster using the cube's own
  palette variables, replacing the three-band gradient lozenge.
- **Mobile stage hint** swapped to a one-line compact variant (the full
  sentence wrapped to three lines and covered the cube).
- **Celebration sparks** get a soft radial sprite (untextured `Points` drew
  confetti squares) and are slightly smaller.
- **"Optimal solve" no longer wraps**; `Ses`/`sion` group label wrap fixed with
  `white-space: nowrap` and a wider Session column.

## Verification status — IMPORTANT

`npx tsc -b` and `npm run lint` are green. Unit tests are green (165/8 suites).

**`npm run test:e2e` is currently NOT green: 9 passed, 5 failed.** The five
failures are all `waitForFunction` / `waitIdle` 60 s **timeouts** in
celebration, demo, drag, explode and solve — i.e. the very first test in each
file that waits for the queue to drain. Evidence that this is machine load and
not a logic regression:

- `npx playwright test e2e/solve.e2e.ts` alone (single worker, idle machine):
  **6 passed** in 2.5m, including the test that times out in the full run.
- The same 5 tests failed identically on two consecutive full runs at load
  average ~11.8 on a 16-core box (headless software WebGL is CPU-bound).
- `drag.e2e.ts` fails in the full run but the drag path is untouched by this
  round's changes.

A full run with `--workers=2` is in flight to confirm the suite is green when
the box is not oversubscribed by parallel chromium instances.

## Remaining work

1. Confirm `npm run test:e2e` green (workers-limited), commit round 1 as
   `style: visual polish round 1 — ...`.
2. Full UX/feature QA pass at 1440x900 and 390x844.
3. Final report.

## Housekeeping

Temporary probe scripts at the repo root (`shoot-round.tmp.mjs`,
`probe-scene.tmp.mjs`, `probe-late.tmp.mjs`, `probe-explode.tmp.mjs`,
`shoot-stations.tmp.mjs`) are untracked scratch and must be deleted before the
final report. `test-results/` is Playwright output and is gitignored.
