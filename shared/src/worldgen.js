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

import {
  TREE_TYPES, WORLD_CONFIG, STRUCTURE_KINDS, PUZZLE_CONFIG, TOWERING_TREE_CONFIG,
} from './constants.js';
import { createRng, hashSeed, randRange, randPick } from './rng.js';
import { distance2D } from './math.js';
import {
  deriveGlideProfile, launchMotion, maxGlideRange, stepGlide,
} from './glide.js';

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
 * @property {?number} perchY       altitude of the launch branch; null on a towering tree, which has no reachable top (D-63)
 * @property {number} perchRadius   canopy radius you can drop into from above
 * @property {number} canopyDepth   how far below the perch the canopy catches you
 * @property {number} catchRadius   trunk grab radius, below the canopy
 * @property {number} minCatchY     lowest altitude at which the trunk catches you
 * @property {Array<{kind:string, offset:{x:number,y:number,z:number}, rotation:number}>} structures
 *   Decorative dreys/platforms tucked into the canopy, relative to `position`.
 *   Drawing only — nothing in landing or glide reads this.
 * @property {?{targetTreeId:string, rings:Array<{center:{x:number,y:number,z:number}, normal:{x:number,y:number,z:number}, radius:number}>}} course
 *   Set only on TREE_TYPES.PUZZLE trees; null everywhere else.
 * @property {boolean} towering
 *   True for the handful of giants placed by placeToweringTrees (LAN-553).
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
    towering: false,
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

/**
 * Comfortably more ticks than any reachable course could take to either reach
 * a target or conclusively miss it, but still bounded so a target that can
 * never be caught does not simulate forever (LAN-581).
 */
const MAX_PATH_TICKS = 6000;

/**
 * Cheap, provably-conservative reject margin (metres) used before simulating
 * a candidate/target pair at all (LAN-581 perf pass). A neutral glide's
 * ground speed converges to cruise almost immediately and then holds
 * `profile.glideRatio` exactly (no pitch means no off-cruise penalty), so the
 * only way an actual flight beats the nominal `maxGlideRange(drop, profile)`
 * line is the brief launch-hop climb and speed ramp-up — measured across
 * every valid pair on several seeds at under 11 m (see docs/decisions.md
 * D-83). This margin is several times that, so it only ever screens out
 * pairs that are unreachable by a wide margin, never one flyNeutralPath
 * would actually have caught.
 */
const REACH_FILTER_MARGIN = 40;

/**
 * Mirrors `treeCatches` in client/src/sim/landing.js — shared cannot import
 * client code, so the catch-volume geometry is reproduced here. Keep the two
 * in step if landing's catch rule ever changes. `inflate` grows the
 * horizontal radius so a ring, not just the flight line through its centre,
 * clears the foliage too.
 */
function catchesPoint(tree, point, inflate = 0) {
  if (tree.perchY === null) return false;
  if (point.y > tree.perchY || point.y < tree.minCatchY) return false;
  const horizontal = distance2D(tree.position, point);
  const inCanopy = point.y >= tree.perchY - tree.canopyDepth;
  return horizontal <= (inCanopy ? tree.perchRadius : tree.catchRadius) + inflate;
}

/**
 * Fly a base-stat, neutral (steer 0, pitch 0) glide from `from` toward
 * `target`'s perch, at the client's fixed timestep (LAN-581) — this is what
 * replaces the straight line a course used to be built on, which a neutral
 * glide's real arc never actually follows.
 *
 * Stops as soon as `target` catches the flight (the path then ends exactly on
 * the catch, so nothing downstream needs a separate catch index), once the
 * flight has fallen irrecoverably below the target's trunk, or after
 * `MAX_PATH_TICKS` — whichever comes first. Returns the sampled polyline,
 * launch point included.
 */
function flyNeutralPath(from, target, profile) {
  const to = perchPoint(target);
  const heading = Math.atan2(to.x - from.x, to.z - from.z);
  let motion = launchMotion({ ...from, heading }, profile);
  const path = [motion];

  for (let i = 0; i < MAX_PATH_TICKS; i += 1) {
    if (motion.y < target.minCatchY || catchesPoint(target, motion)) break;
    motion = stepGlide(motion, { steer: 0, pitch: 0 }, profile, PUZZLE_CONFIG.pathStep);
    path.push(motion);
  }
  return path;
}

