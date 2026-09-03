/**
 * The core glide loop, assembled.
 *
 * This module owns the answer to "what is the game doing right now". It knows
 * about the world, the squirrel, the interaction registry and the input
 * intent — and nothing at all about rendering, the DOM, or the clock.
 *
 * That boundary is the point: `client/test/glide-loop.smoke.test.js` drives
 * this exact object headlessly, so the automated test exercises the shipped
 * loop rather than a test-only reimplementation of it.
 */

import {
  GLIDE_TUNING,
  BASE_GLIDE_STATS,
  TREE_TYPES,
  deriveGlideProfile,
  distance2D,
  generateForest,
  generateMaterialCaches,
  maxGlideRange,
} from '@glidewood/shared';

import { createCollectionLedger } from './collection.js';
import { createInteractionRegistry, landmarkInteraction } from './interactions.js';
import { GliderPhase, landOn, launch, perchOn, stepAirborne } from './glider.js';
import { resolveLanding } from './landing.js';
import { resetEdges } from './input-state.js';

/**
 * @param {object} [options]
 * @param {object} [options.world]   a forest from generateForest(); one is made if omitted
 * @param {object} [options.stats]   upgrade tiers; Phase 1 always passes base
 * @param {object} [options.tuning]  a mutable copy of GLIDE_TUNING for live tweaking
 * @param {Array<object>} [options.caches]  material caches; derived from the
 *   world seed if omitted, so client and server agree without syncing
 */
export function createSimulation(options = {}) {
  const world = options.world ?? generateForest();
  const stats = { ...BASE_GLIDE_STATS, ...(options.stats ?? {}) };
  // A mutable copy: the tuning panel edits this in place while the game runs.
  const tuning = { ...GLIDE_TUNING, ...(options.tuning ?? {}) };

  const interactions = createInteractionRegistry();
  interactions.register(TREE_TYPES.LANDMARK, landmarkInteraction);

  const collection = createCollectionLedger({
    caches: options.caches ?? generateMaterialCaches(world),
  });

  const listeners = new Set();
  const emit = (event) => listeners.forEach((listener) => listener(event));

  let profile = deriveGlideProfile(stats, tuning);
  const spawnTree = world.trees.find((tree) => tree.id === world.spawnTreeId);
  let glider = perchOn(spawnTree);
  let elapsed = 0;

  const context = () => ({ glider, world, emit });

  // Announce the spawn perch the same way any other landing would.
  interactions.land(spawnTree, context());

  function treeById(id) {
    return world.trees.find((tree) => tree.id === id) ?? null;
  }

  function doLaunch() {
    const from = treeById(glider.treeId);
    if (!from) return;
    interactions.leave(from, context());
    glider = launch(glider, profile, tuning);
    emit({ type: 'glide:launched', tree: from });
  }

  function doLand(tree, reason) {
    const finished = glider.glide;
    glider = landOn(glider, tree);
    emit({ type: 'glide:landed', tree, reason, glide: finished });
    interactions.land(tree, context());

    // Materials are claimed by arriving, which reuses the landing the player
    // already had to earn rather than adding a second pickup mechanic.
    const intent = collection.collectAt(tree, { atTime: elapsed, glide: finished });
    if (intent) emit({ type: 'material:collected', tree, intent });
  }

  function doRespawn() {
    const from = treeById(glider.treeId);
    if (from) interactions.leave(from, context());
    glider = perchOn(spawnTree);
    emit({ type: 'glide:respawned', tree: spawnTree });
    interactions.land(spawnTree, context());
  }

  return {
    world,
    stats,
    tuning,
    interactions,
    collection,

    /** Subscribe to simulation events; returns an unsubscribe function. */
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get glider() {
      return glider;
    },
    get profile() {
      return profile;
    },
    get elapsed() {
      return elapsed;
    },

    /** Re-derive the profile after the tuning panel changes a dial. */
    refreshProfile() {
      profile = deriveGlideProfile(stats, tuning);
      return profile;
    },

    /** Best-case remaining glide distance from the current altitude. */
    remainingRange() {
      return maxGlideRange(glider.motion.y - world.config.groundY, profile);
    },

    /**
     * Advance one fixed step. `dt` is always the loop's fixed timestep, never
     * a measured frame time — see `loop.js`.
     */
    step(input, dt) {
      elapsed += dt;

      if (input.respawn) {
        doRespawn();
        resetEdges(input);
        return;
      }

      if (glider.phase === GliderPhase.PERCHED) {
        if (input.launch) doLaunch();
        resetEdges(input);
        return;
      }

      const { glider: moved, previous } = stepAirborne(glider, input, profile, dt, tuning);
      glider = moved;

      // Once clear of the tree we launched from, allow landing on it again —
      // otherwise a loop back around to the same branch would fly straight
      // through it.
      if (glider.fromTreeId) {
        const from = treeById(glider.fromTreeId);
        if (from && distance2D(from.position, glider.motion) > from.perchRadius + 2) {
          glider = { ...glider, fromTreeId: null };
        }
      }

      const landing = resolveLanding(world, previous, glider.motion, glider.fromTreeId);
      if (landing) doLand(landing.tree, landing.reason);

      resetEdges(input);
    },
  };
}
