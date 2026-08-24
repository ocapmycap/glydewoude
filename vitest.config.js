import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node only. Nothing under test touches the DOM or WebGL — rendering is
    // quarantined in client/src/render so the whole simulation stays headless.
    environment: 'node',
    include: ['{shared,client}/test/**/*.test.js'],
  },
});
