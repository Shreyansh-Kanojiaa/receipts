import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/demo':     'http://localhost:8000',
      '/tools':    'http://localhost:8000',
      '/receipts': 'http://localhost:8000',
      '/verify':   'http://localhost:8000',
      '/stats':    'http://localhost:8000',
      '/sessions': 'http://localhost:8000',
      '/alerts':   'http://localhost:8000',
    },
  },
})
