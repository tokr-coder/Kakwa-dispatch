import { defineConfig } from 'vite'

export default defineConfig({
  // Source lives in site/. GitHub Actions publishes the dist folder.
  root: 'site',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
