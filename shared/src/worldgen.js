/**
 * Deterministic forest layout.
 *
 * Given a seed this always produces the identical forest, on any machine, in
 * any process. That matters three ways: the headless tests can assert on
 * specific trees, two players in Phase 3 see the same forest without syncing a
 * tree table, and the Phase 2 server can validate a claimed position against
 * the same geometry the client used (§6.1).
 *
 * Pure — imports nothing from the client and touches no Three.js.
 */

import { TREE_TYPES, WORLD_CONFIG, STRUCTURE_KINDS, PUZZLE_CONFIG } from './constants.js';
import { createRng, hashSeed, randRange, randPick } from './rng.js';
import { distance2D } from './math.js';
import { deriveGlideProfile, maxGlideRange } from './glide.js';

/**
 * @typedef {object} Tree
 * @property {string} id
 * @property {string} type          one of TREE_TYPES
 * @property {boolean} isDestination
 * @property {string} [name]        set on landmarks, shown on landing
 * @property {{x:number,y:number,z:number}} position  trunk base
 * @property {number} trunkHeight
 * @property {number} trunkRadius
 * @property {number} canopyRadius
 * @property {number} perchY        altitude of the launch branch
 * @property {number} perchRadius   canopy radius you can drop into from above
 * @property {number} canopyDepth   how far below the perch the canopy catches you
 * @property {number} catchRadius   trunk grab radius, below the canopy
 * @property {number} minCatchY     lowest altitude at which the trunk catches you
 * @property {Array<{kind:string, offset:{x:number,y:number,z:number}, rotation:number}>} structures
 *   Decorative dreys/platforms tucked into the canopy, relative to `position`.
 *   Drawing only — nothing in landing or glide reads this.
 * @property {?{targetTreeId:string, rings:Array<{center:{x:number,y:number,z:number}, normal:{x:number,y:number,z:number}, radius:number}>}} course
 *   Set only on TREE_TYPES.PUZZLE trees; null everywhere else.
 */

const LANDMARK_NAMES = [
  'Hollow Beacon',
  'Windward Pine',
  'The Leaning Elder',
  'Mossbank Perch',
  'Split Cedar',
  'Rookery Spire',
  'Amber Lookout',
  'Thistledown Bough',
  'Quiet Larch',
  'Far Watchtree',
  'Bramble Crown',
  'Old Nutfall',
];

function makeTree(id, spec, config) {
  const perchY = spec.position.y + spec.trunkHeight;
  return {
    id,
    type: spec.type,
    isDestination: spec.type !== TREE_TYPES.SCENERY,
    name: spec.name,
    position: spec.position,
    trunkHeight: spec.trunkHeight,
    trunkRadius: spec.trunkRadius,
    canopyRadius: spec.canopyRadius,
    perchY,
    perchRadius: Math.max(config.perchRadius, spec.canopyRadius),
    canopyDepth: spec.canopyRadius * config.canopyDepthFactor,
    catchRadius: spec.trunkRadius + config.catchMargin,
    minCatchY: spec.position.y + spec.trunkHeight * config.minCatchHeightFraction,
    structures: [],
    course: null,
  };
}

/**
 * Roll one structure's placement, tucked into or just under the canopy.
 * offset is relative to `tree.position` (the trunk base).
 */
function rollStructure(rng, tree, kind) {
  const angle = rng() * Math.PI * 2;
  // Keep it well inside the canopy silhouette, never at the very edge.
  const horizontal = randRange(rng, 0.25, 0.7) * tree.canopyRadius;
  return {
    kind,
    offset: {
      x: Math.cos(angle) * horizontal,
      y: tree.trunkHeight - randRange(rng, 0.1, 0.45) * tree.canopyDepth,
      z: Math.sin(angle) * horizontal,
    },
    rotation: rng() * Math.PI * 2,
  };
}

/**
 * Decide a destination tree's structures.
 *
 * Called in a pass *after* every tree is built, not inside the per-tree
 * construction loop above — consuming the rng there would shift every later
 * tree's height, radius and destination roll and change the whole forest
 * layout. Walking `trees` in order afterwards keeps the scatter identical and
 * just continues the same rng stream for decoration.
 */
function placeStructures(rng, tree) {
  if (!tree.isDestination) return [];

  if (tree.id === 'tree-great') {
    const structures = [rollStructure(rng, tree, STRUCTURE_KINDS.PLATFORM)];
    if (rng() < 0.5) {
      structures.push(rollStructure(rng, tree, randPick(rng, Object.values(STRUCTURE_KINDS))));
    }
    return structures;
  }

  const count = rng() < 0.5 ? 1 : 2;
  const structures = [];
  for (let i = 0; i < count; i += 1) {
    structures.push(rollStructure(rng, tree, randPick(rng, Object.values(STRUCTURE_KINDS))));
  }
  return structures;
}

