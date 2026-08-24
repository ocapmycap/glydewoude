import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2023 },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    // Simulation and shared logic must stay runtime-agnostic: no DOM, no
    // WebGL, no browser globals. This rule is what keeps the headless tests
    // possible, so it is enforced rather than documented and hoped for.
    files: ['shared/src/**/*.js', 'client/src/sim/**/*.js'],
    languageOptions: {
      globals: {
        // Switching the browser globals off (rather than just not adding them)
        // is what makes `no-undef` reject `document`, `window`, `performance`
        // and friends in here.
        ...Object.fromEntries(Object.keys(globals.browser).map((name) => [name, 'off'])),
        ...globals.es2023,
      },
    },
  },
  {
    files: ['**/test/**/*.js', 'vitest.config.js', 'eslint.config.js', '**/vite.config.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
  },
];
