# Overnight /goal prompt — cube3 Showcase Update (M3–M9)

Copy everything inside the fence below into the `/goal` session. It is
self-contained; the authoritative specs live in the repo docs it references.

```
/goal Finish the cube3 Showcase Update from milestone M3 through M9, strictly in order, overnight, with no user available.

REPO & SPECS (read these first, in this order):
1. /home/garvit/projects2/cube3/AGENTS.md — repo law: architecture, invariants 1–18, commands, conventions, tooling gotchas.
2. /home/garvit/projects2/cube3/SHOWCASE-PLAN.md — the authoritative feature spec. Section 6 "Progress log & overnight handoff" is the LIVE state: read it before touching anything. It records which milestones are committed, the exact M3 dirty-tree state (intentional — do not revert), the locked user decisions, and environment gotchas.
3. This prompt.

STATE RIGHT NOW:
- M1 committed (6b46466), M2 committed (b9c8b43). Both verified green.
- M3 is half-applied and UNCOMMITTED: candidate A values are already in src/render/palette.ts and src/render/SceneManager.ts; the temporary DEV-only ?ab camera lock is in src/App.tsx; "before" screenshot is already taken. Follow the remaining M3 steps exactly as written in SHOWCASE-PLAN.md section 6 (shot A -> apply candidate B -> shot B -> pick by the locked rule -> DELETE the ?ab code -> verify -> commit).
- Working tree is otherwise clean. The only modified files must be the three M3 files listed above; if you find anything else modified, stop and report it in the final output instead of guessing.

DECISIONS THE USER ALREADY LOCKED (do not re-ask, do not deviate):
1. M3 A/B pick: plan-default rule — choose B unless sticker highlights blow out; judge by dispatching the screenshots to the vision subagent (the main model cannot see images). No user review overnight.
2. All commits stay LOCAL on main. NEVER git push — pushing triggers the GitHub Pages deploy and would publish unreviewed work.
3. Manual QA findings go in the final report message only; do not create QA notes files.
4. Do not add npm dependencies. Do not touch tsconfig.json, src/cube/*, src/session/*, src/cube/min2phase.js, or anything outside the files each milestone names (plus new files the plan says to create).

PER-MILESTONE CONTRACT (for each of M3, M4, M5, M6, M7, M8, M9):
- Implement exactly per SHOWCASE-PLAN.md section 2. Where the plan says "delete before committing" (the ?ab harness), delete before committing. Where it says a choice exists (e.g. document the explode-offset direction in a comment), make the choice, document it in a code comment, move on.
- Full verification after every milestone, all four must pass before the commit is allowed:
    npx tsc -b && npm run lint && npm run test && npm run test:e2e
  Unit tests: 159 must stay green (plus any new suites the plan adds, e.g. DemoLoop in M7). E2E: 11 existing + new e2e files the plan specifies (e2e/explode.e2e.ts in M4, e2e/celebration.e2e.ts in M5, e2e/demo.e2e.ts in M7) must all pass.
- Then commit with the EXACT message from the plan for that milestone:
    M3: style(render): premium sticker and environment tuning
    M4: feat(render): exploded view toggle and intro assembly
    M5: feat(render): solve celebration particles and stats stamp
    M6: feat(render): cinematic orbit camera rig
    M7: feat(app): self-solving demo loop
    M8: feat(app): one-click clip capture
    M9: docs: showcase update in AGENTS and README
- If a milestone cannot be completed as specified, STOP that milestone, do not improvise a redesign, note it in the final report, and continue with the next milestone only if it does not depend on the failed one (M4+ are mostly independent; M6 is required by M7, M2's SoundRig audioTrack is required by M8).

MILESTONE-SPECIFIC REMINDERS (all detailed in the plan; only the easy-to-miss bits repeated here):
- M4: explode/intro offsets are composed in CubeRenderer's sync, setLayerRotation AND clearLayerRotation (right after each base->group copy) so the post-turn snap re-applies them; basePosition/baseQuaternion are never mutated. Register the frame hook in build(), unregister in clear() and dispose(). Intro scatter stays <= ~3.3 units from centre (key-light shadow frustum is +/-3.4 — do not widen the frustum, do not scatter past it). New e2e e2e/explode.e2e.ts must toggle explode ON, play moves, toggle OFF, then solveOptimally and assert solved — that is the no-drift property; screenshot to /tmp/opencode/cube3-design/.
- M5: CelebrationRig registers its frame hook only while a burst is live; re-trigger cancels the prior burst; under reduced motion no particles. Stamp becomes "Solved · {time}" ONLY when !autoSolved (stats.latest persists across auto-solves and would show a stale personal best — auto-solve stamp is plain "Solved"). Keep the sr-only role="status" paragraph untouched.
- M6: cinema rig is the ONLY module allowed to toggle controls.enabled (drag handler must never); restore it verbatim on exit; do not call controls.update() while it owns the camera; add the framedDistance getter on SceneManager rather than duplicating framing math; under reduced motion it holds a static angle.
- M7: DemoLoop is a PURE state machine in src/app/DemoLoop.ts (no three.js, no DOM, no window), unit-tested in src/app/DemoLoop.test.ts with vi.useFakeTimers() and a hand-written fake controller; BOTH scrambleOptimally and solveOptimally rejections must end the loop at 'off' without throwing. Implement the STRICTER demo-stop rule: any Session/Edit/Device action button other than the Demo toggle stops the demo, AND the on-screen move pads stop it, AND a capture-phase pointerdown on the stage stops it. "?demo=1" autostarts after scene-ready and skips the intro. While demo is on, cinema rig setActive(true); on stop setActive(false). hero-meta shows "Demo" on the left while active. Retrigger the whoosh when the scramble sequence CONTENT changes (demo cycles 2+ would otherwise be silent until the chime). New e2e/e2e demo file is REQUIRED: ?demo=1 autostarts, phase cycles scrambling->solving->resting->scrambling, controls.enabled === false while demo on, stage pointerdown stops it and restores controls.enabled, no console errors.
- M8: CaptureManager records the app's own canvas via canvas.captureStream(60) plus the SoundRig audio track (rig.audioTrack); codec order vp9 -> vp8 -> video/webm -> video/mp4; 8 Mbps; hard 60 s cap; Record button hidden entirely when unsupported; label toggles exactly Record / Stop. The Record click calls sound unlock first (it is a user gesture) so the audio track exists even without prior interaction; mid-recording sound toggles cannot join the live stream (document in code, acceptable).
- M9: add the four new invariants to AGENTS.md (cinema owns controls.enabled; explode/intro are derived offsets; demo only drives record:false paths; SoundRig/CaptureManager never throw into the solve path), update the test-count line (unit count + e2e count + suite table with DemoLoop), update the e2e list, add README feature rows for Demo mode, Exploded view, Sound, Capture, Celebration, and note ?demo=1.

ENVIRONMENT FACTS & GOTCHAS (verified this session; also in SHOWCASE-PLAN.md section 6):
- Dev server is already running on http://localhost:5179 (cube3's own port). Reuse it for e2e and screenshots. NEVER kill it; on EADDRINUSE read /home/garvit/projects2/PORT-REGISTRY.md and never touch 9222 or 46537.
- WSL2 serves stale modules under native watching; vite.config.ts uses polling. After edits, verify fresh serving with: curl -s http://localhost:5179/src/<File>.ts | grep <symbol> — but grep MINIFIED shapes (esbuild rewrites 1.0 -> 1, 0.55 -> .55), e.g. "clearcoat: 1" not "clearcoat: 1.0".
- Headless software WebGL is slow: never wait a fixed 600 ms for a turn to land; wait for window.__cube3.controller.snapshot().busy === false then ~800 ms for React effects.
- PointerTurnHandler stops propagation in the container's CAPTURE phase, so any window-level pointerdown listener must be registered with { capture: true } (and removed with the same flag) or it will never see cube clicks.
- The main model cannot see images: route every screenshot judgment through the vision subagent.
- Screenshots for the definition-of-done go to /tmp/opencode/cube3-design/ (before.png already there; screenshot.mjs is the shot helper: run "node /tmp/opencode/cube3-design/screenshot.mjs <name>" from the repo root).
- StrictMode double-mounts effects in dev: keep every setup/teardown symmetric (sound rig, rigs, listeners, refs).
- TS 6 strict: noUnusedLocals/noUnusedParameters will catch stray code; erasableSyntaxOnly means no enum/namespace/parameter properties; verbatimModuleSyntax means import type for type-only imports.

END STATE (definition of done):
- M3..M9 all committed in order with the exact messages above; git log shows the full sequence after b9c8b43; working tree clean (nothing modified, nothing untracked except nothing).
- npx tsc -b, npm run lint, npm run test, npm run test:e2e all green at final HEAD.
- Screenshots in /tmp/opencode/cube3-design/: before/A/B (M3), exploded state (M4), celebration mid-burst (M5), demo in progress (M7), plus one per polish round (below).
- Final report message must include: per-milestone commit hashes, the M3 A/B verdict and why, the polish-round table (round -> score -> what changed), the manual QA findings you could verify locally (demo >=3 loops unattended with no console errors, reduced-motion pass, 10-minute demo memory/console check if feasible, capture matrix with Chrome verified + Firefox/Android marked untested in this environment), and any milestone that was stopped with the reason.
- Do NOT git push. Do NOT create PRs. Do NOT modify this GOAL-PROMPT.md or delete SHOWCASE-PLAN.md.

FINAL PHASE — CRITIQUE LOOP, VISUAL POLISH & FULL QA (runs after the M9 commit; this phase is MANDATORY, not optional):

Rounds. Each round is:
  1. Capture a fresh screenshot set at 1440x900 @2x (and one at 390x844 for mobile) into /tmp/opencode/cube3-design/round-<N>-*.png: idle cube, mid-demo with cinema camera, exploded state, celebration mid-burst, and the panel/UI in focus.
  2. Spawn a CRITIQUE SUBAGENT (fresh context; in this harness use the vision subagent for anything visual — the main model cannot see images). Give it every screenshot plus this rating brief: rate the work out of 10 strictly on visuals, aesthetics and looks — 3D scene quality (sticker material, lighting, shadow, framing), UI panel craft (typography, spacing, hierarchy, consistency with the existing dark-Swiss identity), motion/interaction polish, cohesion between 3D scene and UI, and an explicit "does anything look AI-generated / template slop?" check. The critique MUST list at least 3 concrete weaknesses every round, even when the score is high — no vague praise, no unconditional 9/10s; every score must be justified against the specific dimensions above.
  3. Apply the top feedback. Allowed surface: render constants (palette.ts, SceneManager lighting/exposure/env only — PCFShadowMap, shadow.radius and the shadow frustum stay untouched), index.css, and App.tsx markup/CSS — but existing button labels (Scramble, Replay, Optimal solve, Undo, Redo, Reset view, Reset cube, Demo, Exploded, Record/Stop) and the e2e-located seams (.viewport canvas, window.__cube3) must never change. Still forbidden: everything on the do-not-touch list (tsconfig.json, src/cube/*, src/session/*, min2phase.js), no new npm dependencies, no postprocessing/bloom, no replacement of the established dark-Swiss design language with a template look.
  4. Full verification (npx tsc -b && npm run lint && npm run test && npm run test:e2e) — all green or the round does not count.
  5. Commit the round as: style: visual polish round <N> — <short focus>. Never amend or rebase earlier commits.

Loop rules:
- A score below 8/10 means the loop CONTINUES after that round, regardless of round count.
- Even if a round scores 8/10 or higher, keep going: at least 5 improvement rounds happen no matter what the scores are.
- Hard safety cap: 12 rounds total (protects the machine overnight; reaching >= 8/10 is the goal, the cap only exists so the loop cannot run forever). If round 12 ends below 8/10, stop, keep the best-scoring state committed, and report the final score honestly with the remaining critique feedback.
- Each round must be a real, visible improvement (material/lighting/typography/motion/detail work), not a no-op re-screenshot. If the critique says 9+/10 with no actionable feedback, spend the remaining rounds on depth passes instead: micro-interactions, easing curves, hover/focus states, edge-case framing (very narrow/wide viewports), texture of the floor/backdrop, stamp and progress-bar detail.

Research & taste (use as needed, any round):
- Research current award-winning site standards (Awwwards-style criteria: typography scale and rhythm, restrained palette, purposeful motion, one clear idea) and three.js showcase-quality scenes before making taste calls; cite in the report which references informed each round.
- Load any available design skills if the environment offers them (frontend-design, design-taste-frontend, web-design-guidelines or equivalents) and follow them.
- Anti-slop guardrails: no default purple/blue gradient landing-page energy, no emoji as UI, no decorative glassmorphism blobs, no inconsistent radii/shadows, no centering-everything, no stock font stacks that fight the existing identity. Refine what is there; the cube is the hero.
- Take creative decisions yourself when needed and record them (decision + why) in the final report. The user is asleep; there is no one to ask.

FULL UX & FEATURE QA PASS (after the loop's final round, before the report):
- Drive every feature in a real browser through window.__cube3 and the UI, at desktop (1440x900) and mobile (390x844): manual face/slice buttons, keyboard turns incl. Shift-reverse, sticker drags on faces AND face-centres (M/E/S), background orbit, scroll zoom, Undo/Redo, Scramble, Replay, Optimal solve, Cancel mid-solve, Reset view, Reset cube, Exploded toggle (turns while exploded, toggle back), intro on fresh load, sound on/off instant effect, celebration stamp + particles (and instant stamp under reduced motion), Demo loop >= 3 cycles with cinema camera + stage-tap stop + action-button stop, ?demo=1 autostart, Record start/stop/download (chromium), settings persistence across reload, reduced-motion pass (OS flag or force toggle), log tabs keyboard navigation.
- Zero console errors throughout. Anything broken: fix it (same allowed surface and verification rules as a polish round), commit the fix as fix: <what>, and note it in the report.
```

## Notes for the human (not part of the prompt)

- Progress state lives in `SHOWCASE-PLAN.md` §6; it is committed so the
  overnight session sees it even after a fresh clone.
- The M3 candidate-A edits are intentionally left uncommitted in the working
  tree — the prompt explains them; do not stash/revert before starting.
- The critique loop runs **after** M9: vision critique rates every round out
  of 10, < 8/10 keeps the loop going, and **at least 5 rounds happen even if
  the score is already ≥ 8/10** (hard cap 12 rounds so the machine survives
  the night). Expect extra `style: visual polish round N` commits and possible
  `fix:` commits from the end-to-end UX pass on top of the nine milestone
  commits — review them in the morning and drop any you dislike.
- In the morning: review `git log`, run the verification once, then
  `git push` manually when satisfied (that is what deploys to Pages).
