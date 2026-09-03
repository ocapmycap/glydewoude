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

/** A well-formed run submission, with any field overridden. */
function runBody(overrides = {}) {
  return { score: 4820, chain: 7, distance: 1930, durationMs: 84_000, ...overrides };
}

describe('best run', () => {
  it('starts at zero for a new player', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.bestRun).toMatchObject({ score: 0, chain: 0, recordedAt: null });
  });

  it('stores a first run and says it improved', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    const posted = await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody(),
    });
    expect(posted.status).toBe(200);
    expect(posted.body.improved).toBe(true);
    expect(posted.body.best).toMatchObject({ score: 4820, chain: 7, distance: 1930 });
    expect(posted.body.best.recordedAt).toBeTruthy();
  });

  it('survives a reload, which is the whole point of storing it', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/player/run', { token, body: runBody() });

    const later = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(later.body.player.bestRun).toMatchObject({ score: 4820, chain: 7 });
  });

  it('keeps the better run and reports the worse one as no improvement', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody({ score: 5100, chain: 9 }),
    });

    const worse = await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody({ score: 200, chain: 2 }),
    });
    expect(worse.body.improved).toBe(false);
    // The reply is authoritative either way: it carries the best that stands,
    // not the run that was just posted.
    expect(worse.body.best).toMatchObject({ score: 5100, chain: 9 });
  });

  it('cannot be lowered by replaying the same request', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const body = runBody({ score: 3000 });

    await request(harness.app, 'POST', '/api/player/run', { token, body });
    const replay = await request(harness.app, 'POST', '/api/player/run', { token, body });

    // A replay ties its own stored score, so the conditional UPDATE matches
    // nothing and the row is untouched.
    expect(replay.body.improved).toBe(false);
    expect(replay.body.best.score).toBe(3000);
  });

  it('lets two runs finishing at once settle on the higher one', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);

    const [low, high] = await Promise.all([
      request(harness.app, 'POST', '/api/player/run', { token, body: runBody({ score: 1000 }) }),
      request(harness.app, 'POST', '/api/player/run', { token, body: runBody({ score: 9000 }) }),
    ]);
    expect([low.status, high.status]).toEqual([200, 200]);

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.bestRun.score).toBe(9000);
  });

  it('keeps the chain and distance of the run that won, not a per-column high', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    // A long, low-scoring plod, then a short, high-scoring dash.
    await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody({ score: 500, chain: 40, distance: 9000 }),
    });
    await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody({ score: 6000, chain: 3, distance: 800 }),
    });

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.bestRun).toMatchObject({ score: 6000, chain: 3, distance: 800 });
  });

  it('keeps two players\' bests apart', async () => {
    harness = await createHarness();
    const one = await registerPlayer(harness.app, 'One');
    const two = await registerPlayer(harness.app, 'Two');

    await request(harness.app, 'POST', '/api/player/run', {
      token: one.token, body: runBody({ score: 7777 }),
    });

    const other = await request(harness.app, 'GET', '/api/player/me', { token: two.token });
    expect(other.body.player.bestRun.score).toBe(0);
  });

  it('writes no ledger row, because a run earns nothing', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/player/run', { token, body: runBody() });

    const log = await request(harness.app, 'GET', '/api/player/transactions', { token });
    expect(log.body.transactions).toEqual([]);
  });

  it('needs a session like every other economy route', async () => {
    harness = await createHarness();
    const response = await request(harness.app, 'POST', '/api/player/run', { body: runBody() });
    expect(response.status).toBe(401);
  });

  it('is rate limited', async () => {
    harness = await createHarness({ rateLimit: { windowSeconds: 60, economyMax: 2 } });
    const { token } = await registerPlayer(harness.app);

    const statuses = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await request(harness.app, 'POST', '/api/player/run', {
        token, body: runBody({ score: 100 + i }),
      });
      statuses.push(response.status);
    }
    expect(statuses.at(-1)).toBe(429);
  });
});

describe('a run the server will not store', () => {
  const nonsense = {
    'a negative score': runBody({ score: -1 }),
    'a fractional chain': runBody({ chain: 2.5 }),
    'a missing chain': { score: 10, distance: 10, durationMs: 10 },
    'a null distance': runBody({ distance: null }),
    'a score past the ceiling': runBody({ score: 1e12 }),
    'a duration longer than a day': runBody({ durationMs: 48 * 60 * 60 * 1000 }),
    'a string where a number belongs': runBody({ score: '9999' }),
  };

  for (const [description, body] of Object.entries(nonsense)) {
    it(`rejects ${description}`, async () => {
      harness = await createHarness();
      const { token } = await registerPlayer(harness.app);
      const response = await request(harness.app, 'POST', '/api/player/run', { token, body });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('malformed_run');
    });
  }

  it('rejects an overflowing number rather than letting it reach the column', async () => {
    // `Infinity` cannot survive JSON.stringify, so a client sends it as a
    // literal too large to represent — which JSON.parse turns back into
    // Infinity. Without the finite check that reaches an INTEGER column and
    // becomes a 500.
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const response = await request(harness.app, 'POST', '/api/player/run', {
      token,
      headers: { 'content-type': 'application/json' },
      raw: '{"score":1e999,"chain":3,"distance":10,"durationMs":10}',
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('malformed_run');
  });

  it('leaves the stored best alone when it bounces one', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    await request(harness.app, 'POST', '/api/player/run', { token, body: runBody({ score: 400 }) });

    await request(harness.app, 'POST', '/api/player/run', {
      token, body: runBody({ score: Number.MAX_SAFE_INTEGER }),
    });

    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(me.body.player.bestRun.score).toBe(400);
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
