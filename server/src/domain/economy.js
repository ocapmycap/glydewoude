/**
 * The only place in the server that moves materials.
 *
 * Both operations follow the same shape, which is the §6.1 shape: take the
 * client's *intent*, decide whether it is true, and only then commit — all
 * inside one database transaction, with a ledger row written alongside every
 * balance change. A commit that moved a balance without recording why would
 * defeat the audit trail the data model exists to provide (§5.3, §6.3).
 */

import { generateForest, generateMaterialCaches } from '@glidewood/shared';

import { canAfford, priceFor } from './upgrades.js';
import { validateCollection } from './validation.js';

/**
 * The forest, as the server sees it.
 *
 * Regenerated from the seed rather than stored, so it cannot drift from the
 * one the client is flying (decisions.md D-3, D-16). Memoised per seed because
 * it is the same answer every time and generating it is not free.
 */
export function createWorldCache() {
  const worlds = new Map();
  return {
    forSeed(seed) {
      let entry = worlds.get(seed);
      if (!entry) {
        const world = generateForest({ seed });
        entry = { world, cachesById: indexById(generateMaterialCaches(world)) };
        worlds.set(seed, entry);
      }
      return entry;
    },
  };
}

function indexById(caches) {
  const byId = new Map();
  for (const cache of caches) byId.set(cache.id, cache);
  return byId;
}

export function createEconomy({ db, players, transactions, caches, config, worlds }) {
  const worldCache = worlds ?? createWorldCache();

  return {
    /**
     * Bank a collection claim.
     *
     * @returns {{ok: true, credited: object, player: object}
     *          |{ok: false, reason: string, detail?: object}}
     */
    async collect({ playerId, claim, now = new Date() }) {
      const player = await players.findById(playerId);
      if (!player) return { ok: false, reason: 'unknown_player' };

      const { cachesById } = worldCache.forSeed(player.worldSeed);
      const alreadyCollected = await caches.collectedIds(playerId);

      const verdict = validateCollection({
        claim,
        cachesById,
        player: {
          stats: player.glideStats,
          lastPosition: player.lastPosition,
          lastPositionAt: player.lastPositionAt ? new Date(player.lastPositionAt) : null,
        },
        alreadyCollected,
        now,
        config,
      });
      if (!verdict.ok) return verdict;

      const { cache } = verdict;
      const claimed = await db.transaction(async (client) => {
        // Losing this race is not an error — it means the cache was banked by
        // a duplicate request, and the right response is "already collected",
        // not a second payout.
        const won = await caches.claim({
          playerId,
          cacheId: cache.id,
          material: cache.material,
          amount: cache.amount,
        }, client);
        if (!won) return false;

        await players.creditMaterial(playerId, cache.material, cache.amount, client);
        await transactions.record({
          playerId,
          type: 'earn',
          item: cache.material,
          amount: cache.amount,
          source: 'collect',
          metadata: { cacheId: cache.id, treeId: cache.treeId, effort: cache.effort },
        }, client);
        await players.savePosition(playerId, cache.position, now, client);
        return true;
      });

      if (!claimed) return { ok: false, reason: 'already_collected' };

      return {
        ok: true,
        credited: { material: cache.material, amount: cache.amount },
        player: await players.findById(playerId),
      };
    },

    /**
     * Buy the next tier of an upgrade.
     *
     * @returns {{ok: true, purchased: object, player: object}
     *          |{ok: false, reason: string, detail?: object}}
     */
    async purchase({ playerId, upgradeKey }) {
      const player = await players.findById(playerId);
      if (!player) return { ok: false, reason: 'unknown_player' };

      const currentTier = player.glideStats[upgradeKey];
      if (currentTier === undefined) return { ok: false, reason: 'unknown_upgrade' };

      const quote = priceFor(upgradeKey, currentTier);
      if (!quote.ok) return quote;

      const affordable = canAfford(player.materials, quote.price);
      if (!affordable.ok) return affordable;

      const committed = await db.transaction(async (client) => {
        // Re-check affordability as part of the write itself. The read above
        // is a courtesy that produces a good error message; this is the part
        // that is actually safe against two purchases racing.
        for (const [material, cost] of Object.entries(quote.price)) {
          const debited = await players.debitMaterial(playerId, material, cost, client);
          if (!debited) return { ok: false, reason: 'insufficient_materials' };
        }

        const bumped = await players.bumpStat(playerId, upgradeKey, currentTier, client);
        if (!bumped) return { ok: false, reason: 'tier_changed' };

        for (const [material, cost] of Object.entries(quote.price)) {
          await transactions.record({
            playerId,
            type: 'spend',
            item: material,
            amount: cost,
            source: 'upgrade',
            metadata: { upgrade: upgradeKey, tier: quote.nextTier },
          }, client);
        }
        return { ok: true };
      });

      if (!committed.ok) return committed;

      return {
        ok: true,
        purchased: { upgrade: upgradeKey, tier: quote.nextTier, price: quote.price },
        player: await players.findById(playerId),
      };
    },
  };
}
