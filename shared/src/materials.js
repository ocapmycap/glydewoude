/**
 * Where the materials are.
 *
 * Cache placement is derived from the world seed, exactly like the forest
 * itself and for the same reason (decisions.md D-3): the Phase 2 server has to
 * agree with the client about what was collectable and where, without either
 * side shipping a table over the wire. Given a world, this always produces the
 * same caches, in the same order, on any machine.
 *
 * Pure — no Three.js, no DOM, no clock, no `Math.random`.
 */

import { MATERIAL_CONFIG, MATERIAL_TABLE, MATERIAL_TYPES } from './constants.js';
import { createRng, randInt } from './rng.js';
import { clamp, distance2D } from './math.js';

/**
 * @typedef {object} MaterialCache
 * @property {string} id
 * @property {string} treeId
 * @property {string} material   one of MATERIAL_TYPES
 * @property {number} amount
 * @property {number} effort     0..1, how hard this tree is to reach
 * @property {{x:number,y:number,z:number}} position  where the cache sits
 */

const MATERIAL_NAMES = Object.freeze(Object.values(MATERIAL_TYPES));

/**
 * The range of distances and perch heights actually present in a forest.
 *
 * Effort is normalised against this rather than against absolute metres. A
 * fixed divisor sounds simpler but does not work: every tree in the default
 * forest then scores 0.6 or above, the rare-material boost applies everywhere
 * at once, and berries stop being rare. Normalising makes the easiest tree a
 * genuine 0 and the hardest a genuine 1.
 *
 * The spawn tree is excluded — it is the tallest thing in the forest and
 * carries no cache, so including it would just compress everything else.
 */
export function materialEffortScale(world) {
  const spawn = world.trees.find((candidate) => candidate.id === world.spawnTreeId);
  const scored = world.trees.filter((tree) => tree.id !== world.spawnTreeId);

  const distances = scored.map((tree) =>
    (spawn ? distance2D(spawn.position, tree.position) : 0));
  const heights = scored.map((tree) => tree.perchY);

  return {
    minDistance: distances.length ? Math.min(...distances) : 0,
    maxDistance: distances.length ? Math.max(...distances) : 1,
    minPerchY: heights.length ? Math.min(...heights) : 0,
    maxPerchY: heights.length ? Math.max(...heights) : 1,
    spawn,
  };
}

function normalise(value, min, max) {
  return max - min <= 1e-9 ? 0 : clamp((value - min) / (max - min), 0, 1);
}

/**
 * How hard a tree is to get to, as 0..1.
 *
 * Two things make a tree awkward: being far from the spawn, and being tall
 * enough that you have to arrive with height to spare. Both are properties the
 * server can recompute from the same world, so this stays checkable.
 *
 * @param {object} tree
 * @param {object} world
 * @param {ReturnType<typeof materialEffortScale>} [scale] precomputed, to avoid
 *   rescanning the forest for every tree
 */
export function effortFor(tree, world, scale = materialEffortScale(world)) {
  const distance = scale.spawn ? distance2D(scale.spawn.position, tree.position) : 0;
  const remoteness = normalise(distance, scale.minDistance, scale.maxDistance);
  const loftiness = normalise(tree.perchY, scale.minPerchY, scale.maxPerchY);
  return clamp(remoteness * 0.6 + loftiness * 0.4, 0, 1);
}

/**
 * Weighted pick, with rare materials pulled toward high-effort trees.
 *
 * A rarity-2 material at effort 1 is four times as likely as it is at the
 * centre of the map; a rarity-0 material is unaffected. That is what puts
 * berries out on the rim instead of on the tree next to the spawn.
 */
export function pickMaterial(rng, effort) {
  const weights = MATERIAL_NAMES.map((name) => {
    const entry = MATERIAL_TABLE[name];
    return entry.weight * (1 + entry.rarity * effort * MATERIAL_CONFIG.effortWeighting);
  });

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < MATERIAL_NAMES.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return MATERIAL_NAMES[i];
  }
  // Float error only; the loop above accounts for the whole distribution.
  return MATERIAL_NAMES[MATERIAL_NAMES.length - 1];
}

/**
 * Build every cache in the forest.
 *
 * @param {object} world  a forest from generateForest()
 * @param {Partial<typeof MATERIAL_CONFIG>} [overrides]
 * @returns {MaterialCache[]}
 */
export function generateMaterialCaches(world, overrides = {}) {
  const config = { ...MATERIAL_CONFIG, ...overrides };
  // Salt the seed so caches do not consume the same RNG stream as the trees;
  // otherwise changing cache logic would silently move every tree.
  const rng = createRng((world.seed ^ config.seedSalt) >>> 0);

  const scale = materialEffortScale(world);
  const caches = [];
  for (const tree of world.trees) {
    // Roll for every tree in order, whether or not it wins, so the sequence
    // stays stable if the cache chance is retuned.
    const roll = rng();
    const effort = effortFor(tree, world, scale);
    const material = pickMaterial(rng, effort);
    const [minAmount, maxAmount] = MATERIAL_TABLE[material].amount;
    const amount = randInt(rng, minAmount, maxAmount);

    if (roll > config.cacheChance) continue;
    // The spawn tree stays empty: a free cache on the tree you start on
    // teaches nothing and is collectable without gliding at all.
    if (tree.id === world.spawnTreeId) continue;

    caches.push({
      id: `cache-${tree.id}`,
      treeId: tree.id,
      material,
      amount,
      effort,
      position: {
        x: tree.position.x,
        y: tree.perchY + config.cacheHeightOffset,
        z: tree.position.z,
      },
    });
  }
  return caches;
}

/** Index caches by the tree that carries them, for O(1) lookup on landing. */
export function indexCachesByTree(caches) {
  const byTree = new Map();
  for (const cache of caches) byTree.set(cache.treeId, cache);
  return byTree;
}

/** An empty tally with every material present, so callers never see undefined. */
export function emptyMaterialTotals() {
  return Object.fromEntries(MATERIAL_NAMES.map((name) => [name, 0]));
}

/** Sum a list of {material, amount} into a totals object. Pure. */
export function sumMaterials(entries) {
  const totals = emptyMaterialTotals();
  for (const entry of entries) {
    if (entry.material in totals) totals[entry.material] += entry.amount;
  }
  return totals;
}
