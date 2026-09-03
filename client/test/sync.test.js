/**
 * The intent pump.
 *
 * This is the module that closes Phase 2's loop, so the tests are about the
 * three promises its header makes: intents go up one at a time and in order,
 * a refusal is settled rather than retried, and only "we could not ask" is
 * retried. The last test in the file is the deliverable itself — a real
 * simulation, flown by the real autopilot, banking a real pickup against a
 * server that answers like ours.
 *
 * The ledgers under test are the shipped ones. Only `fetch` and the retry
 * delay are stubbed, both of which the module takes as parameters.
 */

import { describe, expect, it } from 'vitest';
import { generateForest, generateMaterialCaches, TREE_TYPES } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { createCollectionLedger } from '../src/sim/collection.js';
import { createShopLedger } from '../src/sim/shop.js';
import { createApiClient } from '../src/net/api.js';
import { createSync } from '../src/net/sync.js';
import { createInputState } from '../src/sim/input-state.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { chooseTarget, steerToward } from './helpers/autopilot.js';
import { createFakeFetch, fakePlayer } from './helpers/fake-server.js';

const world = generateForest();
const caches = generateMaterialCaches(world);

/** Never wait: retries are about ordering and bookkeeping, not about clocks. */
const noDelay = () => Promise.resolve();

/**
 * A simulation stand-in holding the *real* ledgers.
 *
 * The glide loop is not what these tests are about, and flying to a specific
 * shop tree to raise one purchase intent would make them slow and dependent on
 * the autopilot's route. So the loop is replaced and everything the pump
 * actually touches — `collection`, `shop`, the event stream — is the shipped
 * code. The end-to-end test at the bottom covers the real thing.
 */
function stubSimulation({ stats = {} } = {}) {
  const collection = createCollectionLedger({ caches });
  const shop = createShopLedger();
  const listeners = new Set();
  const emit = (event) => listeners.forEach((listener) => listener(event));
  const applied = [];

  return {
    collection,
    shop,
    stats,
    applied,
    glider: { motion: { x: 10, y: 20, z: 30, speed: 12 } },
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyStats(next) {
      applied.push(next);
      Object.assign(stats, next);
    },

    // --- test drivers, standing in for what a landing would do ---

    /** Land on a tree with a cache, raising a real collection intent. */
    collectAt(tree, atTime = 0) {
      const intent = collection.collectAt(tree, { atTime });
      if (intent) emit({ type: 'material:collected', tree, intent });
      return intent;
    },
    openShop(tree) {
      shop.interaction.onLand({ tree, emit });
    },
    requestPurchase(key) {
      const intent = shop.requestPurchase(key, { atTime: 0 });
      if (intent) emit({ type: 'shop:purchase-requested', intent });
      return intent;
    },
  };
}

/** The first few trees that actually have something on them. */
const cachedTrees = caches
  .slice(0, 6)
  .map((cache) => world.trees.find((tree) => tree.id === cache.treeId));

const shopTree = world.trees.find((tree) => tree.type === TREE_TYPES.SHOP);

function wire(routes, options = {}) {
  const fetchImpl = createFakeFetch(routes);
  const api = createApiClient({ fetch: fetchImpl, token: 'token-test' });
  const simulation = options.simulation ?? stubSimulation();
  const sync = createSync({ api, simulation, delay: noDelay, ...options });
  return { api, fetchImpl, simulation, sync };
}

