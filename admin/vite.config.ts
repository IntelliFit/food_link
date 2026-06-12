import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  appType: 'spa',
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
      '/test-backend': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
      '/static/test_backend': {
        target: 'http://127.0.0.1:3010',
        changeOrigin: true,
      },
    },
  },
})
