# Cube³ — 3×3 Rubik's Cube Simulator

A browser-based 3×3 Rubik's Cube with a real, mathematically correct engine and a polished three.js presenter.

- **Drag** to orbit, **scroll** to zoom.
- **Keyboard:** `U` `D` `L` `R` `F` `B` turn the matching face; hold `Shift` to reverse; press the same key twice for a half turn.
- **Scramble**, **Solve**, **Undo**, **Redo**, **Reset view**, **Reset cube**, plus a full `U U' U2` button panel per face.
- **Solve** plays the cube back to solved from any state you have mixed it into — scramble or random turns. It animates through the same queue, can be cancelled, and is never recorded as a solve.
- **Collapsible controls sidebar** on desktop (`Controls` in the header); mobile keeps the stacked layout.
- Scramble sequence and move history are shown beside (or below) the cube.

## Running

```bash
npm install
npm run dev      # http://localhost:5179/
```

```bash
npm run test     # vitest — cube mechanics + scramble generator
npm run build    # tsc -b && vite build
npm run lint     # oxlint
```

The dev server pins **port 5179** with `strictPort: true` (see `../PORT-REGISTRY.md`).

## How it works

The cube is not animated geometry pretending to be a puzzle — it is an integer model that gets rendered.

- **Authoritative state** (`src/cube/CubeState.ts`) is 27 cubelets, each with an integer position in `{-1,0,1}³` and an integer 3×3 rotation matrix. Moves are integer matrix multiplies, so repeated turns can never accumulate floating-point drift.
- **Rendering is a pure projection** of that state. A turn animates by *overriding* mesh transforms for its duration; when it finishes the interpolated floats are discarded and exact state-derived transforms are written back.
- **Solved detection** reads the logical sticker placement (every face one uniform colour), not the visual transforms.
- **Move convention:** a turn clockwise as seen from outside a face is a −90° right-hand rotation about that face's outward normal, using the standard Western colour scheme (white up, green front, red right).

Architecture, invariants and the reasoning behind them are documented in [`AGENTS.md`](./AGENTS.md).

## Status

All seven phases are complete; `npm run test` (106 tests), `npm run build`, and `npm run lint` are green.

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Visual demo — 27 cubelets, rounded bodies, studio lighting, soft shadow, orbit/zoom/touch, reset view | done |
| 2 | Real mechanics — integer cube state, all 18 moves, layer animation + queue, validation suite | done |
| 3 | Full interaction — keyboard, move panel, scramble, reset, history, undo/redo | done |
| 4 | Timer and solve experience — solved detection, wall-clock timer, sessions, WCA Ao5/Ao12 | done |
| 5 | Polish — responsive (5 breakpoints), accessibility, settings, persistence | done |
| 6 | Final validation — browser E2E, 600-move drift/queue stress, camera + touch checks | done |
| 7 | Auto-solve + desktop sidebar — Solve/Cancel with turn-log inversion, collapsible controls panel, `simplifyMoves` test suite | done |

Deliberately **not** implemented (listed as optional in the brief): sound effects, fullscreen, themes, tutorial, algorithm trainer, shareable cube states — and an optimal search solver: the Solve button reverses the moves this session applied rather than searching for a shortest solution.

### Verification notes

- **Zero drift under load**: 600 turns driven through the real animation queue left `maxPositionError = 0` and `maxQuaternionError = 0` against the logical state, with no deadlock and the queue fully drained.
- **Timer**: wall-clock (`performance.now()`), not summed frame deltas — a dropped frame cannot make a solve read short.
- **Rendering is never authoritative**: verified by comparing every cubelet's rendered transform to the integer state after long runs.
- **Auto-solve**: driven in a real browser through the `window.__cube3` seam — scramble → solve and random-moves → solve both end with `state.isSolved()`; cancel mid-solve restores the prior phase and the cube stays consistent; auto-solve leaves `history` and the session stats untouched (0 records); input is locked while solving; the sidebar toggle persists across reloads. Layout was measured at 1440×900, 1000×600 and 390×844 (no overflow; cube fills ~80% of the stage height; mobile tap targets ≥44px).
