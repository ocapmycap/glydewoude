import { describe, expect, it } from 'vitest';
import { generateForest } from '@glidewood/shared';

import { resolveLanding, treeCatches } from '../src/sim/landing.js';

const world = generateForest();
// Pick a tree with a generous stretch of bare trunk below its canopy, so the
// two catch volumes can be tested independently of each other.
const tree = world.trees
  .filter((candidate) => candidate.id !== world.spawnTreeId)
  .reduce((best, candidate) => {
    const bare = (t) => t.perchY - t.canopyDepth - t.minCatchY;
    return bare(candidate) > bare(best) ? candidate : best;
  });
/** An altitude on the bare trunk, below the canopy and above the lowest branches. */
const bareTrunkY = (tree.minCatchY + (tree.perchY - tree.canopyDepth)) / 2;

function at(y, offset = 0) {
  return { x: tree.position.x + offset, y, z: tree.position.z };
}

describe('treeCatches', () => {
  it('catches a squirrel dropping into the canopy', () => {
    expect(treeCatches(tree, at(tree.perchY - 0.5))).toBe(true);
  });

  it('catches a squirrel flying into the upper trunk', () => {
    expect(bareTrunkY).toBeGreaterThan(tree.minCatchY);
    expect(treeCatches(tree, at(bareTrunkY, tree.catchRadius - 0.1))).toBe(true);
    expect(treeCatches(tree, at(bareTrunkY, tree.catchRadius + 2))).toBe(false);
  });

  it('lets a squirrel pass over the top and under the lowest branches', () => {
    expect(treeCatches(tree, at(tree.perchY + 0.5))).toBe(false);
    expect(treeCatches(tree, at(tree.minCatchY - 0.5))).toBe(false);
  });

  it('is wider at the canopy than at the trunk', () => {
    const offset = (tree.catchRadius + tree.perchRadius) / 2;
    expect(treeCatches(tree, at(tree.perchY - 0.2, offset))).toBe(true);
    expect(treeCatches(tree, at(bareTrunkY, offset))).toBe(false);
  });
});

describe('resolveLanding', () => {
  const high = { x: 0, y: 400, z: 0 };

  it('returns nothing in open air', () => {
    expect(resolveLanding(world, high, { x: 0, y: 399, z: 0 })).toBeNull();
  });

  it('recovers onto the nearest tree at ground contact', () => {
    const spot = { x: tree.position.x + 6, y: -0.1, z: tree.position.z };
    const landing = resolveLanding(world, { ...spot, y: 1 }, spot);
    expect(landing.reason).toBe('ground');
    expect(landing.tree.id).toBe(tree.id);
  });

  it('reports a mid-air catch as a perch', () => {
    const spot = at(tree.perchY - 0.5);
    const landing = resolveLanding(world, { ...spot, y: tree.perchY + 1 }, spot);
    expect(landing.reason).toBe('perch');
    expect(landing.tree.id).toBe(tree.id);
  });

  it('does not immediately re-catch the tree just launched from', () => {
    const spot = at(tree.perchY - 0.5);
    expect(resolveLanding(world, spot, spot, tree.id)).toBeNull();
  });
});
