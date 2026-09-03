/**
 * Upgrade tiers reaching the physics.
 *
 * `deriveGlideProfile(stats, tuning)` was written in Phase 1 with stats as a
 * parameter specifically so a Phase 2 server could raise a player's tiers
 * without the integrator knowing where the number came from. This is the test
 * that the wiring actually arrived.
 *
 * Assertions are invariants, not exact values — "a bought tier glides further"
 * rather than "the ratio is 6.4" — so retuning the dials does not break them.
 */

import { describe, expect, it } from 'vitest';
import { generateForest } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';

const world = generateForest();

describe('simulation.applyStats', () => {
  it('starts at whatever tiers it was constructed with', () => {
    const base = createSimulation({ world });
    const upgraded = createSimulation({ world, stats: { distance: 3 } });

    expect(base.stats.distance).toBe(0);
    expect(upgraded.stats.distance).toBe(3);
    expect(upgraded.profile.glideRatio).toBeGreaterThan(base.profile.glideRatio);
  });

  it('re-derives the profile when the server confirms a purchase', () => {
    const simulation = createSimulation({ world });
    const before = simulation.profile.glideRatio;

    simulation.applyStats({ distance: 2 });

    expect(simulation.profile.glideRatio).toBeGreaterThan(before);
  });

  it('extends the reachable range from the same altitude', () => {
    const simulation = createSimulation({ world });
    const before = simulation.remainingRange();

    simulation.applyStats({ distance: 4 });

    expect(simulation.remainingRange()).toBeGreaterThan(before);
  });

  it('turns faster with agility, without touching the glide ratio', () => {
    const simulation = createSimulation({ world });
    const before = simulation.profile;

    simulation.applyStats({ agility: 2 });

    expect(simulation.profile.turnRate).toBeGreaterThan(before.turnRate);
    expect(simulation.profile.glideRatio).toBe(before.glideRatio);
  });

  it('writes into the stats object rather than replacing it', () => {
    const simulation = createSimulation({ world });
    // Anything that grabbed a reference at startup must keep seeing the truth.
    const held = simulation.stats;

    simulation.applyStats({ distance: 1 });

    expect(held.distance).toBe(1);
    expect(simulation.stats).toBe(held);
  });

  it('leaves untouched tiers alone', () => {
    const simulation = createSimulation({ world, stats: { agility: 2 } });

    simulation.applyStats({ distance: 1 });

    expect(simulation.stats.agility).toBe(2);
    expect(simulation.stats.distance).toBe(1);
  });

  it('ignores nonsense rather than corrupting the profile', () => {
    const simulation = createSimulation({ world });
    const before = simulation.profile;

    simulation.applyStats({ distance: 'lots', agility: undefined, flapCharges: NaN });

    expect(simulation.stats.distance).toBe(0);
    expect(simulation.profile).toEqual(before);
  });

  it('announces the change so the UI can react', () => {
    const simulation = createSimulation({ world });
    const seen = [];
    simulation.on((event) => {
      if (event.type === 'stats:changed') seen.push(event);
    });

    simulation.applyStats({ fallControl: 1 });

    expect(seen).toHaveLength(1);
    expect(seen[0].stats.fallControl).toBe(1);
  });

  it('is a no-op when handed nothing', () => {
    const simulation = createSimulation({ world });
    const before = simulation.profile;

    expect(simulation.applyStats(null)).toBe(before);
    expect(simulation.applyStats(undefined)).toBe(before);
  });
});
