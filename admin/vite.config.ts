import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
