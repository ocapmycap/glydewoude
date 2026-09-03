import { describe, expect, it } from 'vitest';

import { TREE_TYPES, WORLD_CONFIG } from '../src/constants.js';
import { distance2D } from '../src/math.js';
import { generateForest, nearestTree } from '../src/worldgen.js';
import { deriveGlideProfile, maxGlideRange } from '../src/glide.js';

describe('generateForest', () => {
  it('is deterministic for a seed', () => {
    expect(generateForest()).toEqual(generateForest());
    expect(generateForest({ seed: 'a' })).toEqual(generateForest({ seed: 'a' }));
  });

  it('produces a different forest for a different seed', () => {
    const a = generateForest({ seed: 'a' });
    const b = generateForest({ seed: 'b' });
    expect(a.trees.map((t) => t.position.x)).not.toEqual(b.trees.map((t) => t.position.x));
  });

  it('spawns on the great tree, which is the tallest thing in the forest', () => {
    const world = generateForest();
    const spawn = world.trees.find((tree) => tree.id === world.spawnTreeId);
    expect(spawn).toBeDefined();
    for (const tree of world.trees) {
      expect(tree.perchY).toBeLessThanOrEqual(spawn.perchY);
    }
  });

  it('keeps trunks apart and inside the area', () => {
    const world = generateForest();
    for (let i = 0; i < world.trees.length; i += 1) {
      const tree = world.trees[i];
      expect(Math.hypot(tree.position.x, tree.position.z))
        .toBeLessThanOrEqual(world.config.areaRadius + 1e-6);
      for (let j = i + 1; j < world.trees.length; j += 1) {
        expect(distance2D(tree.position, world.trees[j].position))
          .toBeGreaterThanOrEqual(Math.min(world.config.minSpacing, world.config.greatTree.canopyRadius));
      }
    }
  });

  it('tags destination trees inside the doc\'s 10-15% band', () => {
    const world = generateForest();
    const share = world.trees.filter((tree) => tree.isDestination).length / world.trees.length;
    expect(share).toBeGreaterThanOrEqual(0.08);
    expect(share).toBeLessThanOrEqual(0.18);
  });

  it('gives every destination tree a name and a known type', () => {
    const known = new Set(Object.values(TREE_TYPES));
    for (const tree of generateForest().trees) {
      expect(known.has(tree.type)).toBe(true);
      if (tree.isDestination) expect(typeof tree.name).toBe('string');
      else expect(tree.type).toBe(TREE_TYPES.SCENERY);
    }
  });

  it('derives coherent catch volumes for every tree', () => {
    for (const tree of generateForest().trees) {
      expect(tree.minCatchY).toBeGreaterThan(0);
      expect(tree.minCatchY).toBeLessThan(tree.perchY);
      expect(tree.perchRadius).toBeGreaterThanOrEqual(tree.catchRadius);
      expect(tree.canopyDepth).toBeGreaterThan(0);
    }
  });

  it('honours config overrides', () => {
    const small = generateForest({ areaRadius: 80, minSpacing: 30 });
    expect(small.trees.length).toBeLessThan(generateForest().trees.length);
    for (const tree of small.trees) {
      expect(Math.hypot(tree.position.x, tree.position.z)).toBeLessThanOrEqual(80 + 1e-6);
    }
  });

  it('leaves part of the forest out of reach of a single glide from spawn', () => {
    // The soft gate in miniature (§2.3): no walls, you just cannot make the
    // gap yet. Some trees are reachable in one hop from the great tree, and
    // some are not.
    const world = generateForest();
    const spawn = world.trees.find((tree) => tree.id === world.spawnTreeId);
    const reach = maxGlideRange(spawn.perchY, deriveGlideProfile());

    const reachable = world.trees.filter(
      (tree) => tree.id !== spawn.id && distance2D(spawn.position, tree.position) <= reach,
    );
    expect(reachable.length).toBeGreaterThan(0);
    expect(reachable.length).toBeLessThan(world.trees.length - 1);
  });
});

describe('nearestTree', () => {
  it('finds the closest tree and honours the exclusion', () => {
    const world = generateForest();
    const point = { x: 40, y: 0, z: 40 };
    const closest = nearestTree(world.trees, point);
    expect(closest).toBeDefined();

    const second = nearestTree(world.trees, point, closest.id);
    expect(second.id).not.toBe(closest.id);
    expect(distance2D(second.position, point))
      .toBeGreaterThanOrEqual(distance2D(closest.position, point));
  });

  it('returns null for an empty forest', () => {
    expect(nearestTree([], { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('WORLD_CONFIG', () => {
  it('asks for a destination share inside the documented band', () => {
    expect(WORLD_CONFIG.destinationRatio).toBeGreaterThanOrEqual(0.1);
    expect(WORLD_CONFIG.destinationRatio).toBeLessThanOrEqual(0.15);
  });
});
