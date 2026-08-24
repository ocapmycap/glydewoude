/**
 * Collection, including the constraint that matters most about it: the client
 * raises intents and never awards itself materials (product doc §6.1).
 */

import { describe, expect, it } from 'vitest';
import { MATERIAL_TYPES, generateForest, generateMaterialCaches } from '@glidewood/shared';

import { createCollectionLedger } from '../src/sim/collection.js';
import { createSimulation } from '../src/sim/simulation.js';
import { GliderPhase } from '../src/sim/glider.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';
import { chooseTarget, steerToward } from './helpers/autopilot.js';

const tree = { id: 'tree-042' };
const cache = {
  id: 'cache-tree-042',
  treeId: 'tree-042',
  material: MATERIAL_TYPES.ACORNS,
  amount: 3,
  effort: 0.5,
  position: { x: 1, y: 2, z: 3 },
};

const ledgerWithOneCache = () => createCollectionLedger({ caches: [cache] });

describe('collection ledger', () => {
  it('raises an intent when a tree carries an unclaimed cache', () => {
    const ledger = ledgerWithOneCache();
    const intent = ledger.collectAt(tree, { atTime: 12.5 });

    expect(intent).toMatchObject({
      seq: 1,
      cacheId: cache.id,
      material: MATERIAL_TYPES.ACORNS,
      amount: 3,
      atTime: 12.5,
    });
    expect(ledger.pending).toHaveLength(1);
  });

  it('carries the context a server needs to judge plausibility', () => {
    const ledger = ledgerWithOneCache();
    const glide = { distance: 180, duration: 11.5, altitudeLost: 32 };
    const intent = ledger.collectAt(tree, { atTime: 40, glide });

    // §6.1: "is that plausible given last known position/time?"
    expect(intent.atPosition).toEqual(cache.position);
    expect(intent.viaGlide).toEqual(glide);
    expect(intent.atTime).toBe(40);
  });

  it('returns null for a tree with no cache', () => {
    expect(ledgerWithOneCache().collectAt({ id: 'tree-999' })).toBeNull();
  });

  it('returns null for a missing tree rather than throwing', () => {
    expect(ledgerWithOneCache().collectAt(undefined)).toBeNull();
    expect(ledgerWithOneCache().collectAt(null)).toBeNull();
  });

  it('cannot be farmed by landing on the same tree twice', () => {
    const ledger = ledgerWithOneCache();
    expect(ledger.collectAt(tree)).not.toBeNull();
    expect(ledger.collectAt(tree)).toBeNull();
    expect(ledger.collectAt(tree)).toBeNull();
    expect(ledger.pending).toHaveLength(1);
  });

  it('numbers intents in order so a server can sequence them', () => {
    const ledger = createCollectionLedger({
      caches: [cache, { ...cache, id: 'cache-b', treeId: 'tree-b' }],
    });
    ledger.collectAt(tree);
    ledger.collectAt({ id: 'tree-b' });
    expect(ledger.pending.map((i) => i.seq)).toEqual([1, 2]);
  });
});

describe('the client never awards itself materials', () => {
  it('starts with nothing confirmed', () => {
    const ledger = ledgerWithOneCache();
    for (const amount of Object.values(ledger.confirmed)) expect(amount).toBe(0);
  });

  it('leaves confirmed totals at zero after collecting', () => {
    const ledger = ledgerWithOneCache();
    ledger.collectAt(tree);
    // The pickup happened locally; the balance did not. Only a server may
    // move `confirmed`, and none has spoken yet.
    expect(ledger.confirmed[MATERIAL_TYPES.ACORNS]).toBe(0);
    expect(ledger.hasUnconfirmed).toBe(true);
  });

  it('shows the pickup only as provisional', () => {
    const ledger = ledgerWithOneCache();
    ledger.collectAt(tree);
    expect(ledger.provisionalTotals()[MATERIAL_TYPES.ACORNS]).toBe(3);
  });

  it('does not let a caller mutate its internals through the getters', () => {
    const ledger = ledgerWithOneCache();
    ledger.collectAt(tree);
    ledger.pending.pop();
    ledger.confirmed[MATERIAL_TYPES.ACORNS] = 9999;
    expect(ledger.pending).toHaveLength(1);
    expect(ledger.confirmed[MATERIAL_TYPES.ACORNS]).toBe(0);
  });
});