/**
 * Scatter trunks across the disc with a minimum spacing, by dart throwing.
 * Not a true Poisson-disc sample — just rejection sampling, which is plenty
 * even and about ten lines shorter.
 */
function scatterPositions(rng, config) {
  const placed = [];
  for (let attempt = 0; attempt < config.placementAttempts; attempt += 1) {
    // sqrt keeps the distribution even across the disc instead of clumping
    // at the centre.
    const radius = Math.sqrt(rng()) * config.areaRadius;
    const angle = rng() * Math.PI * 2;
    const candidate = { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };

    // Keep a clearing around the great tree so the spawn launch is unobstructed.
    if (Math.hypot(candidate.x, candidate.z) < config.greatTree.canopyRadius + config.minSpacing) {
      continue;
    }
    const tooClose = placed.some((p) => distance2D(p, candidate) < config.minSpacing);
    if (!tooClose) placed.push(candidate);
  }
  return placed;
}

/** The point a glide actually launches from and lands on: the trunk position at perch height. */
function perchPoint(tree) {
  return { x: tree.position.x, y: tree.perchY, z: tree.position.z };
}

/** Unit vector from `from` to `to`, in full 3D — used as a ring's facing. */
function directionBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return { x: dx / length, y: dy / length, z: dz / length };
}

/**
 * Sample the straight line between two perch points at ~1 m steps and check
 * none of them fall inside another tree's catch volume, so a course never
 * sends a pilot straight through foliage that would catch them mid-flight.
 *
 * Mirrors `treeCatches` in client/src/sim/landing.js — shared cannot import
 * client code, so the catch-volume geometry is reproduced here. Keep the two
 * in step if landing's catch rule ever changes. The horizontal radius is
 * inflated by the ring radius so the ring itself clears the foliage too, not
 * just the flight line through its centre.
 */
function pathIsClear(from, to, trees, ignoreIds) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  const steps = Math.max(PUZZLE_CONFIG.ringCount + 1, Math.ceil(length));

  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const point = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };

    for (const tree of trees) {
      if (ignoreIds.has(tree.id)) continue;
      if (point.y > tree.perchY || point.y < tree.minCatchY) continue;
      const horizontal = distance2D(tree.position, point);
      const inCanopy = point.y >= tree.perchY - tree.canopyDepth;
      const radius = (inCanopy ? tree.perchRadius : tree.catchRadius) + PUZZLE_CONFIG.ringRadius;
      if (horizontal <= radius) return false;
    }
  }
  return true;
}

/**
 * Trees `candidate` could send a puzzle course to: lower, in range of a
 * base-stat glide with slack (PUZZLE_CONFIG.reachMargin), far enough away for
 * rings to have room, never the great tree, the candidate itself, or a tree
 * already chosen as a puzzle (a course must not end on another puzzle), and
 * with a straight path that does not fly through another tree's canopy.
 */
function validTargets(candidate, trees, excludedIds, profile) {
  const from = perchPoint(candidate);
  return trees.filter((target) => {
    if (target.id === 'tree-great') return false;
    if (target.id === candidate.id) return false;
    if (excludedIds.has(target.id)) return false;
    if (target.perchY >= candidate.perchY) return false;

    const horizontalGap = distance2D(candidate.position, target.position);
    if (horizontalGap < PUZZLE_CONFIG.minTargetDistance) return false;

    const reach = PUZZLE_CONFIG.reachMargin
      * maxGlideRange(candidate.perchY - target.perchY, profile);
    if (horizontalGap > reach) return false;

    // The launch guard covers the puzzle tree itself, and arriving at the
    // target is the point of the course, so both ends are exempt from their
    // own catch volumes when checking the path between them.
    return pathIsClear(from, perchPoint(target), trees, new Set([candidate.id, target.id]));
  });
}

/**
 * Lay out a course's rings evenly along the straight line between the two
 * perch points, each one lower than the last, all facing the target. No
 * lateral jitter — a pilot has to be able to fly this on a line.
 */
function buildCourse(puzzleTree, target) {
  const from = perchPoint(puzzleTree);
  const to = perchPoint(target);
  const normal = directionBetween(from, to);

  const rings = [];
  for (let i = 1; i <= PUZZLE_CONFIG.ringCount; i += 1) {
    const t = i / (PUZZLE_CONFIG.ringCount + 1);
    rings.push({
      center: {
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + (to.z - from.z) * t,
      },
      // Own copy per ring so nothing downstream can mutate one ring's normal
      // and silently affect the others.
      normal: { ...normal },
      radius: PUZZLE_CONFIG.ringRadius,
    });
  }
  return { targetTreeId: target.id, rings };
}

/**
 * Turn a handful of destination trees into puzzle trees, each with a ring
 * course down to a reachable, lower tree.
 *
 * Runs on its own rng stream, salted like `generateMaterialCaches` does
 * ((seed ^ PUZZLE_CONFIG.seedSalt) >>> 0), and only after every tree's
 * position, height and structures are settled — drawing from the main
 * worldgen stream here would shift every roll that follows and change the
 * whole forest layout every time puzzle selection was retuned.
 */
