import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Fixed at :5173 always — strictPort means "fail loudly if taken" instead
    // of silently drifting to :5174/:5175/etc. A silently-moved port is worse
    // than a startup error: every stale browser tab/bookmark keeps pointing at
    // the wrong port with no indication why nothing works.
    port: 5173,
    strictPort: true,
    proxy: {
      // Points at the LOCAL DEV backend (see deploy notes) — the production
      // server on this same machine already occupies :3000, so local dev
      // always runs the backend on :3001 instead.
      '/api': 'http://localhost:3001',
    },
  },
})
