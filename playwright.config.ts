import { defineConfig } from '@playwright/test';

// Browser E2E against the dev server on cube3's pinned port. Files are named
// `*.e2e.ts` so vitest's default include (`.test` / `.spec`) never picks them
// up, and the `e2e/` dir sits outside every tsconfig: Playwright transforms
// them itself, `tsc -b` stays untouched (see AGENTS.md on the tsconfig).
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60_000,
  retries: 0,
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
