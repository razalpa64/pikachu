import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // The relay writes match history to .pikachu-data while you play. Without this the
    // dev watcher would full-reload every client the instant a match finishes and wipe
    // the result screen. scripts/ and dist/ are never imported by the app either.
    watch: { ignored: ['**/.pikachu-data/**', '**/scripts/**', '**/dist/**', '**/supabase/**'] },
    proxy: {
      '/rt': { target: 'ws://127.0.0.1:8787', ws: true, changeOrigin: true },
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/chess.js')) return 'chess-engine'
          if (id.includes('node_modules/react')) return 'react-vendor'
          if (id.includes('node_modules/@supabase')) return 'supabase'
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any)
