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
      // Backend port — matches `npm run start:local` (src/server.js defaults to
      // 3000). If another project ever grabs 3000, start the backend with
      // PORT=xxxx and change this to match.
      '/api': 'http://localhost:3000',
    },
  },
})
