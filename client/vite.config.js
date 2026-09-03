import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the built bundle works from any static host or
  // subpath without a rebuild — the Phase 1 deliverable is a shareable link.
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // Three.js alone is ~500 kB minified (~130 kB gzipped) and is a single
    // hard dependency of the first frame, so code-splitting it would only move
    // the wait around. Raised so the warning stays meaningful for our own code.
    chunkSizeWarningLimit: 700,
  },
});
