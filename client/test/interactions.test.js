import { describe, expect, it, vi } from 'vitest';
import { TREE_TYPES, generateForest } from '@glidewood/shared';

import { createInteractionRegistry, landmarkInteraction } from '../src/sim/interactions.js';
import { createSimulation } from '../src/sim/simulation.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';

const tree = { id: 'tree-x', type: TREE_TYPES.LANDMARK, name: 'Test Bough' };

describe('interaction registry', () => {
  it('fires the handler registered for a tree type', () => {
    const onLand = vi.fn();
    const onLeave = vi.fn();
    const registry = createInteractionRegistry().register(TREE_TYPES.LANDMARK, { onLand, onLeave });

    registry.land(tree, { emit: vi.fn() });
    registry.leave(tree, { emit: vi.fn() });

    expect(onLand).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onLand.mock.calls[0][0].tree).toBe(tree);
  });

  it('treats an unregistered tree type as a no-op, not an error', () => {
    const registry = createInteractionRegistry();
    expect(registry.has(TREE_TYPES.SHOP)).toBe(false);
    expect(() => registry.land({ id: 't', type: TREE_TYPES.SHOP }, { emit: vi.fn() })).not.toThrow();
  });

  it('tolerates a handler that only implements one half of the pair', () => {
    const registry = createInteractionRegistry().register(TREE_TYPES.LANDMARK, { onLand: vi.fn() });
    expect(() => registry.leave(tree, { emit: vi.fn() })).not.toThrow();
  });
});

describe('landmark interaction', () => {
  it('announces the tree by name on arrival', () => {
    const emit = vi.fn();
    landmarkInteraction.onLand({ tree, emit });
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'landmark:arrived', name: 'Test Bough' }),
    );
  });

  it('falls back to a placeholder when a landmark has no name', () => {
    const emit = vi.fn();
    landmarkInteraction.onLand({ tree: { ...tree, name: undefined }, emit });
    expect(emit.mock.calls[0][0].name).toBeTruthy();
  });
});

describe('simulation wiring', () => {
  it('registers the landmark interaction and announces the spawn perch', () => {
    const events = [];
    const world = generateForest();
    const simulation = createSimulation({ world });
    // The spawn announcement fires during construction, so re-announce it by
    // respawning with a listener attached.
    simulation.on((event) => events.push(event));

    const input = createInputState();
    input.respawn = true;
    simulation.step(input, FIXED_DT);

    expect(simulation.interactions.has(TREE_TYPES.LANDMARK)).toBe(true);
    expect(events.map((event) => event.type)).toContain('landmark:arrived');
  });

  it('does not register economy interactions — those are later phases', () => {
    const simulation = createSimulation({ world: generateForest() });
    expect(simulation.interactions.has(TREE_TYPES.SHOP)).toBe(false);
    expect(simulation.interactions.has(TREE_TYPES.PUZZLE)).toBe(false);
    expect(simulation.interactions.has(TREE_TYPES.CAFETERIA)).toBe(false);
    expect(simulation.interactions.has(TREE_TYPES.CUSTOMIZATION)).toBe(false);
  });
});
