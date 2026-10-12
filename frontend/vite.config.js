import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {

    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    port: 5174,
    host: true,
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 5174,
      path: '/__vite/hmr',
    },
    proxy: {
      '/api': {
        target: 'http://localhost:8769',
        changeOrigin: true,
        secure: false,
      }
    }
  },
  optimizeDeps: {
    include: ['zustand', 'dayjs', 'axios', 'lucide-react', 'recharts']
  }
})
