import { describe, expect, it } from 'vitest';

import { MATERIAL_CONFIG, MATERIAL_TABLE, MATERIAL_TYPES } from '../src/constants.js';
import { generateForest } from '../src/worldgen.js';
import {
  effortFor,
  emptyMaterialTotals,
  generateMaterialCaches,
  indexCachesByTree,
  materialEffortScale,
  pickMaterial,
  sumMaterials,
} from '../src/materials.js';
import { createRng } from '../src/rng.js';

const world = generateForest();
const caches = generateMaterialCaches(world);
const MATERIALS = Object.values(MATERIAL_TYPES);

describe('generateMaterialCaches', () => {
  it('is deterministic for a world', () => {
    expect(generateMaterialCaches(generateForest())).toEqual(caches);
  });

  it('places a different layout for a different seed', () => {
    const other = generateMaterialCaches(generateForest({ seed: 'somewhere-else' }));
    expect(other.map((c) => c.material)).not.toEqual(caches.map((c) => c.material));
  });

  it('does not consume the worldgen random stream', () => {
    // Trees must be identical whether or not caches were generated, otherwise
    // retuning materials would silently move the whole forest.
    const before = generateForest();
    generateMaterialCaches(before);
    expect(generateForest()).toEqual(before);
  });

  it('puts at most one cache on a tree, and never on the spawn tree', () => {
    const treeIds = caches.map((cache) => cache.treeId);
    expect(new Set(treeIds).size).toBe(treeIds.length);
    expect(treeIds).not.toContain(world.spawnTreeId);
  });

  it('covers a sensible share of the forest', () => {
    const share = caches.length / world.trees.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.7);
  });

  it('gives every cache a known material, a positive amount, and a position', () => {
    for (const cache of caches) {
      expect(MATERIALS).toContain(cache.material);
      const [min, max] = MATERIAL_TABLE[cache.material].amount;
      expect(cache.amount).toBeGreaterThanOrEqual(min);
      expect(cache.amount).toBeLessThanOrEqual(max);
      expect(cache.effort).toBeGreaterThanOrEqual(0);
      expect(cache.effort).toBeLessThanOrEqual(1);
      expect(Number.isFinite(cache.position.x)).toBe(true);
      expect(Number.isFinite(cache.position.y)).toBe(true);
    }
  });

  it('sits each cache just above the perch of its tree', () => {
    for (const cache of caches) {
      const tree = world.trees.find((candidate) => candidate.id === cache.treeId);
      expect(cache.position.y).toBeCloseTo(tree.perchY + MATERIAL_CONFIG.cacheHeightOffset, 6);
    }
  });

  it('honours a cacheChance override', () => {
    expect(generateMaterialCaches(world, { cacheChance: 0 })).toHaveLength(0);
    expect(generateMaterialCaches(world, { cacheChance: 1 }).length)
      .toBe(world.trees.length - 1);
  });

  it('copes with an empty forest', () => {
    const empty = { ...world, trees: [], spawnTreeId: 'nope' };
    expect(generateMaterialCaches(empty)).toEqual([]);
  });
});

describe('rarity is gated by effort, not by grind', () => {
  // This is the product doc's §3.3 requirement expressed as a test: the scarce
  // materials should sit on the trees that are hard to reach.
  const byEffort = [...caches].sort((a, b) => a.effort - b.effort);
  const third = Math.floor(byEffort.length / 3);
  const easiest = byEffort.slice(0, third);
  const hardest = byEffort.slice(-third);
  const rarityOf = (group) =>
    group.reduce((sum, c) => sum + MATERIAL_TABLE[c.material].rarity, 0) / group.length;

  it('concentrates rare materials on high-effort trees', () => {
    expect(rarityOf(hardest)).toBeGreaterThan(rarityOf(easiest));
  });

  it('keeps the rarest material off the easy trees entirely', () => {
    expect(easiest.some((c) => c.material === MATERIAL_TYPES.BERRIES)).toBe(false);
  });

  it('keeps the rarest material genuinely scarce overall', () => {
    const berries = caches.filter((c) => c.material === MATERIAL_TYPES.BERRIES);
    expect(berries.length).toBeGreaterThan(0);
    expect(berries.length / caches.length).toBeLessThan(0.15);
  });
});

describe('effortFor', () => {
  const scale = materialEffortScale(world);

  it('spans the full 0..1 range across the forest', () => {
    const efforts = world.trees
      .filter((tree) => tree.id !== world.spawnTreeId)
      .map((tree) => effortFor(tree, world, scale));
    expect(Math.min(...efforts)).toBeLessThan(0.05);
    expect(Math.max(...efforts)).toBeGreaterThan(0.95);
  });

  it('rates a far, tall tree above a near, short one', () => {
    const scored = world.trees
      .filter((tree) => tree.id !== world.spawnTreeId)
      .map((tree) => ({ tree, effort: effortFor(tree, world, scale) }))
      .sort((a, b) => a.effort - b.effort);
    expect(scored.at(-1).effort).toBeGreaterThan(scored[0].effort);
  });

  it('computes its own scale when none is passed', () => {
    const tree = world.trees.find((candidate) => candidate.id !== world.spawnTreeId);
    expect(effortFor(tree, world)).toBeCloseTo(effortFor(tree, world, scale), 10);
  });

  it('does not divide by zero on a single-tree forest', () => {
    const lonely = { ...world, trees: [world.trees[1]], spawnTreeId: 'absent' };
    expect(Number.isFinite(effortFor(world.trees[1], lonely))).toBe(true);
  });
});

describe('pickMaterial', () => {
  it('always returns a known material', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i += 1) {
      expect(MATERIALS).toContain(pickMaterial(rng, rng()));
    }
  });

  it('returns rarer material more often at high effort', () => {
    const meanRarity = (effort) => {
      const rng = createRng(11);
      let total = 0;
      for (let i = 0; i < 2000; i += 1) {
        total += MATERIAL_TABLE[pickMaterial(rng, effort)].rarity;
      }
      return total / 2000;
    };
    expect(meanRarity(1)).toBeGreaterThan(meanRarity(0));
  });
});

describe('totals helpers', () => {
  it('starts every material at zero rather than undefined', () => {
    const totals = emptyMaterialTotals();
    for (const material of MATERIALS) expect(totals[material]).toBe(0);
  });

  it('sums amounts by material and ignores unknown ones', () => {
    const totals = sumMaterials([
      { material: MATERIAL_TYPES.ACORNS, amount: 2 },
      { material: MATERIAL_TYPES.ACORNS, amount: 3 },
      { material: MATERIAL_TYPES.SILK, amount: 1 },
      { material: 'moonstone', amount: 99 },
    ]);
    expect(totals[MATERIAL_TYPES.ACORNS]).toBe(5);
    expect(totals[MATERIAL_TYPES.SILK]).toBe(1);
    expect(totals.moonstone).toBeUndefined();
  });
});

describe('indexCachesByTree', () => {
  it('maps each tree to its cache', () => {
    const index = indexCachesByTree(caches);
    expect(index.size).toBe(caches.length);
    expect(index.get(caches[0].treeId)).toBe(caches[0]);
  });
});
