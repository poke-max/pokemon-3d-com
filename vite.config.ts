import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Rutea las llamadas del simulador (manual/start/state/command) al dev server de game en 5173.
      '/api': {
        target: 'http://localhost:5173',
        changeOrigin: true,
      },
    },
  },
})