describe('collection intents', () => {
  it('banks a pickup and adopts the server totals', async () => {
    const { simulation, sync } = wire({
      'POST /api/collect': [200, {
        credited: { material: 'acorns', amount: 2 },
        materials: { acorns: 2, bark: 0, silk: 0, berries: 0 },
        player: fakePlayer({ materials: { acorns: 2, bark: 0, silk: 0, berries: 0 } }),
      }],
    });

    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(simulation.collection.pending).toEqual([]);
    expect(simulation.collection.confirmed.acorns).toBe(2);
    expect(simulation.collection.hasUnconfirmed).toBe(false);
  });

  it('sends only the cache and the position, never the amount', async () => {
    const { simulation, sync, fetchImpl } = wire({
      'POST /api/collect': [200, { credited: {}, materials: {}, player: fakePlayer() }],
    });

    const intent = simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(fetchImpl.calls[0].body).toEqual({
      cacheId: intent.cacheId,
      position: intent.atPosition,
    });
  });

  it('replaces the local tally rather than adding to it', async () => {
    // The server's number is the only one that was ever real: a client that
    // added its provisional count to the server's would double every pickup.
    const { simulation, sync } = wire({
      'POST /api/collect': [200, {
        credited: { material: 'acorns', amount: 1 },
        materials: { acorns: 1, bark: 0, silk: 0, berries: 0 },
        player: fakePlayer(),
      }],
    });

    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(simulation.collection.provisionalTotals().acorns).toBe(1);
  });

  it('drops a refused intent and leaves the cache claimed', async () => {
    const { simulation, sync } = wire({
      'POST /api/collect': [422, { error: 'implausible_travel' }],
    });

    const intent = simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(simulation.collection.pending).toEqual([]);
    // Still claimed, so landing again cannot turn a refusal into a retry loop.
    expect(simulation.collection.hasClaimed(intent.cacheId)).toBe(true);
    expect(simulation.collection.confirmed.acorns).toBe(0);
  });

  it('reports why a pickup was refused', async () => {
    const { simulation, sync } = wire({
      'POST /api/collect': [409, { error: 'already_collected' }],
    });
    const seen = [];
    sync.on((event) => seen.push(event));

    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(seen.find((event) => event.type === 'net:collect-refused')?.error)
      .toBe('already_collected');
  });

  it('retries a pickup the server never answered', async () => {
    let attempts = 0;
    const { simulation, sync } = wire({
      'POST /api/collect': () => {
        attempts += 1;
        if (attempts < 3) return [503, { error: 'internal_error' }];
        return [200, {
          credited: { material: 'acorns', amount: 1 },
          materials: { acorns: 1 },
          player: fakePlayer(),
        }];
      },
    });

    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(attempts).toBe(3);
    expect(simulation.collection.pending).toEqual([]);
    expect(simulation.collection.confirmed.acorns).toBe(1);
  });

  it('retries a rate limit rather than treating it as a refusal', async () => {
    let attempts = 0;
    const { simulation, sync } = wire({
      'POST /api/collect': () => {
        attempts += 1;
        return attempts === 1
          ? [429, { error: 'rate_limited' }]
          : [200, { credited: {}, materials: { acorns: 3 }, player: fakePlayer() }];
      },
    });

    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(attempts).toBe(2);
    expect(simulation.collection.confirmed.acorns).toBe(3);
  });

  it('posts pickups one at a time and in order', async () => {
    // Concurrent claims can be validated in either order, and a pair that
    // arrives backwards looks exactly like a teleport to the D-27 check.
    const inFlight = [];
    let concurrent = 0;
    let peak = 0;

    const { simulation, sync } = wire({
      'POST /api/collect': async ({ body }) => {
        concurrent += 1;
        peak = Math.max(peak, concurrent);
        inFlight.push(body.cacheId);
        await Promise.resolve();
        concurrent -= 1;
        return [200, { credited: {}, materials: {}, player: fakePlayer() }];
      },
    });

    const intents = cachedTrees.slice(0, 4).map((tree) => simulation.collectAt(tree));
    await sync.idle();

    expect(peak).toBe(1);
    expect(inFlight).toEqual(intents.map((intent) => intent.cacheId));
  });

  it('goes quiet and keeps the intent when there is no server at all', async () => {
    // No routes at all, so every attempt throws the way fetch does with
    // nothing listening. The delay yields to the event loop rather than
    // resolving instantly: a retry loop that never yields would spin forever,
    // here and in a browser.
    const simulation = stubSimulation();
    const api = createApiClient({ fetch: createFakeFetch({}), token: 'token-test' });
    const sync = createSync({
      api,
      simulation,
      delay: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });
    const seen = [];
    sync.on((event) => seen.push(event));

    simulation.collectAt(cachedTrees[0]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    sync.stop();

    expect(seen.some((event) => event.type === 'net:offline')).toBe(true);
    // The pickup is still ours to send when the forest comes back.
    expect(simulation.collection.hasUnconfirmed).toBe(true);
  });
});

describe('purchases', () => {
  it('feeds confirmed tiers straight into the physics', async () => {
    const { simulation, sync } = wire({
      'GET /api/shop/catalog': [200, { upgrades: [] }],
      'POST /api/shop/purchase': [200, {
        purchased: { upgrade: 'distance', tier: 1, price: { acorns: 12 } },
        player: fakePlayer({ glideStats: { distance: 1, agility: 0 } }),
      }],
    });

    simulation.openShop(shopTree);
    simulation.requestPurchase('distance');
    await sync.idle();

    expect(simulation.applied.at(-1)).toMatchObject({ distance: 1 });
    expect(simulation.shop.pending).toEqual([]);
  });

  it('clears a refused purchase too, with the shortfall attached', async () => {
    const { simulation, sync } = wire({
      'GET /api/shop/catalog': [200, { upgrades: [] }],
      'POST /api/shop/purchase': [409, {
        error: 'insufficient_materials',
        detail: { acorns: 7 },
      }],
    });
    const seen = [];
    sync.on((event) => seen.push(event));

    simulation.openShop(shopTree);
    simulation.requestPurchase('distance');
    await sync.idle();

    // Nothing local was spent, so there is nothing to roll back — the intent
    // simply leaves the queue and the player is told why.
    expect(simulation.shop.pending).toEqual([]);
    const refusal = seen.find((event) => event.type === 'net:purchase-refused');
    expect(refusal).toMatchObject({ error: 'insufficient_materials', missing: { acorns: 7 } });
  });

  it('fetches the catalogue on arrival at a shop', async () => {
    const upgrades = [{ key: 'distance', label: 'Glide distance', currentTier: 0, maxTier: 5 }];
    const { simulation, sync, fetchImpl } = wire({
      'GET /api/shop/catalog': [200, { upgrades }],
    });
    const seen = [];
    sync.on((event) => seen.push(event));

    simulation.openShop(shopTree);
    await sync.idle();

    expect(fetchImpl.pathsCalled()).toContain('GET /api/shop/catalog');
    expect(seen.find((event) => event.type === 'net:catalog')?.upgrades).toEqual(upgrades);
  });

  it('refetches the catalogue after a purchase, because the prices moved', async () => {
    const { simulation, sync, fetchImpl } = wire({
      'GET /api/shop/catalog': [200, { upgrades: [] }],
      'POST /api/shop/purchase': [200, {
        purchased: { upgrade: 'distance', tier: 1 },
        player: fakePlayer(),
      }],
    });

    simulation.openShop(shopTree);
    await sync.idle();
    simulation.requestPurchase('distance');
    await sync.idle();

    const catalogCalls = fetchImpl.pathsCalled()
      .filter((path) => path === 'GET /api/shop/catalog');
    expect(catalogCalls).toHaveLength(2);
  });
});

describe('position anchoring', () => {
  it('saves a position once the interval has passed, not every tick', async () => {
    const { sync, fetchImpl } = wire(
      { 'POST /api/player/position': [200, { ok: true }] },
      { positionIntervalSeconds: 1 },
    );

    // 90 fixed steps is a game-second and a half, so the one-second timer
    // fires exactly once — a save per tick would be 60 posts a second.
    for (let tick = 0; tick < 90; tick += 1) sync.tick(FIXED_DT);
    await sync.idle();

    expect(fetchImpl.calls.filter((call) => call.path === '/api/player/position'))
      .toHaveLength(1);
  });

  it('sends the glider position it was given', async () => {
    const { sync, fetchImpl } = wire(
      { 'POST /api/player/position': [200, { ok: true }] },
      { positionIntervalSeconds: 0.1 },
    );

    sync.tick(0.2);
    await sync.idle();

    expect(fetchImpl.calls[0].body).toEqual({ position: { x: 10, y: 20, z: 30 } });
  });

  it('does not post at all without a session', async () => {
    const fetchImpl = createFakeFetch({ 'POST /api/player/position': [200, { ok: true }] });
    const api = createApiClient({ fetch: fetchImpl });
    const sync = createSync({
      api,
      simulation: stubSimulation(),
      delay: noDelay,
      positionIntervalSeconds: 0.1,
    });

    sync.tick(0.2);
    await sync.idle();

    expect(fetchImpl.calls).toEqual([]);
  });

  it('re-anchors before sending the pickups queued behind it', async () => {
    // The order is what makes the anti-cheat bound survivable on a long glide:
    // a fresh anchor, then the claim measured against it.
    const { simulation, sync, fetchImpl } = wire(
      {
        'POST /api/player/position': [200, { ok: true }],
        'POST /api/collect': [200, { credited: {}, materials: {}, player: fakePlayer() }],
      },
      { positionIntervalSeconds: 0.1 },
    );

    sync.tick(0.2);
    simulation.collectAt(cachedTrees[0]);
    await sync.idle();

    expect(fetchImpl.pathsCalled()).toEqual([
      'POST /api/player/position',
      'POST /api/collect',
    ]);
  });
});

describe('the Phase 2 loop, end to end', () => {
  it('flies the real simulation, lands, and banks what it found', async () => {
    const banked = [];
    const fetchImpl = createFakeFetch({
      'POST /api/player/position': [200, { ok: true }],
      'POST /api/collect': ({ body }) => {
        banked.push(body.cacheId);
        return [200, {
          credited: { material: 'acorns', amount: 1 },
          materials: { acorns: banked.length, bark: 0, silk: 0, berries: 0 },
          player: fakePlayer({ materials: { acorns: banked.length } }),
        }];
      },
      'GET /api/shop/catalog': [200, { upgrades: [] }],
    });

    const api = createApiClient({ fetch: fetchImpl, token: 'token-test' });
    const simulation = createSimulation({ world });
    const sync = createSync({ api, simulation, delay: noDelay });
    const input = createInputState();

    // Fly real hops with the real autopilot, exactly as the smoke test does.
    // Fewer than half the trees hold a cache, so one hop is a coin flip —
    // hence a handful of them, stopping as soon as something is banked.
    for (let hop = 0; hop < 6 && banked.length === 0; hop += 1) {
      input.launch = true;
      simulation.step(input, FIXED_DT);
      let target = null;
      for (let tick = 0; tick < 40 / FIXED_DT; tick += 1) {
        if (simulation.glider.phase !== 'gliding') break;
        if (!target || tick % 30 === 0) target = chooseTarget(simulation) ?? target;
        steerToward(input, simulation, target);
        simulation.step(input, FIXED_DT);
        sync.tick(FIXED_DT);
      }
      await sync.idle();
    }

    await sync.idle();

    expect(simulation.glider.phase).toBe('perched');
    expect(banked.length).toBeGreaterThan(0);
    expect(simulation.collection.confirmed.acorns).toBe(banked.length);
    expect(simulation.collection.hasUnconfirmed).toBe(false);
  });

  it('a purchase made at a real shop lands in the real profile', async () => {
    const simulation = createSimulation({ world });
    const api = createApiClient({
      fetch: createFakeFetch({
        'GET /api/shop/catalog': [200, { upgrades: [] }],
        'POST /api/shop/purchase': [200, {
          purchased: { upgrade: 'distance', tier: 2 },
          player: fakePlayer({ glideStats: { distance: 2, agility: 0 } }),
        }],
      }),
      token: 'token-test',
    });
    const sync = createSync({ api, simulation, delay: noDelay });

    const before = simulation.profile.glideRatio;

    // Open the shop through the real interaction registry, which is what a
    // landing does — the registry is part of the simulation's public surface.
    simulation.interactions.land(shopTree, {
      glider: simulation.glider,
      world,
      emit: () => {},
    });
    simulation.requestPurchase('distance');
    await sync.idle();

    expect(simulation.stats.distance).toBe(2);
    expect(simulation.profile.glideRatio).toBeGreaterThan(before);
  });
});