function placePuzzleCourses(trees, seed) {
  const rng = createRng((seed ^ PUZZLE_CONFIG.seedSalt) >>> 0);
  const profile = deriveGlideProfile();

  const targetIdByPuzzleId = new Map();
  let remaining = trees.filter((tree) => tree.isDestination && tree.id !== 'tree-great');

  for (let i = 0; i < PUZZLE_CONFIG.treeCount; i += 1) {
    const chosenIds = new Set(targetIdByPuzzleId.keys());
    const viable = remaining.filter(
      (candidate) => validTargets(candidate, trees, chosenIds, profile).length > 0,
    );
    if (viable.length === 0) break;

    const puzzleTree = randPick(rng, viable);
    const targets = validTargets(puzzleTree, trees, chosenIds, profile);
    const target = randPick(rng, targets);

    targetIdByPuzzleId.set(puzzleTree.id, target.id);
    // A target already spoken for cannot later become a puzzle tree itself —
    // otherwise a course could end on another puzzle after all.
    remaining = remaining.filter(
      (candidate) => candidate.id !== puzzleTree.id && candidate.id !== target.id,
    );
  }

  const treesById = new Map(trees.map((tree) => [tree.id, tree]));
  return trees.map((tree) => {
    const targetId = targetIdByPuzzleId.get(tree.id);
    if (targetId === undefined) return { ...tree, course: null };
    return {
      ...tree,
      type: TREE_TYPES.PUZZLE,
      course: buildCourse(tree, treesById.get(targetId)),
    };
  });
}

/**
 * Build the forest.
 *
 * @param {Partial<typeof WORLD_CONFIG>} [overrides]
 * @returns {{seed:number, seedLabel:string, config:object, trees:Tree[], spawnTreeId:string, bounds:{radius:number}}}
 */
export function generateForest(overrides = {}) {
  const config = { ...WORLD_CONFIG, ...overrides };
  const seed = typeof config.seed === 'number' ? config.seed : hashSeed(String(config.seed));
  const rng = createRng(seed);

  const trees = [];

  // The great tree is placed first and by hand: it is the spawn, the tallest
  // thing in the forest, and the orientation landmark the doc asks for (§2.3).
  trees.push(
    makeTree(
      'tree-great',
      {
        type: TREE_TYPES.LANDMARK,
        name: config.greatTree.name,
        position: { x: 0, y: 0, z: 0 },
        trunkHeight: config.greatTree.trunkHeight,
        trunkRadius: config.greatTree.trunkRadius,
        canopyRadius: config.greatTree.canopyRadius,
      },
      config,
    ),
  );

  const positions = scatterPositions(rng, config);
  let landmarkIndex = 0;

  positions.forEach((position, index) => {
    const [minH, maxH] = config.trunkHeightRange;
    // Trees get taller toward the rim, which gives the forest a bowl shape:
    // you glide down and out, then climb a tall rim tree to reset altitude.
    const rimness = Math.hypot(position.x, position.z) / config.areaRadius;
    const trunkHeight = randRange(rng, minH, maxH) * (0.75 + rimness * 0.5);
    const isDestination = rng() < config.destinationRatio;

    trees.push(
      makeTree(
        `tree-${String(index).padStart(3, '0')}`,
        {
          type: isDestination ? TREE_TYPES.LANDMARK : TREE_TYPES.SCENERY,
          name: isDestination
            ? LANDMARK_NAMES[landmarkIndex++ % LANDMARK_NAMES.length]
            : undefined,
          position,
          trunkHeight,
          trunkRadius: randRange(rng, ...config.trunkRadiusRange),
          canopyRadius: randRange(rng, ...config.canopyRadiusRange),
        },
        config,
      ),
    );
  });

  // One more pass over the finished trees, continuing the same rng stream —
  // see placeStructures for why this cannot happen inside the loop above.
  const treesWithStructures = trees.map((tree) => ({
    ...tree,
    structures: placeStructures(rng, tree),
  }));

  // Puzzle course selection is a separate pass on a separately salted rng —
  // see placePuzzleCourses for why it cannot share the stream above.
  const finalTrees = placePuzzleCourses(treesWithStructures, seed);

  return {
    seed,
    seedLabel: String(config.seed),
    config,
    trees: finalTrees,
    spawnTreeId: 'tree-great',
    bounds: { radius: config.areaRadius },
  };
}

/** Nearest tree to a point, by horizontal distance. Used for ground recovery. */
export function nearestTree(trees, point, excludeId = null) {
  let best = null;
  let bestDistance = Infinity;
  for (const tree of trees) {
    if (tree.id === excludeId) continue;
    const d = distance2D(tree.position, point);
    if (d < bestDistance) {
      bestDistance = d;
      best = tree;
    }
  }
  return best;
}
