/**
 * Phase 2's actual deliverable: "a loop that persists across sessions."
 */

import { afterEach, describe, expect, it } from 'vitest';
import { generateForest, generateMaterialCaches } from '@glidewood/shared';

import { createTransactionRepo } from '../src/repo/transactions.js';
import { USING_REAL_POSTGRES, createHarness, registerPlayer, request } from './helpers/harness.js';

let harness;
afterEach(async () => { await harness?.close(); harness = null; });

/** A real cache from the seed-derived world the server will regenerate. */
function someCache(config, index = 0) {
  const world = generateForest({ seed: config.worldSeed });
  return generateMaterialCaches(world)[index];
}

describe('save and load', () => {
  it('remembers a player across a fresh request with the same token', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app, 'Hazel');

    const reloaded = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.player.id).toBe(player.id);
    expect(reloaded.body.player.displayName).toBe('Hazel');
  });

  it('persists collected materials so a later session sees them', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = someCache(harness.config);

    const collected = await request(harness.app, 'POST', '/api/collect', {
      token,
      body: { cacheId: cache.id, position: cache.position },
    });
    expect(collected.status).toBe(200);

    // A "new session" is just another request with the same token — the
    // server holds no per-connection state.
    const later = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(later.body.player.materials[cache.material]).toBe(cache.amount);
  });

  it('persists purchased upgrade tiers', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    await harness.app.services.players.creditMaterial(player.id, 'acorns', 100);

    const bought = await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'distance' },
    });
    expect(bought.status).toBe(200);
    expect(bought.body.purchased).toMatchObject({ upgrade: 'distance', tier: 1 });

    const later = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(later.body.player.glideStats.distance).toBe(1);
  });

  it('persists last position', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    await request(harness.app, 'POST', '/api/player/position', {
      token, body: { position: { x: 12, y: 34, z: 56 } },
    });
    const later = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(later.body.player.lastPosition).toEqual({ x: 12, y: 34, z: 56 });
  });

  it('rejects a malformed position rather than storing rubbish', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const response = await request(harness.app, 'POST', '/api/player/position', {
      token, body: { position: { x: 'over there', y: null, z: 1 } },
    });
    expect(response.status).toBe(400);
  });

  it('keeps two players\' balances apart', async () => {
    harness = await createHarness();
    const one = await registerPlayer(harness.app, 'One');
    const two = await registerPlayer(harness.app, 'Two');
    const cache = someCache(harness.config);

    await request(harness.app, 'POST', '/api/collect', {
      token: one.token, body: { cacheId: cache.id, position: cache.position },
    });

    const other = await request(harness.app, 'GET', '/api/player/me', { token: two.token });
    expect(other.body.player.materials[cache.material]).toBe(0);
  });

  it('lets both players collect the same cache independently', async () => {
    // Caches are per-player progress, not a shared world resource — otherwise
    // the first player to log in would strip the forest for everyone.
    harness = await createHarness();
    const one = await registerPlayer(harness.app, 'One');
    const two = await registerPlayer(harness.app, 'Two');
    const cache = someCache(harness.config);

    for (const player of [one, two]) {
      const response = await request(harness.app, 'POST', '/api/collect', {
        token: player.token, body: { cacheId: cache.id, position: cache.position },
      });
      expect(response.status).toBe(200);
    }
  });
});

describe('the append-only ledger', () => {
  it('records an earn for every collection', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = someCache(harness.config);

    await request(harness.app, 'POST', '/api/collect', {
      token, body: { cacheId: cache.id, position: cache.position },
    });

    const log = await request(harness.app, 'GET', '/api/player/transactions', { token });
    expect(log.body.transactions).toHaveLength(1);
    expect(log.body.transactions[0]).toMatchObject({
      type: 'earn', item: cache.material, amount: cache.amount, source: 'collect',
    });
  });

  it('records a spend for every material a purchase costs', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    for (const material of ['acorns', 'bark']) {
      await harness.app.services.players.creditMaterial(player.id, material, 100);
    }

    await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'agility' },
    });

    const log = await request(harness.app, 'GET', '/api/player/transactions', { token });
    const spends = log.body.transactions.filter((row) => row.type === 'spend');
    expect(spends.length).toBe(2);
    expect(spends.every((row) => row.source === 'upgrade')).toBe(true);
  });

  it('exposes no way to alter or remove a ledger row', async () => {
    // The repository is the enforcement point wherever the database trigger
    // cannot run. On real PostgreSQL the trigger backs it up as well, which
    // the next test covers.
    harness = await createHarness();
    const repo = createTransactionRepo(harness.db);
    expect(Object.keys(repo).sort()).toEqual(['listForPlayer', 'record']);
  });

  it.runIf(USING_REAL_POSTGRES)('is append-only in the database too', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    const cache = someCache(harness.config);
    await request(harness.app, 'POST', '/api/collect', {
      token, body: { cacheId: cache.id, position: cache.position },
    });

    await expect(
      harness.db.query('UPDATE transactions SET amount = 9999 WHERE player_id = $1', [player.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      harness.db.query('DELETE FROM transactions WHERE player_id = $1', [player.id]),
    ).rejects.toThrow(/append-only/);
  });
});
