import { defineConfig } from 'vite'

export default defineConfig({
  // Source lives in site/. The build is written to the repo root, which
  // GitHub Pages serves from this branch.
  root: 'site',
  base: './',
  publicDir: 'public',
  build: {
    outDir: '..',
    emptyOutDir: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