describe('server verdicts', () => {
  it('takes the server total as the truth rather than adding to it', () => {
    const ledger = ledgerWithOneCache();
    const intent = ledger.collectAt(tree);
    // The server says the real balance is 1, not the 3 we claimed.
    ledger.settle([intent.seq], { [MATERIAL_TYPES.ACORNS]: 1 });

    expect(ledger.confirmed[MATERIAL_TYPES.ACORNS]).toBe(1);
    expect(ledger.provisionalTotals()[MATERIAL_TYPES.ACORNS]).toBe(1);
    expect(ledger.hasUnconfirmed).toBe(false);
  });

  it('fills in materials the server omitted', () => {
    const ledger = ledgerWithOneCache();
    ledger.settle([], { [MATERIAL_TYPES.SILK]: 4 });
    expect(ledger.confirmed[MATERIAL_TYPES.ACORNS]).toBe(0);
    expect(ledger.confirmed[MATERIAL_TYPES.SILK]).toBe(4);
  });

  it('drops rejected intents without crediting them', () => {
    const ledger = ledgerWithOneCache();
    const intent = ledger.collectAt(tree);
    ledger.reject([intent.seq]);

    expect(ledger.pending).toHaveLength(0);
    expect(ledger.provisionalTotals()[MATERIAL_TYPES.ACORNS]).toBe(0);
  });

  it('keeps a rejected cache claimed, so it cannot be retried', () => {
    const ledger = ledgerWithOneCache();
    ledger.reject([ledger.collectAt(tree).seq]);
    expect(ledger.collectAt(tree)).toBeNull();
  });

  it('settles only the sequence numbers it was given', () => {
    const ledger = createCollectionLedger({
      caches: [cache, { ...cache, id: 'cache-b', treeId: 'tree-b' }],
    });
    const first = ledger.collectAt(tree);
    ledger.collectAt({ id: 'tree-b' });
    ledger.settle([first.seq], null);
    expect(ledger.pending.map((i) => i.seq)).toEqual([2]);
  });

  it('resets to a clean run', () => {
    const ledger = ledgerWithOneCache();
    ledger.collectAt(tree);
    ledger.reset();
    expect(ledger.pending).toHaveLength(0);
    expect(ledger.collectAt(tree)).not.toBeNull();
  });
});

describe('collection through the real simulation', () => {
  /** Fly hops with the scripted pilot until it has collected `wanted` caches. */
  function flyUntilCollected(simulation, input, wanted, maxHops = 12) {
    const collected = [];
    const off = simulation.on((event) => {
      if (event.type === 'material:collected') collected.push(event);
    });

    for (let hop = 0; hop < maxHops && collected.length < wanted; hop += 1) {
      input.launch = true;
      simulation.step(input, FIXED_DT);
      let target = null;
      for (let tick = 0; tick < 2400; tick += 1) {
        if (simulation.glider.phase !== GliderPhase.GLIDING) break;
        if (!target || tick % 20 === 0) target = chooseTarget(simulation) ?? target;
        steerToward(input, simulation, target);
        simulation.step(input, FIXED_DT);
      }
    }
    off();
    return collected;
  }

  it('derives caches from the world seed when none are supplied', () => {
    const simulation = createSimulation({ world: generateForest() });
    expect(simulation.collection.caches.length).toBeGreaterThan(0);
    expect(simulation.collection.caches)
      .toEqual(generateMaterialCaches(simulation.world));
  });

  it('collects materials while flying the actual glide loop', () => {
    const simulation = createSimulation({ world: generateForest() });
    const collected = flyUntilCollected(simulation, createInputState(), 2);

    expect(collected.length).toBeGreaterThanOrEqual(2);
    for (const event of collected) {
      expect(event.intent.treeId).toBe(event.tree.id);
      expect(event.intent.amount).toBeGreaterThan(0);
    }
  });

  it('stamps intents with simulation time, never a wall clock', () => {
    const simulation = createSimulation({ world: generateForest() });
    const collected = flyUntilCollected(simulation, createInputState(), 1);

    const [first] = collected;
    expect(first.intent.atTime).toBeGreaterThan(0);
    expect(first.intent.atTime).toBeLessThanOrEqual(simulation.elapsed);
  });

  it('records the glide that earned the pickup', () => {
    const simulation = createSimulation({ world: generateForest() });
    const [first] = flyUntilCollected(simulation, createInputState(), 1);
    expect(first.intent.viaGlide.distance).toBeGreaterThan(0);
  });

  it('keeps the client balance at zero no matter how much is picked up', () => {
    const simulation = createSimulation({ world: generateForest() });
    flyUntilCollected(simulation, createInputState(), 3);

    for (const amount of Object.values(simulation.collection.confirmed)) {
      expect(amount).toBe(0);
    }
    expect(simulation.collection.pending.length).toBeGreaterThan(0);
  });

  it('does not emit a collection event for a tree with no cache', () => {
    const world = generateForest();
    const simulation = createSimulation({ world, caches: [] });
    const events = [];
    simulation.on((event) => {
      if (event.type === 'material:collected') events.push(event);
    });

    flyUntilCollected(simulation, createInputState(), 1, 3);
    expect(events).toHaveLength(0);
  });

  it('leaves the Phase 1 glide loop untouched', () => {
    // Collection must not perturb the trajectory: same world, same inputs,
    // same flight, whether or not there is anything to pick up.
    const fly = (caches) => {
      const simulation = createSimulation({ world: generateForest(), caches });
      const input = createInputState();
      input.launch = true;
      simulation.step(input, FIXED_DT);
      for (let tick = 0; tick < 400; tick += 1) {
        input.steer = Math.sin(tick / 40);
        simulation.step(input, FIXED_DT);
      }
      return simulation.glider.motion;
    };
    expect(fly([])).toEqual(fly(undefined));
  });
});
