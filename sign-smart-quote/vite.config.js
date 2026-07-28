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
    proxy: {
      // 3000 is taken by another project on this machine (tenderos) — the
      // quote-system backend runs on 3010 instead, see `npm run start:local`.
      '/api': 'http://localhost:3010',
    },
  },
})
