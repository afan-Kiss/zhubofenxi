import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const rawBase = process.env.VITE_BASE_PATH?.trim() || '/'
const webBase =
  rawBase === '/' ? '/' : `/${rawBase.replace(/^\/+/, '').replace(/\/+$/, '')}/`
const normalizedBase = webBase

export default defineConfig({
  base: normalizedBase,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4723',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (
            id.includes('react-dom') ||
            id.includes('react-router-dom') ||
            id.includes('/react/')
          ) {
            return 'react-vendor'
          }
          if (id.includes('lucide-react')) {
            return 'lucide-vendor'
          }
          if (id.includes('recharts')) {
            return 'charts-vendor'
          }
        },
      },
    },
  },
})
