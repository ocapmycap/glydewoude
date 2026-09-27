import { describe, expect, it } from 'vitest';

import {
  TREE_TYPES,
  WORLD_CONFIG,
  STRUCTURE_KINDS,
  PUZZLE_CONFIG,
  BASE_GLIDE_STATS,
  TOWERING_TREE_CONFIG,
} from '../src/constants.js';
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

  it('spawns on the great tree, which is the tallest ordinary thing in the forest', () => {
    // Narrowed to ordinary trees (LAN-553): towering trees are deliberately
    // taller than the great tree, so this can no longer hold over every tree.
    const world = generateForest();
    const spawn = world.trees.find((tree) => tree.id === world.spawnTreeId);
    expect(spawn).toBeDefined();
    for (const tree of world.trees.filter((candidate) => !candidate.towering)) {
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

  it('derives coherent catch volumes for every ordinary tree', () => {
    // Narrowed to ordinary trees (LAN-553): towering trees have no perch
    // (perchY: null), so "minCatchY below the perch" no longer applies to them.
    for (const tree of generateForest().trees.filter((candidate) => !candidate.towering)) {
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

describe('tree structures', () => {
  it('gives identical structures for repeated calls with the same seed', () => {
    expect(generateForest().trees.every((tree) => Array.isArray(tree.structures))).toBe(true);
    expect(generateForest().trees.map((tree) => tree.structures)).toEqual(
      generateForest().trees.map((tree) => tree.structures),
    );
    expect(generateForest({ seed: 'a' }).trees.map((tree) => tree.structures)).toEqual(
      generateForest({ seed: 'a' }).trees.map((tree) => tree.structures),
    );
  });

  it('gives different structures for a different seed', () => {
    const a = generateForest({ seed: 'a' }).trees.map((tree) => tree.structures);
    const b = generateForest({ seed: 'b' }).trees.map((tree) => tree.structures);
    expect(a).not.toEqual(b);
  });

  it('gives every destination tree one or two structures of a known kind', () => {
    const world = generateForest();
    const knownKinds = new Set(Object.values(STRUCTURE_KINDS));
    for (const tree of world.trees) {
      if (!tree.isDestination) continue;
      expect(tree.structures.length).toBeGreaterThanOrEqual(1);
      expect(tree.structures.length).toBeLessThanOrEqual(2);
      for (const structure of tree.structures) {
        expect(knownKinds.has(structure.kind)).toBe(true);
      }
    }
  });

  it('gives every scenery tree no structures', () => {
    const world = generateForest();
    for (const tree of world.trees) {
      if (!tree.isDestination) expect(tree.structures).toEqual([]);
    }
  });

  it('places every structure inside or just under its tree\'s canopy, with a finite rotation', () => {
    for (const seed of ['a', 'b', 'c', undefined]) {
      const world = seed === undefined ? generateForest() : generateForest({ seed });
      for (const tree of world.trees) {
        for (const structure of tree.structures) {
          expect(Math.hypot(structure.offset.x, structure.offset.z))
            .toBeLessThanOrEqual(tree.canopyRadius);

          const worldY = tree.position.y + structure.offset.y;
          expect(worldY).toBeGreaterThanOrEqual(tree.perchY - tree.canopyDepth);
          expect(worldY).toBeLessThanOrEqual(tree.perchY);

          expect(Number.isFinite(structure.rotation)).toBe(true);
        }
      }
    }
  });

  it('gives the great tree a platform', () => {
    const world = generateForest();
    const great = world.trees.find((tree) => tree.id === 'tree-great');
    expect(great.structures.some((s) => s.kind === STRUCTURE_KINDS.PLATFORM)).toBe(true);
  });

  it('uses both structure kinds somewhere in the default forest', () => {
    const world = generateForest();
    const kinds = new Set(world.trees.flatMap((tree) => tree.structures.map((s) => s.kind)));
    expect(kinds.has(STRUCTURE_KINDS.DREY)).toBe(true);
    expect(kinds.has(STRUCTURE_KINDS.PLATFORM)).toBe(true);
  });
});

describe('WORLD_CONFIG', () => {
  it('asks for a destination share inside the documented band', () => {
    expect(WORLD_CONFIG.destinationRatio).toBeGreaterThanOrEqual(0.1);
    expect(WORLD_CONFIG.destinationRatio).toBeLessThanOrEqual(0.15);
  });
});

describe('puzzle trees', () => {
  const magnitude = (v) => Math.hypot(v.x, v.y, v.z);

  /**
   * Check the invariants a puzzle course must hold, independent of exact
   * placement: the target is a real, different, downhill-reachable tree in
   * one base-stat glide, and the rings step down between the two perches,
   * staying on the ground track between them and facing the target.
   */
  function expectValidCourse(puzzleTree, course, treesById) {
    expect(course).toBeTruthy();
    expect(course.rings.length).toBe(PUZZLE_CONFIG.ringCount);

    const target = treesById.get(course.targetTreeId);
    expect(target).toBeDefined();
    expect(target.id).not.toBe(puzzleTree.id);

    // Stricter reachability rule (LAN-546): range is computed from the drop
    // to the *target's* perch, so the target must sit lower than the puzzle
    // tree, not just be in range some other way.
    expect(target.perchY).toBeLessThan(puzzleTree.perchY);
    const profile = deriveGlideProfile(BASE_GLIDE_STATS);
    const reach = maxGlideRange(puzzleTree.perchY - target.perchY, profile);
    const horizontalGap = distance2D(puzzleTree.position, target.position);
    expect(horizontalGap).toBeLessThanOrEqual(reach);

    const dx = target.position.x - puzzleTree.position.x;
    const dz = target.position.z - puzzleTree.position.z;
    const segmentLength = Math.hypot(dx, dz);

    let previousY = Infinity;
    for (const ring of course.rings) {
      expect(ring.radius).toBeGreaterThan(0);
      expect(magnitude(ring.normal)).toBeCloseTo(1, 6);

      // Descends strictly, ring over ring.
      expect(ring.center.y).toBeLessThan(previousY);
      previousY = ring.center.y;

      // Sits between the two perches...
      expect(ring.center.y).toBeLessThan(puzzleTree.perchY);
      expect(ring.center.y).toBeGreaterThan(target.perchY);

      // ...and between the two trees along the ground track, not off to the
      // side or beyond either end.
      const rx = ring.center.x - puzzleTree.position.x;
      const rz = ring.center.z - puzzleTree.position.z;
      const along = (rx * dx + rz * dz) / segmentLength;
      expect(along).toBeGreaterThan(0);
      expect(along).toBeLessThan(segmentLength);

      // Normal faces roughly toward the target, not back at the puzzle tree.
      const facing = ring.normal.x * dx + ring.normal.z * dz;
      expect(facing).toBeGreaterThan(0);
    }
  }

  function puzzleTreesOf(world) {
    return world.trees.filter((tree) => tree.type === TREE_TYPES.PUZZLE);
  }

  it('is deterministic for a seed', () => {
    const a1 = generateForest();
    const a2 = generateForest();
    expect(puzzleTreesOf(a1)).toEqual(puzzleTreesOf(a2));
    expect(a1.trees.map((t) => t.course)).toEqual(a2.trees.map((t) => t.course));

    const b1 = generateForest({ seed: 'a' });
    const b2 = generateForest({ seed: 'a' });
    expect(puzzleTreesOf(b1)).toEqual(puzzleTreesOf(b2));
    expect(b1.trees.map((t) => t.course)).toEqual(b2.trees.map((t) => t.course));
  });

  it('produces 2-3 valid puzzle trees for several different seeds, not just the default', () => {
    for (const seed of ['a', 'b', 'c']) {
      const world = generateForest({ seed });
      const treesById = new Map(world.trees.map((t) => [t.id, t]));
      const puzzles = puzzleTreesOf(world);

      expect(puzzles.length).toBeGreaterThanOrEqual(2);
      expect(puzzles.length).toBeLessThanOrEqual(3);

      for (const puzzle of puzzles) {
        expect(puzzle.id).not.toBe('tree-great');
        expectValidCourse(puzzle, puzzle.course, treesById);
      }
    }
  });

  it('turns 2-3 destination trees into puzzle trees, never the great tree', () => {
    const world = generateForest();
    const puzzles = puzzleTreesOf(world);

    expect(puzzles.length).toBeGreaterThanOrEqual(2);
    expect(puzzles.length).toBeLessThanOrEqual(3);

    for (const tree of puzzles) {
      expect(tree.id).not.toBe('tree-great');
      expect(tree.isDestination).toBe(true);
      expect(typeof tree.name).toBe('string');
      expect(tree.structures.length).toBeGreaterThanOrEqual(1);
      expect(tree.structures.length).toBeLessThanOrEqual(2);
    }
  });

  it('gives every puzzle tree a course that satisfies the reachability and ring invariants', () => {
    const world = generateForest();
    const treesById = new Map(world.trees.map((t) => [t.id, t]));
    for (const puzzle of puzzleTreesOf(world)) {
      expectValidCourse(puzzle, puzzle.course, treesById);
    }
  });

  it('leaves every non-puzzle tree with course: null', () => {
    const world = generateForest();
    for (const tree of world.trees) {
      if (tree.type !== TREE_TYPES.PUZZLE) expect(tree.course).toBeNull();
    }
  });

  it('does not disturb the rest of the forest layout', () => {
    // Puzzle selection has to draw from a salted rng, not the main worldgen
    // stream (LAN-546) — otherwise picking puzzle trees would ripple through
    // every position, height and destination roll that follows it. This
    // snapshot was taken before puzzle trees existed, so any change here
    // means the puzzle feature leaked into the shared stream.
    //
    // Narrowed to ordinary trees (LAN-553): towering trees are appended after
    // this snapshot was taken, on their own salted rng stream, exactly like
    // puzzle courses were — the same reasoning applies to them.
    const world = generateForest();
    const ordinary = world.trees.filter((tree) => !tree.towering);
    expect(ordinary.length).toBe(187);

    const destinations = ordinary.filter((tree) => tree.isDestination);
    expect(destinations.length).toBe(22);
    expect(destinations.map((tree) => tree.id)).toEqual([
      'tree-great', 'tree-002', 'tree-015', 'tree-022', 'tree-028', 'tree-030',
      'tree-034', 'tree-051', 'tree-063', 'tree-064', 'tree-070', 'tree-073',
      'tree-075', 'tree-089', 'tree-112', 'tree-125', 'tree-129', 'tree-131',
      'tree-137', 'tree-148', 'tree-169', 'tree-179',
    ]);

    const layout = JSON.stringify(
      ordinary.map((t) => [t.id, t.position.x, t.position.y, t.position.z, t.trunkHeight, t.perchY]),
    );
    let hash = 0;
    for (let i = 0; i < layout.length; i += 1) {
      hash = (hash * 31 + layout.charCodeAt(i)) >>> 0;
    }
    expect(hash).toBe(1087449072);
  });

  it('freezes PUZZLE_CONFIG and keeps treeCount in the 2-3 band', () => {
    expect(Object.isFrozen(PUZZLE_CONFIG)).toBe(true);
    expect(PUZZLE_CONFIG.treeCount).toBeGreaterThanOrEqual(2);
    expect(PUZZLE_CONFIG.treeCount).toBeLessThanOrEqual(3);
    expect(PUZZLE_CONFIG.ringCount).toBe(3);
  });
});

describe('towering trees (LAN-553)', () => {
  /** Tiny FNV-1a — good enough to fingerprint a layout, not to hash passwords. */
  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  const round = (n) => Math.round(n * 1e6) / 1e6;

  function ordinaryTreesOf(world) {
    return world.trees.filter((tree) => !tree.towering);
  }

  function toweringTreesOf(world) {
    return world.trees.filter((tree) => tree.towering);
  }

  // Pinned against the code as it existed immediately before LAN-553, from
  // generateForest() with the default seed: 187 trees, fingerprinted as
  // `id|type|x|y|z` (positions rounded to 1e-6) and folded with the FNV-1a
  // above. Proves towering trees do not disturb a single existing tree.
  const PINNED_ORDINARY_TREE_COUNT = 187;
  const PINNED_ORDINARY_TREES_HASH = 1112669281;

  it('leaves the pre-LAN-553 trees, in order, byte-for-byte identical', () => {
    const world = generateForest();
    // The pin was taken over the *first* 187 trees, so this assertion has to
    // hold however towering trees are appended, not just once the ordinary
    // count happens to match.
    const firstOrdinary = world.trees.slice(0, PINNED_ORDINARY_TREE_COUNT);
    const fingerprint = firstOrdinary
      .map((t) => `${t.id}|${t.type}|${round(t.position.x)}|${round(t.position.y)}|${round(t.position.z)}`)
      .join('\n');
    expect(fnv1a(fingerprint)).toBe(PINNED_ORDINARY_TREES_HASH);
  });

  it('appends exactly TOWERING_TREE_CONFIG.count towering trees to the end of world.trees', () => {
    const world = generateForest();
    expect(world.trees.length).toBe(PINNED_ORDINARY_TREE_COUNT + TOWERING_TREE_CONFIG.count);

    const tail = world.trees.slice(-TOWERING_TREE_CONFIG.count);
    expect(tail.every((tree) => tree.towering === true)).toBe(true);
    // And nothing earlier in the array is towering — they are strictly
    // appended, not interleaved.
    const head = world.trees.slice(0, world.trees.length - TOWERING_TREE_CONFIG.count);
    expect(head.every((tree) => tree.towering === false)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = toweringTreesOf(generateForest());
    const b = toweringTreesOf(generateForest());
    expect(a).toEqual(b);

    const c = toweringTreesOf(generateForest({ seed: 'a' }));
    const d = toweringTreesOf(generateForest({ seed: 'a' }));
    expect(c).toEqual(d);
  });

  it('gives every towering tree its own scenery type, no destination and no perch', () => {
    const world = generateForest();
    for (const tree of toweringTreesOf(world)) {
      expect(tree.type).toBe(TREE_TYPES.SCENERY);
      expect(tree.isDestination).toBe(false);
      expect(tree.perchY).toBeNull();
      expect(Number.isFinite(tree.minCatchY)).toBe(true);
      expect(Number.isFinite(tree.catchRadius)).toBe(true);
    }
  });

  it('marks every ordinary tree towering: false', () => {
    const world = generateForest();
    for (const tree of ordinaryTreesOf(world)) {
      expect(tree.towering).toBe(false);
    }
  });

  it('makes every towering tree taller than every ordinary tree, including the great tree', () => {
    const world = generateForest();
    const ordinary = ordinaryTreesOf(world);
    const towering = toweringTreesOf(world);
    expect(towering.length).toBeGreaterThan(0);

    const tallestOrdinaryTrunk = Math.max(...ordinary.map((t) => t.trunkHeight));
    const tallestOrdinaryTop = Math.max(...ordinary.map((t) => t.position.y + t.trunkHeight));

    for (const tree of towering) {
      expect(tree.trunkHeight).toBeGreaterThan(tallestOrdinaryTrunk);
      expect(tree.position.y + tree.trunkHeight).toBeGreaterThan(tallestOrdinaryTop);
    }
  });

  it('sizes towering trunks 2.5-3.5x the tallest ordinary trunk range', () => {
    const world = generateForest();
    const [, tallestOrdinary] = WORLD_CONFIG.trunkHeightRange;
    for (const tree of toweringTreesOf(world)) {
      expect(tree.trunkHeight).toBeGreaterThanOrEqual(2.5 * tallestOrdinary);
      expect(tree.trunkHeight).toBeLessThanOrEqual(3.5 * tallestOrdinary);
    }
  });

  it('gives towering trunks and canopies wider than any ordinary tree', () => {
    const world = generateForest();
    const ordinary = ordinaryTreesOf(world);
    const maxOrdinaryTrunkRadius = Math.max(...ordinary.map((t) => t.trunkRadius));
    const maxOrdinaryCanopyRadius = Math.max(...ordinary.map((t) => t.canopyRadius));

    for (const tree of toweringTreesOf(world)) {
      expect(tree.trunkRadius).toBeGreaterThan(maxOrdinaryTrunkRadius);
      expect(tree.canopyRadius).toBeGreaterThan(maxOrdinaryCanopyRadius);
    }
  });

  it('places towering trees in the outer half of the forest, well clear of every other tree', () => {
    const world = generateForest();
    const ordinary = ordinaryTreesOf(world);
    const towering = toweringTreesOf(world);
    const origin = { x: 0, y: 0, z: 0 };

    for (const tree of towering) {
      const radial = distance2D(origin, tree.position);
      expect(radial).toBeGreaterThanOrEqual(world.config.areaRadius / 2);
      expect(radial).toBeLessThanOrEqual(world.config.areaRadius + 1e-6);

      for (const other of ordinary) {
        expect(distance2D(tree.position, other.position))
          .toBeGreaterThanOrEqual(world.config.minSpacing);
      }
    }

    // Well apart from each other — a loose bound, not a tuned exact spacing.
    for (let i = 0; i < towering.length; i += 1) {
      for (let j = i + 1; j < towering.length; j += 1) {
        expect(distance2D(towering[i].position, towering[j].position))
          .toBeGreaterThanOrEqual(4 * world.config.minSpacing);
      }
    }
  });

  it('freezes TOWERING_TREE_CONFIG and defaults to 4 towering trees', () => {
    expect(Object.isFrozen(TOWERING_TREE_CONFIG)).toBe(true);
    expect(TOWERING_TREE_CONFIG.count).toBe(4);
  });
});
