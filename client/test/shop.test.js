import { describe, expect, it, vi } from 'vitest';
import { TREE_TYPES, generateForest } from '@glidewood/shared';

import { createShopLedger } from '../src/sim/shop.js';
import { createSimulation } from '../src/sim/simulation.js';

const shopTree = {
  id: 'tree-shop',
  type: TREE_TYPES.SHOP,
  name: 'Barkside Supply',
  position: { x: 10, y: 0, z: -4 },
  perchY: 22,
};

describe('shop interaction', () => {
  it('opens on landing and closes on leaving', () => {
    const shop = createShopLedger();
    const emit = vi.fn();

    shop.interaction.onLand({ tree: shopTree, emit });
    expect(shop.isOpen).toBe(true);
    expect(shop.openTree).toBe(shopTree);
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shop:opened', name: 'Barkside Supply' }),
    );

    shop.interaction.onLeave({ tree: shopTree, emit });
    expect(shop.isOpen).toBe(false);
    expect(shop.openTree).toBe(null);
    expect(emit).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'shop:closed' }),
    );
  });

  it('falls back to a placeholder when a shop has no name', () => {
    const emit = vi.fn();
    createShopLedger().interaction.onLand({ tree: { ...shopTree, name: undefined }, emit });
    expect(emit.mock.calls[0][0].name).toBeTruthy();
  });
});

describe('purchase intents', () => {
  it('raises an intent anchored to the shop and the moment', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });

    const intent = shop.requestPurchase('distance', { atTime: 42.5 });

    expect(intent).toMatchObject({
      seq: 1,
      upgradeKey: 'distance',
      treeId: 'tree-shop',
      atTime: 42.5,
      atPosition: { x: 10, y: 22, z: -4 },
    });
    expect(shop.pending).toHaveLength(1);
  });

  it('carries no price, cost or balance — the server owns all three', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    const intent = shop.requestPurchase('agility');

    for (const forbidden of ['price', 'cost', 'balance', 'materials', 'tier', 'stats']) {
      expect(intent, `an intent must not claim a ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it('refuses to raise an intent with no shop open', () => {
    const shop = createShopLedger();
    expect(shop.requestPurchase('distance')).toBe(null);

    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    shop.interaction.onLeave({ tree: shopTree, emit: vi.fn() });
    expect(shop.requestPurchase('distance')).toBe(null);
    expect(shop.pending).toEqual([]);
  });

  it('ignores a request with no upgrade named', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    expect(shop.requestPurchase(undefined)).toBe(null);
    expect(shop.requestPurchase('')).toBe(null);
  });

  it('sequences intents so a server can order them', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    shop.requestPurchase('distance');
    shop.requestPurchase('agility');
    expect(shop.pending.map((intent) => intent.seq)).toEqual([1, 2]);
  });

  it('drains an intent once the server has answered, either way', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    shop.requestPurchase('distance');
    shop.requestPurchase('agility');

    expect(shop.hasUnconfirmed).toBe(true);
    shop.settle([1]);
    expect(shop.pending.map((intent) => intent.upgradeKey)).toEqual(['agility']);
    shop.settle([2]);
    expect(shop.hasUnconfirmed).toBe(false);
  });

  it('hands back a copy of pending, so a caller cannot edit the queue', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    shop.requestPurchase('distance');

    shop.pending.pop();
    expect(shop.pending).toHaveLength(1);
  });

  it('clears everything on reset', () => {
    const shop = createShopLedger();
    shop.interaction.onLand({ tree: shopTree, emit: vi.fn() });
    shop.requestPurchase('distance');

    shop.reset();
    expect(shop.isOpen).toBe(false);
    expect(shop.pending).toEqual([]);
  });
});

describe('shop wiring in the simulation', () => {
  it('opens the shop by landing on a shop tree, and emits it', () => {
    const world = generateForest();
    const simulation = createSimulation({ world });
    const events = [];
    simulation.on((event) => events.push(event));

    const tree = world.trees.find((candidate) => candidate.type === TREE_TYPES.SHOP);
    expect(tree, 'the default forest should contain a shop').toBeTruthy();

    simulation.interactions.land(tree, { glider: simulation.glider, world, emit: () => {} });
    expect(simulation.shop.openTree).toBe(tree);
  });

  it('raises and emits a purchase intent through the simulation', () => {
    const world = generateForest();
    const simulation = createSimulation({ world });
    const events = [];
    simulation.on((event) => events.push(event));

    const tree = world.trees.find((candidate) => candidate.type === TREE_TYPES.SHOP);
    simulation.interactions.land(tree, { glider: simulation.glider, world, emit: () => {} });

    const intent = simulation.requestPurchase('distance');
    expect(intent).toBeTruthy();
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'shop:purchase-requested' }),
    );
  });

  it('does not change the player\'s stats locally when a purchase is requested', () => {
    const world = generateForest();
    const simulation = createSimulation({ world });
    const before = { ...simulation.stats };
    const rangeBefore = simulation.remainingRange();

    const tree = world.trees.find((candidate) => candidate.type === TREE_TYPES.SHOP);
    simulation.interactions.land(tree, { glider: simulation.glider, world, emit: () => {} });
    simulation.requestPurchase('distance');

    expect(simulation.stats).toEqual(before);
    expect(simulation.remainingRange()).toBe(rangeBefore);
  });

  it('is a no-op when asked to buy from the spawn perch', () => {
    const simulation = createSimulation({ world: generateForest() });
    expect(simulation.requestPurchase('distance')).toBe(null);
  });
});
