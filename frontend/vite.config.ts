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
      // Im Dev-Betrieb laeuft das Backend separat auf :3000
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