/**
 * The point on `path` at horizontal distance `targetDistance` from `from`,
 * interpolated between the two straddling samples so it lands exactly on the
 * polyline, plus that segment's unit 3D direction (the ring's facing).
 *
 * Horizontal distance is monotonic along `path` — a neutral glide never
 * steers, so its ground track is the straight line toward the target and
 * only altitude curves — which is what makes searching by horizontal
 * distance rather than by time well-defined.
 */
function pointAtHorizontalDistance(path, from, targetDistance) {
  let previous = path[0];
  let previousDistance = 0;

  for (let i = 1; i < path.length; i += 1) {
    const point = path[i];
    const pointDistance = distance2D(from, point);
    if (pointDistance >= targetDistance) {
      const span = pointDistance - previousDistance;
      const t = span === 0 ? 0 : (targetDistance - previousDistance) / span;
      const center = {
        x: previous.x + (point.x - previous.x) * t,
        y: previous.y + (point.y - previous.y) * t,
        z: previous.z + (point.z - previous.z) * t,
      };
      const segLength = Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
      const direction = segLength === 0
        ? { x: 0, y: 0, z: 0 }
        : {
          x: (point.x - previous.x) / segLength,
          y: (point.y - previous.y) / segLength,
          z: (point.z - previous.z) / segLength,
        };
      return { center, direction };
    }
    previous = point;
    previousDistance = pointDistance;
  }

  // Never reached — the path ended (caught, fell away, or capped) short of
  // `targetDistance`. Falling back to the last sample keeps this total; the
  // callers that care (validTargets) reject on the altitude this implies.
  const last = path[path.length - 1];
  return { center: { x: last.x, y: last.y, z: last.z }, direction: { x: 0, y: 0, z: 0 } };
}

/**
 * Trees that could conceivably catch somewhere along `path`, so the
 * point-by-point scan below only visits candidates worth checking instead of
 * every tree in the forest (LAN-581 perf pass). Conservative in two ways —
 * safe to over-include, never to exclude a tree that actually could catch:
 *
 *   - altitude: `catchesPoint` never fires above a tree's perch or below its
 *     minCatchY, so a tree whose whole catchable band misses the path's
 *     altitude range entirely is skipped.
 *   - horizontal: the ground track is a straight segment — a neutral glide
 *     never steers — so a tree further from that segment than the larger of
 *     its two catch radii, inflated the same way `catchesPoint` is, can never
 *     be within range of any point on the path.
 */
function treesNearPath(path, from, trees, ignoreIds) {
  const last = path[path.length - 1];
  const segX = last.x - from.x;
  const segZ = last.z - from.z;
  const segLenSq = segX * segX + segZ * segZ;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of path) {
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  return trees.filter((tree) => {
    if (ignoreIds.has(tree.id)) return false;
    if (tree.perchY === null) return false;
    if (tree.minCatchY > maxY || tree.perchY < minY) return false;

    const radius = Math.max(tree.perchRadius, tree.catchRadius) + PUZZLE_CONFIG.ringRadius;
    const dx = tree.position.x - from.x;
    const dz = tree.position.z - from.z;
    const t = segLenSq === 0 ? 0 : Math.max(0, Math.min(1, (dx * segX + dz * segZ) / segLenSq));
    const closestX = from.x + segX * t;
    const closestZ = from.z + segZ * t;
    return Math.hypot(tree.position.x - closestX, tree.position.z - closestZ) <= radius;
  });
}

/**
 * Does any tree other than `ignoreIds` catch the flight anywhere along
 * `path`, up to and including where it ends? Up to the last ring's horizontal
 * distance the catch radius is inflated by the ring radius, so the rings
 * themselves clear the foliage too, not just the flight line through their
 * centres — beyond the last ring only the flight line itself needs to be
 * clear.
 */
function pathClearOfOtherTrees(path, from, lastRingDistance, trees, ignoreIds) {
  const nearby = treesNearPath(path, from, trees, ignoreIds);
  if (nearby.length === 0) return true;

  for (const point of path) {
    const inflate = distance2D(from, point) <= lastRingDistance ? PUZZLE_CONFIG.ringRadius : 0;
    for (const tree of nearby) {
      if (catchesPoint(tree, point, inflate)) return false;
    }
  }
  return true;
}

/**
 * The expensive part of validating (and later building) a course between one
 * specific candidate/target pair: simulate the flight, then check it clears
 * the last ring with slack, is actually caught, and never clips another
 * tree's foliage. Memoized in `cache` keyed by the pair, since
 * `placePuzzleCourses` asks about the same pair more than once — once while
 * checking whether a candidate is viable at all, again when picking one of
 * its targets, and again in `buildCourse` once one is chosen — and a
 * candidate/target pair's answer never changes within one `generateForest`
 * call (LAN-581 perf pass).
 */
