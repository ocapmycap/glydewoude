import { describe, expect, it } from 'vitest';
import { distance2D, generateForest } from '@glidewood/shared';

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

describe('clinging (LAN-554)', () => {
  // A separate hand-built pair, carrying the trunkHeight/trunkRadius fields
  // the cling check needs, so the LAN-553 fixtures above stay untouched.
  const clingTower = {
    id: 'tree-cling-towering',
    towering: true,
    position: { x: 10, y: 0, z: 0 },
    perchY: null,
    minCatchY: 40,
    catchRadius: 5,
    trunkRadius: 2,
    trunkHeight: 100,
    perchRadius: 10,
    canopyDepth: 25,
  };
  const clingOrdinary = {
    id: 'tree-cling-ordinary',
    towering: false,
    position: { x: 50, y: 0, z: 0 },
    perchY: 20,
    minCatchY: 5,
    catchRadius: 3,
    perchRadius: 4,
    canopyDepth: 6,
  };
  const clingWorld = {
    config: { groundY: 0 },
    trees: [clingOrdinary, clingTower],
  };

  it('catches a side hit on the near surface, at the height it hit', () => {
    // Below minCatchY on purpose too — treeCatches would reject this height,
    // but clinging to a towering trunk has no such floor.
    const next = { x: clingTower.position.x + 3, y: 20, z: clingTower.position.z };
    const previous = { x: clingTower.position.x + 6, y: 21, z: clingTower.position.z };

    const landing = resolveLanding(clingWorld, previous, next);

    expect(landing.reason).toBe('cling');
    expect(landing.tree.id).toBe(clingTower.id);
    expect(landing.point.y).toBe(next.y);

    // The point sits exactly on the trunk surface (trunkRadius from centre)...
    expect(distance2D(clingTower.position, landing.point)).toBeCloseTo(clingTower.trunkRadius, 5);

    // ...on the same side the squirrel approached from: the direction from the
    // trunk centre to the catch point matches the direction to `next`.
    const toNext = {
      x: next.x - clingTower.position.x,
      z: next.z - clingTower.position.z,
    };
    const toPoint = {
      x: landing.point.x - clingTower.position.x,
      z: landing.point.z - clingTower.position.z,
    };
    const nextLength = Math.hypot(toNext.x, toNext.z);
    const pointLength = Math.hypot(toPoint.x, toPoint.z);
    expect(toPoint.x / pointLength).toBeCloseTo(toNext.x / nextLength, 5);
    expect(toPoint.z / pointLength).toBeCloseTo(toNext.z / nextLength, 5);
  });

  it('still clings when the hit is below minCatchY', () => {
    const next = { x: clingTower.position.x + 1, y: 5, z: clingTower.position.z };
    expect(next.y).toBeLessThan(clingTower.minCatchY);

    const landing = resolveLanding(clingWorld, { ...next, y: next.y + 1 }, next);

    expect(landing.reason).toBe('cling');
    expect(landing.tree.id).toBe(clingTower.id);
  });

  it('does not catch above the trunk top — that is canopy space, not trunk', () => {
    const trunkTop = clingTower.position.y + clingTower.trunkHeight;
    const next = { x: clingTower.position.x + 1, y: trunkTop + 10, z: clingTower.position.z };

    expect(resolveLanding(clingWorld, { ...next, y: next.y + 1 }, next)).toBeNull();
  });

  it('skips the cling on the tower just launched from', () => {
    const next = { x: clingTower.position.x + 1, y: 20, z: clingTower.position.z };
    // Without the guard this would cling — confirm the geometry alone would
    // have caught it before checking the guard suppresses it.
    expect(resolveLanding(clingWorld, { ...next, y: 21 }, next)?.reason).toBe('cling');

    expect(resolveLanding(clingWorld, { ...next, y: 21 }, next, clingTower.id)).toBeNull();
  });

  it('leaves an ordinary tree perching exactly as before', () => {
    const spot = {
      x: clingOrdinary.position.x,
      y: clingOrdinary.perchY - 0.5,
      z: clingOrdinary.position.z,
    };
    const landing = resolveLanding(clingWorld, { ...spot, y: spot.y + 1 }, spot);
    expect(landing.reason).toBe('perch');
    expect(landing.tree.id).toBe(clingOrdinary.id);
  });
});
