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

import { TREE_TYPES, WORLD_CONFIG, STRUCTURE_KINDS } from './constants.js';
import { createRng, hashSeed, randRange, randPick } from './rng.js';
import { distance2D } from './math.js';

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

  return {
    seed,
    seedLabel: String(config.seed),
    config,
    trees: treesWithStructures,
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