function evaluatePair(candidate, target, trees, profile, cache) {
  const key = `${candidate.id}|${target.id}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const from = perchPoint(candidate);
  const horizontalGap = distance2D(candidate.position, target.position);
  const path = flyNeutralPath(from, target, profile);
  const lastRingDistance = horizontalGap - PUZZLE_CONFIG.lastRingClearance;

  const atLastRing = pointAtHorizontalDistance(path, from, lastRingDistance);
  let reachable = atLastRing.center.y >= target.perchY + PUZZLE_CONFIG.lastRingSlack
    && catchesPoint(target, path[path.length - 1]);

  if (reachable) {
    // The launch guard covers the puzzle tree itself, and arriving at the
    // target is the point of the course, so both ends are exempt from their
    // own catch volumes when checking the path between them.
    const ignoreIds = new Set([candidate.id, target.id]);
    reachable = pathClearOfOtherTrees(path, from, lastRingDistance, trees, ignoreIds);
  }

  const evaluation = { reachable, path, horizontalGap };
  cache.set(key, evaluation);
  return evaluation;
}

/**
 * Trees `candidate` could send a puzzle course to: lower, far enough away for
 * rings to have room, never the great tree, the candidate itself, or a tree
 * already chosen as a puzzle (a course must not end on another puzzle), and
 * — replacing the old straight-line reach and clearance checks (LAN-581),
 * which a real neutral glide's arc does not actually respect — reachable by a
 * simulated neutral-pitch glide that:
 *
 *   1. is still above the target's perch, with slack, at the horizontal
 *      distance the last ring will sit (so the final approach never needs a
 *      dive a neutral-pitch pilot could not fly), and
 *   2. is actually caught by the target, not just passing near it, and
 *   3. never enters another tree's catch volume on the way, foliage-cleared
 *      by the ring radius up to the last ring.
 */
function validTargets(candidate, trees, excludedIds, profile, cache) {
  return trees.filter((target) => {
    if (target.id === 'tree-great') return false;
    if (target.id === candidate.id) return false;
    if (excludedIds.has(target.id)) return false;
    if (target.perchY >= candidate.perchY) return false;

    const horizontalGap = distance2D(candidate.position, target.position);
    if (horizontalGap < PUZZLE_CONFIG.minTargetDistance) return false;

    // Cheap conservative reject before simulating anything — see
    // REACH_FILTER_MARGIN for why this can never rule out a pair
    // `evaluatePair` would actually have accepted.
    const nominalRange = maxGlideRange(candidate.perchY - target.perchY, profile);
    if (horizontalGap > nominalRange + REACH_FILTER_MARGIN) return false;

    return evaluatePair(candidate, target, trees, profile, cache).reachable;
  });
}

/**
 * Lay out a course's rings on the simulated neutral-pitch flight path between
 * the two perches (LAN-581), not the straight line between them — a neutral
 * glide's real descent arcs, so rings on the straight line sat below where
 * the glide actually is by the time it gets there. The first ring sits
 * `firstRingDistance` out from the puzzle tree, the last `lastRingClearance`
 * short of the target, and the rest are spaced evenly between the two by
 * horizontal distance along the path. Each ring's normal is the path's own
 * direction at that point, so it faces however the glide is actually moving
 * there, not just "toward the target".
 */
function buildCourse(puzzleTree, target, trees, profile, cache) {
  const from = perchPoint(puzzleTree);
  // Reuses the path validTargets already simulated to accept this pair
  // instead of flying it a second time (LAN-581 perf pass).
  const { path, horizontalGap } = evaluatePair(puzzleTree, target, trees, profile, cache);

  // Both ends nudge a hair outward from their nominal clearance: a ring
  // center is an interpolated point on a polyline, and comparing its
  // Euclidean distance back to a perch against the same nominal number the
  // interpolation was built from can lose in the last bit or two of float
  // precision, undershooting "at least firstRingDistance/lastRingClearance"
  // by a fraction of a nanometre. The epsilon costs nothing at course scale.
  const firstDistance = PUZZLE_CONFIG.firstRingDistance + 1e-6;
  const lastDistance = horizontalGap - PUZZLE_CONFIG.lastRingClearance - 1e-6;
  const { ringCount } = PUZZLE_CONFIG;

  const rings = [];
  for (let i = 0; i < ringCount; i += 1) {
    const t = ringCount === 1 ? 0 : i / (ringCount - 1);
    const distanceAlong = firstDistance + (lastDistance - firstDistance) * t;
    const { center, direction } = pointAtHorizontalDistance(path, from, distanceAlong);
    rings.push({ center, normal: direction, radius: PUZZLE_CONFIG.ringRadius });
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
  // Shared across every candidate/target pair this call ever looks at — see
  // evaluatePair for why that is safe and what it saves.
  const pairCache = new Map();

  const targetIdByPuzzleId = new Map();
  let remaining = trees.filter((tree) => tree.isDestination && tree.id !== 'tree-great');

  for (let i = 0; i < PUZZLE_CONFIG.treeCount; i += 1) {
    const chosenIds = new Set(targetIdByPuzzleId.keys());
    const viable = remaining.filter(
      (candidate) => validTargets(candidate, trees, chosenIds, profile, pairCache).length > 0,
    );
    if (viable.length === 0) break;

    const puzzleTree = randPick(rng, viable);
    const targets = validTargets(puzzleTree, trees, chosenIds, profile, pairCache);
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
      course: buildCourse(tree, treesById.get(targetId), trees, profile, pairCache),
    };
  });
}

/**
 * Scatter a handful of towering trees in the outer half of the forest —
 * landmarks visible from anywhere, and (LAN-554) something you cling to the
 * side of rather than perch on. Their tops are out of reach by design, so
 * `perchY` is null and they carry no structures, course or material cache.
 *
 * Runs on its own salted rng stream, after every ordinary tree and every
 * puzzle course is settled, exactly like `placePuzzleCourses` — drawing from
 * the main stream here would shift every position, height and destination
 * roll that came before it. Trees are appended, never inserted, so the
 * ordinary forest stays byte-for-byte identical whether or not this pass
 * runs at all.
 */
function placeToweringTrees(trees, seed, config) {
  const rng = createRng((seed ^ TOWERING_TREE_CONFIG.seedSalt) >>> 0);
  const innerRadius = config.areaRadius * TOWERING_TREE_CONFIG.minRimFraction;
  const separation = config.areaRadius * TOWERING_TREE_CONFIG.separationFraction;
  const [, tallestOrdinaryTrunk] = config.trunkHeightRange;
  const [, widestOrdinaryTrunk] = config.trunkRadiusRange;
  const [, widestOrdinaryCanopy] = config.canopyRadiusRange;

  const placed = [];
  for (
    let attempt = 0;
    attempt < TOWERING_TREE_CONFIG.placementAttempts && placed.length < TOWERING_TREE_CONFIG.count;
    attempt += 1
  ) {
    // Even distribution across the outer annulus — the same square-root
    // trick scatterPositions uses for the full disc, just bounded below.
    const radiusSq = innerRadius * innerRadius
      + rng() * (config.areaRadius * config.areaRadius - innerRadius * innerRadius);
    const radius = Math.sqrt(radiusSq);
    const angle = rng() * Math.PI * 2;
    const candidate = { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius };

    const tooCloseToOrdinary = trees.some(
      (tree) => distance2D(tree.position, candidate) < config.minSpacing,
    );
    const tooCloseToTowering = placed.some(
      (tree) => distance2D(tree.position, candidate) < separation,
    );
    if (tooCloseToOrdinary || tooCloseToTowering) continue;

    const tree = makeTree(
      `tree-towering-${placed.length}`,
      {
        type: TREE_TYPES.SCENERY,
        position: candidate,
        trunkHeight: randRange(rng, ...TOWERING_TREE_CONFIG.heightFactorRange) * tallestOrdinaryTrunk,
        trunkRadius: randRange(rng, ...TOWERING_TREE_CONFIG.radiusFactorRange) * widestOrdinaryTrunk,
        canopyRadius: randRange(rng, ...TOWERING_TREE_CONFIG.canopyFactorRange) * widestOrdinaryCanopy,
      },
      config,
    );
    // No perch to launch from or land on, ever (D-63); minCatchY and
    // catchRadius stay numeric so LAN-554 can catch the trunk from the side.
    placed.push({ ...tree, perchY: null, towering: true });
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

  // Puzzle course selection is a separate pass on a separately salted rng —
  // see placePuzzleCourses for why it cannot share the stream above.
  const puzzledTrees = placePuzzleCourses(treesWithStructures, seed);

  // Towering trees are appended last, on their own salted rng stream, after
  // the ordinary forest is entirely settled — see placeToweringTrees.
  const finalTrees = [...puzzledTrees, ...placeToweringTrees(puzzledTrees, seed, config)];

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
