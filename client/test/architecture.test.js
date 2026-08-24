/**
 * The one architectural rule this codebase actually depends on.
 *
 * Everything under `client/src/sim` and `shared/src` must stay free of
 * Three.js. That is not tidiness — it is why the glide loop can be tested
 * headlessly at all, and why the Phase 2 server will be able to import the
 * same physics without pulling a renderer into Node.
 *
 * ESLint already blocks browser globals in those directories; this covers the
 * other half, the import graph.
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
