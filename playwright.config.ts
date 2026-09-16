import { defineConfig } from '@playwright/test';

// Browser E2E against the dev server on cube3's pinned port. Files are named
// `*.e2e.ts` so vitest's default include (`.test` / `.spec`) never picks them
// up, and the `e2e/` dir sits outside every tsconfig: Playwright transforms
// them itself, `tsc -b` stays untouched (see AGENTS.md on the tsconfig).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  // Turn-throughput budget, not a guess: see the frame-rate note below. The
  // heaviest tests drive ~43 queued turns (a 22-move scramble plus a ~21-move
  // solve), which is ~15 s of pure frame time at the measured rate even with
  // `animationScale` floored, before solver chunk loading and page startup.
  // 120 s keeps the helper-level budgets meaningful under ambient CPU load
  // without letting a genuinely stuck queue hang the suite for minutes.
  timeout: 120_000,
  retries: 0,
  // This suite renders the real scene in headless chromium, which falls back
  // to software WebGL here. That renderer is fill-rate bound: measured 2.8 fps
  // at 1280x800, 5 fps at 800x600, 56 fps at 400x300, with shadows making no
  // difference. CubeController.update() advances exactly one queued turn per
  // animation frame, so a queue of N moves drains in N/fps seconds - about 11 s
  // for a 22-move scramble on an idle box, and the solve tests stack a scramble
  // and a solve on top of that. Two workers keep that inside the 60 s test
  // budget; Playwright's default (half the cores) does not, and any other
  // chromium or CPU-heavy job running alongside will starve it too.
  workers: 2,
  use: {
    baseURL: 'http://localhost:5179',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
