/**
 * The architectural rules this codebase actually depends on.
 *
 * Everything under `client/src/sim` and `shared/src` must stay free of
 * Three.js. That is not tidiness — it is why the glide loop can be tested
 * headlessly at all, and why the Phase 2 server imports the same physics
 * without pulling a renderer into Node.
 *
 * Phase 2 added a second rule of the same kind. `client/src/net` is a fourth
 * peer under `main.js` (D-29), and the direction is one way: `main` reaches
 * for the network, `sim/` never does. A simulation that could call the server
 * would be a simulation that could not be replayed, and the intent ledgers
 * would have somewhere to quietly settle themselves.
 *
 * ESLint already blocks browser globals in the pure directories; this covers
 * the other half, the import graph.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function jsFilesUnder(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return jsFilesUnder(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

const RENDER_FREE = ['client/src/sim', 'shared/src'];

describe('render boundary', () => {
  it.each(RENDER_FREE)('%s does not import three', (relative) => {
    for (const file of jsFilesUnder(join(repoRoot, relative))) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} imports three`).not.toMatch(/from\s+['"]three['"]/);
      expect(source, `${file} imports a three subpath`).not.toMatch(/from\s+['"]three\//);
    }
  });

  it('the renderer is the only place three is imported from', () => {
    const offenders = jsFilesUnder(join(repoRoot, 'client/src'))
      .filter((file) => /from\s+['"]three['"]/.test(readFileSync(file, 'utf8')))
      .filter((file) => !file.includes(join('client', 'src', 'render')));
    expect(offenders).toEqual([]);
  });
});

const NET_FREE = ['client/src/sim', 'shared/src'];

describe('network boundary', () => {
  it.each(NET_FREE)('%s does not import the network layer', (relative) => {
    for (const file of jsFilesUnder(join(repoRoot, relative))) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} imports net/`).not.toMatch(/from\s+['"][^'"]*\/net\//);
    }
  });

  it('sim/ and shared/ never call fetch', () => {
    // A transport hidden inside the simulation would be invisible to the
    // import check above, so the call itself is barred too.
    for (const relative of NET_FREE) {
      for (const file of jsFilesUnder(join(repoRoot, relative))) {
        const source = readFileSync(file, 'utf8');
        expect(source, `${file} calls fetch`).not.toMatch(/\bfetch\s*\(/);
      }
    }
  });

  it('net/ stays free of the DOM, so it can be tested in Node', () => {
    // It is allowed browser globals that Node also has — fetch, setTimeout —
    // but the moment it touches `document` it stops being testable headlessly
    // and starts being UI.
    for (const file of jsFilesUnder(join(repoRoot, 'client/src/net'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} touches the DOM`).not.toMatch(/\bdocument\./);
      expect(source, `${file} touches window`).not.toMatch(/\bwindow\./);
    }
  });
});
