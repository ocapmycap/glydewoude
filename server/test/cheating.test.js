/**
 * "Integration tests on transaction validation, purchase flows, and the
 *  'can the client cheat this' cases specifically." — product doc §7.4
 *
 * Each test here is a thing a modified client would try.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { generateForest, generateMaterialCaches } from '@glidewood/shared';

import { USING_REAL_POSTGRES, createHarness, registerPlayer, request } from './helpers/harness.js';

let harness;
afterEach(async () => { await harness?.close(); harness = null; });

function caches(config) {
  return generateMaterialCaches(generateForest({ seed: config.worldSeed }));
}

async function collect(app, token, body) {
  return request(app, 'POST', '/api/collect', { token, body });
}

describe('authentication cannot be bypassed', () => {
  it('refuses economy calls with no token', async () => {
    harness = await createHarness();
    const cache = caches(harness.config)[0];
    const response = await collect(harness.app, undefined, { cacheId: cache.id });
    expect(response.status).toBe(401);
  });

  it('refuses a forged token', async () => {
    harness = await createHarness();
    const cache = caches(harness.config)[0];
    const response = await collect(harness.app, 'a'.repeat(43), { cacheId: cache.id });
    expect(response.status).toBe(401);
  });

  it('refuses a revoked token', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/auth/logout', { token });

    const response = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(response.status).toBe(401);
  });

  it('does not let one player act as another', async () => {
    harness = await createHarness();
    const one = await registerPlayer(harness.app, 'One');
    const two = await registerPlayer(harness.app, 'Two');

    // Even knowing another player's id, the token decides who you are.
    const response = await request(harness.app, 'GET', '/api/player/me', {
      token: two.token,
      headers: { 'x-player-id': one.player.id },
    });
    expect(response.body.player.id).toBe(two.player.id);
  });
});

describe('collection cannot be forged', () => {
  it('rejects a cache that does not exist in the seeded world', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    const response = await collect(harness.app, token, {
      cacheId: 'cache-tree-does-not-exist',
      position: { x: 0, y: 20, z: 0 },
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('unknown_cache');
  });

  it('rejects banking the same cache twice', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = caches(harness.config)[0];

    const first = await collect(harness.app, token, {
      cacheId: cache.id, position: cache.position,
    });
    expect(first.status).toBe(200);

    const second = await collect(harness.app, token, {
      cacheId: cache.id, position: cache.position,
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_collected');
  });

  // Real PostgreSQL only: pg-mem does not isolate concurrent transactions, so
  // both claims see an empty table and both insert. The guarantee is genuine —
  // it is the (player_id, cache_id) primary key plus ON CONFLICT DO NOTHING —
  // but only a real database can demonstrate it. CI runs this job too.
  it.runIf(USING_REAL_POSTGRES)('pays out once when the same claim arrives twice at once', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = caches(harness.config)[0];

    const [a, b] = await Promise.all([
      collect(harness.app, token, { cacheId: cache.id, position: cache.position }),
      collect(harness.app, token, { cacheId: cache.id, position: cache.position }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.materials[cache.material]).toBe(cache.amount);
  });

  it('ignores a client-supplied amount and pays the seeded value', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = caches(harness.config)[0];

    await collect(harness.app, token, {
      cacheId: cache.id,
      position: cache.position,
      // A modified client asking for a thousand of everything.
      amount: 1000,
      material: 'berries',
    });

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.materials[cache.material]).toBe(cache.amount);
    expect(me.body.player.materials.berries)
      .toBe(cache.material === 'berries' ? cache.amount : 0);
  });

  it('rejects a claim made from nowhere near the cache', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const cache = caches(harness.config)[0];

    const response = await collect(harness.app, token, {
      cacheId: cache.id,
      position: { x: cache.position.x + 5000, y: 20, z: cache.position.z + 5000 },
    });
    expect(response.status).toBe(422);
    expect(response.body.error).toBe('not_at_cache');
  });

  it('rejects teleporting between two distant caches', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const all = caches(harness.config);

    // Two caches as far apart as this forest allows.
    let far = [all[0], all[1]];
    let best = 0;
    for (const a of all.slice(0, 40)) {
      for (const b of all.slice(0, 40)) {
        const d = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        if (d > best) { best = d; far = [a, b]; }
      }
    }

    const first = await collect(harness.app, token, {
      cacheId: far[0].id, position: far[0].position,
    });
    expect(first.status).toBe(200);

    // Immediately claiming the far one is faster than any squirrel can glide.
    const second = await collect(harness.app, token, {
      cacheId: far[1].id, position: far[1].position,
    });
    expect(second.status).toBe(422);
    expect(second.body.error).toBe('implausible_travel');
  });

  it('allows the same journey once enough time has passed', async () => {
    // The check bounds speed, not distance — a legitimate player who takes
    // their time must not be flagged.
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    const all = caches(harness.config);
    const [a, b] = [all[0], all[1]];

    await collect(harness.app, token, { cacheId: a.id, position: a.position });

    // Rewind the anchor an hour into the past.
    const longAgo = new Date(Date.now() - 3600 * 1000);
    await harness.app.services.players.savePosition(player.id, a.position, longAgo);

    const second = await collect(harness.app, token, { cacheId: b.id, position: b.position });
    expect(second.status).toBe(200);
  });
});

describe('purchases cannot be forged', () => {
  it('refuses an upgrade the player cannot afford', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    const response = await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'distance' },
    });
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('insufficient_materials');
  });

  it('leaves stats untouched when a purchase is refused', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'distance' },
    });

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.glideStats.distance).toBe(0);
  });

  it('rejects an unknown upgrade', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const response = await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'wings_of_icarus' },
    });
    expect(response.status).toBe(400);
  });

  it('refuses to go past the last tier', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    for (const material of ['acorns', 'bark', 'silk', 'berries']) {
      await harness.app.services.players.creditMaterial(player.id, material, 100_000);
    }

    for (let tier = 0; tier < 3; tier += 1) {
      const buy = await request(harness.app, 'POST', '/api/shop/purchase', {
        token, body: { upgrade: 'agility' },
      });
      expect(buy.status).toBe(200);
    }
    const past = await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'agility' },
    });
    expect(past.status).toBe(409);
    expect(past.body.error).toBe('max_tier');
  });

  it('charges exactly once when two purchases race', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    // Enough for exactly one tier of distance (12 acorns), not two.
    await harness.app.services.players.creditMaterial(player.id, 'acorns', 12);

    const [a, b] = await Promise.all([
      request(harness.app, 'POST', '/api/shop/purchase', { token, body: { upgrade: 'distance' } }),
      request(harness.app, 'POST', '/api/shop/purchase', { token, body: { upgrade: 'distance' } }),
    ]);

    const succeeded = [a, b].filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(1);

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.glideStats.distance).toBe(1);
    expect(me.body.player.materials.acorns).toBe(0);
  });

  it('never lets a balance go negative', async () => {
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    await harness.app.services.players.creditMaterial(player.id, 'acorns', 5);

    await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'distance' },
    });
    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.materials.acorns).toBe(5);
  });

  it('does not partially charge when the second material is short', async () => {
    // distance tier 2 costs acorns AND bark; having only acorns must not
    // silently spend them.
    harness = await createHarness();
    const { token, player } = await registerPlayer(harness.app);
    await harness.app.services.players.creditMaterial(player.id, 'acorns', 500);

    await request(harness.app, 'POST', '/api/shop/purchase', { token, body: { upgrade: 'distance' } });
    const afterFirst = await request(harness.app, 'GET', '/api/player/me', { token });
    const acornsAfterFirst = afterFirst.body.player.materials.acorns;

    // Tier 2 needs bark, which the player has none of.
    const second = await request(harness.app, 'POST', '/api/shop/purchase', {
      token, body: { upgrade: 'distance' },
    });
    expect(second.status).toBe(409);

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.materials.acorns).toBe(acornsAfterFirst);
    expect(me.body.player.glideStats.distance).toBe(1);
  });
});

describe('input handling', () => {
  it('rejects a malformed body', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const response = await request(harness.app, 'POST', '/api/collect', {
      token, headers: { 'content-type': 'application/json' }, body: 'not-an-object',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid display name', async () => {
    harness = await createHarness();
    for (const displayName of ['', '   ', 'x'.repeat(60), '<script>alert(1)</script>']) {
      const response = await request(harness.app, 'POST', '/api/auth/register', {
        body: { displayName },
      });
      expect(response.status, `accepted ${JSON.stringify(displayName)}`).toBe(400);
    }
  });

  it('rate-limits registration', async () => {
    harness = await createHarness({ rateLimit: { windowSeconds: 60, authMax: 3, economyMax: 100 } });
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      const response = await request(harness.app, 'POST', '/api/auth/register', {
        body: { displayName: `Squirrel ${i}` },
      });
      statuses.push(response.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});
