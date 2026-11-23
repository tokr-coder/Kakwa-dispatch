import { defineConfig } from 'vite'

export default defineConfig({
  // Relative asset paths work at the GitHub Pages project URL.
  base: './',
  build: {
    outDir: 'docs',
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
