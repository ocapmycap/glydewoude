import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the built bundle works from any static host or
  // subpath without a rebuild — the Phase 1 deliverable is a shareable link.
  base: './',
  server: {
    port: 5173,
    open: false,
    // Same-origin in development, so the client's default API base can stay
    // empty and nobody has to think about CORS to run the game locally. A
    // build served from somewhere other than its API sets VITE_API_URL instead.
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/healthz': { target: 'http://localhost:8787', changeOrigin: true },
    },
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
