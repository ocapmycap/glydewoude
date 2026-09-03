/**
 * Applying a server player snapshot to the running simulation.
 *
 * Two invariants: a higher tier changes the physics (a better distance tier
 * glides further), and the server's balance becomes the confirmed total the
 * player can spend. Exact ranges are not asserted — only that the tier moved
 * the glide the right way, per the repo's "invariants over values" rule.
 */

import { describe, expect, it } from 'vitest';
import { MATERIAL_TYPES } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { applyUpgrade } from '../src/net/apply-upgrade.js';

const stats = (over = {}) => ({
  distance: 0,
  agility: 0,
  flapCharges: 0,
  fallControl: 0,
  ...over,
});

describe('applyUpgrade', () => {
  it('lengthens the glide when a distance tier is purchased', () => {
    const simulation = createSimulation();
    const before = simulation.remainingRange();

    applyUpgrade(simulation, { glideStats: stats({ distance: 3 }) });

    expect(simulation.remainingRange()).toBeGreaterThan(before);
  });

  it('writes the server balance into the confirmed total', () => {
    const simulation = createSimulation();

    applyUpgrade(simulation, {
      glideStats: stats({ distance: 1 }),
      materials: { [MATERIAL_TYPES.ACORNS]: 42 },
    });

    expect(simulation.collection.confirmed[MATERIAL_TYPES.ACORNS]).toBe(42);
  });

  it('does nothing with a null player', () => {
    const simulation = createSimulation();
    expect(() => applyUpgrade(simulation, null)).not.toThrow();
  });
});
