import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Project site at https://garvit-pandia.github.io/cube/ — build assets
  // must be served under /cube/. Dev server is unaffected.
  base: '/cube/',
  plugins: [react()],
  server: {
    // Own port per ../PORT-REGISTRY.md. strictPort fails fast on collision
    // instead of silently drifting to a port the docs and tests don't expect.
    port: 5179,
    strictPort: true,
    // Native file watching is unreliable on this WSL2 filesystem and silently
    // serves stale modules, which makes browser verification lie.
    watch: { usePolling: true, interval: 250 },
  },
})
