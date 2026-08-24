/**
 * Picking up materials.
 *
 * The important thing about this module is what it deliberately does *not*
 * do: it never treats a local number as a balance. CLAUDE.md is explicit, and
 * so is product doc §6.1 — the moment an interaction touches materials, the
 * client sends an *intent* and the server validates and commits it. A client
 * that quietly increments its own acorn count is the exact bug that section
 * exists to prevent, and it is much harder to remove later than to avoid now.
 *
 * So the ledger records intents. Every pickup produces one, carrying enough
 * context for a server to answer "was that plausible?" — which cache, at what
 * position, at what point in the run, after what glide. Intents sit in
 * `pending` until something confirms them. Until the Phase 2 server exists
 * there is no transport, so they simply accumulate, and the only totals the
 * client can show are explicitly provisional.
 *
 * Pure JS: no Three.js, no DOM, no clock. Time comes in as the simulation's
 * own elapsed seconds, so a replay produces identical intents.
 */

import { emptyMaterialTotals, indexCachesByTree, sumMaterials } from '@glidewood/shared';

/**
 * @typedef {object} CollectionIntent
 * @property {number} seq        per-run ordering, so a server can sequence them
 * @property {string} cacheId
 * @property {string} treeId
 * @property {string} material
 * @property {number} amount
 * @property {number} atTime     simulation seconds when it happened
 * @property {{x:number,y:number,z:number}} atPosition  where the squirrel was
 * @property {{distance:number,duration:number,altitudeLost:number}|null} viaGlide
 */

/**
 * @param {object} options
 * @param {Array<object>} options.caches  from generateMaterialCaches()
 */
export function createCollectionLedger({ caches = [] } = {}) {
  const byTree = indexCachesByTree(caches);

  /** Caches already claimed this run — stops re-landing farming one tree. */
  const claimed = new Set();
  /** @type {CollectionIntent[]} */
  let pending = [];
  /** Only a server may ever write this. Empty until one does. */
  let confirmed = emptyMaterialTotals();
  let seq = 0;

  return {
    /** Every cache in the world, claimed or not. */
    get caches() {
      return caches;
    },

    /** The cache on a tree, or null. Does not claim it. */
    cacheFor(treeId) {
      return byTree.get(treeId) ?? null;
    },

    hasClaimed(cacheId) {
      return claimed.has(cacheId);
    },

    /**
     * Claim the cache on a tree, if there is an unclaimed one.
     *
     * @returns {CollectionIntent|null} the intent raised, or null if there was
     *   nothing to collect. Callers should emit the returned intent.
     */
    collectAt(tree, { atTime = 0, glide = null } = {}) {
      const cache = byTree.get(tree?.id);
      if (!cache || claimed.has(cache.id)) return null;

      claimed.add(cache.id);
      seq += 1;
      const intent = {
        seq,
        cacheId: cache.id,
        treeId: cache.treeId,
        material: cache.material,
        amount: cache.amount,
        atTime,
        atPosition: { ...cache.position },
        viaGlide: glide
          ? {
            distance: glide.distance,
            duration: glide.duration,
            altitudeLost: glide.altitudeLost,
          }
          : null,
      };
      pending.push(intent);
      return intent;
    },

    /** Intents awaiting a verdict. A future transport drains these. */
    get pending() {
      return [...pending];
    },

    /** Server-confirmed totals. Zeroed until a server says otherwise. */
    get confirmed() {
      return { ...confirmed };
    },

    /**
     * What the player has probably got: confirmed plus everything still in
     * flight. Display only — never spend against this, and never send it
     * anywhere as though it were a balance.
     */
    provisionalTotals() {
      const inFlight = sumMaterials(pending);
      const totals = { ...confirmed };
      for (const [material, amount] of Object.entries(inFlight)) {
        totals[material] = (totals[material] ?? 0) + amount;
      }
      return totals;
    },

    /** True while anything is unconfirmed, so the UI can say so honestly. */
    get hasUnconfirmed() {
      return pending.length > 0;
    },

    /**
     * Apply a server verdict. `totals` is the server's authoritative balance —
     * it replaces what we had rather than being added to it, because the
     * server's number is the only one that was ever real.
     */
    settle(seqs, totals) {
      const settled = new Set(seqs);
      pending = pending.filter((intent) => !settled.has(intent.seq));
      if (totals) confirmed = { ...emptyMaterialTotals(), ...totals };
    },

    /**
     * Drop intents the server rejected. The caches stay claimed: a rejected
     * intent means the server did not believe us, and handing the player
     * another go at the same cache would just invite a retry loop.
     */
    reject(seqs) {
      const rejected = new Set(seqs);
      pending = pending.filter((intent) => !rejected.has(intent.seq));
    },

    /** Start-of-run state, for respawns that should reset progress. */
    reset() {
      claimed.clear();
      pending = [];
      confirmed = emptyMaterialTotals();
      seq = 0;
    },
  };
}
