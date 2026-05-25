import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    // Projekt liegt auf einer SMB-Freigabe (NAS) -> native FS-Events sind unzuverlaessig,
    // daher Polling fuer zuverlaessiges HMR.
    watch: { usePolling: true, interval: 400 },
    proxy: {
      // Im Dev-Betrieb laeuft das Backend separat (Standard :3000).
      // Per BACKEND_URL ueberschreibbar, falls 3000 belegt ist.
      '/api': {
        target: process.env.BACKEND_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
