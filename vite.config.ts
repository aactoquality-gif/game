import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: { input: { game: 'index.html', stats: 'stats-login.html' } },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
