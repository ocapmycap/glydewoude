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

describe('towering trees (LAN-553)', () => {
  // Hand-built, not the real forest: one ordinary tree and one towering tree
  // (no perch: perchY: null), with the towering tree deliberately the closer
  // of the two to the ground-contact point below.
  const toweringTree = {
    id: 'tree-towering',
    towering: true,
    position: { x: 2, y: 0, z: 0 },
    perchY: null,
    minCatchY: 40,
    catchRadius: 6,
    perchRadius: 10,
    canopyDepth: 25,
  };
  const ordinaryTree = {
    id: 'tree-ordinary',
    towering: false,
    position: { x: 20, y: 0, z: 0 },
    perchY: 20,
    minCatchY: 5,
    catchRadius: 3,
    perchRadius: 4,
    canopyDepth: 6,
  };
  const groundWorld = {
    config: { groundY: 0 },
    trees: [ordinaryTree, toweringTree],
  };

  it('treeCatches returns false for a towering tree at any height (no perch to climb to; clinging is LAN-554)', () => {
    for (const y of [-1, 0, toweringTree.minCatchY, toweringTree.minCatchY + 5, 500]) {
      expect(treeCatches(toweringTree, { x: toweringTree.position.x, y, z: toweringTree.position.z }))
        .toBe(false);
    }
  });

  it('resets ground contact next to a towering tree onto the nearest ordinary tree instead', () => {
    // Nearer to the towering tree than to the ordinary one, so an unfiltered
    // nearest-tree search would pick the towering tree — which has no perch
    // to climb, so the ground reset must skip past it.
    const spot = { x: 1, y: -0.1, z: 0 };
    const landing = resolveLanding(groundWorld, { ...spot, y: 1 }, spot);
    expect(landing.reason).toBe('ground');
    expect(landing.tree.id).toBe(ordinaryTree.id);
  });
});
