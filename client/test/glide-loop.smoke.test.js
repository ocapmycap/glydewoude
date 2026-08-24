/**
 * Smoke test for the core glide loop.
 *
 * This is the test the Phase 1 gate hangs on: perch -> launch -> glide ->
 * land on a different tree -> do it again. It drives the shipped
 * `createSimulation` object with the shipped fixed-timestep stepper, in plain
 * Node, with no DOM, no WebGL and no browser.
 *
 * It asserts that the loop *works*, not that it feels good. Feel is manual —
 * the product doc is explicit that feel-based systems resist automated testing
 * (§7.4), so this covers the mechanics and the tuning panel covers the rest.
 */

import { describe, expect, it } from 'vitest';
import { generateForest } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { GliderPhase } from '../src/sim/glider.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';
import { chooseTarget, steerToward } from './helpers/autopilot.js';

/** Fly one hop: launch, steer at a reachable tree, stop when we perch again. */
function flyOneHop(simulation, input, maxSeconds = 40) {
  const startTreeId = simulation.glider.treeId;
  const events = [];
  const off = simulation.on((event) => events.push(event));

  input.launch = true;
  simulation.step(input, FIXED_DT);
  expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

  let sawGliding = false;
  let target = null;
  const maxTicks = Math.ceil(maxSeconds / FIXED_DT);

  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    sawGliding = true;
    if (!target || tick % 30 === 0) target = chooseTarget(simulation) ?? target;
    steerToward(input, simulation, target);
    simulation.step(input, FIXED_DT);
  }

  off();
  return {
    startTreeId,
    sawGliding,
    events,
    landing: events.find((event) => event.type === 'glide:landed'),
  };
}

describe('core glide loop', () => {
  it('launches, glides, and lands on a different tree', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();

    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(simulation.glider.treeId).toBe(simulation.world.spawnTreeId);

    const hop = flyOneHop(simulation, input);

    expect(hop.sawGliding).toBe(true);
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(simulation.glider.treeId).not.toBe(hop.startTreeId);

    // Caught a tree in flight, not recovered off the forest floor.
    expect(hop.landing?.reason).toBe('perch');
    expect(hop.landing?.glide.distance).toBeGreaterThan(20);
    expect(hop.landing?.glide.altitudeLost).toBeGreaterThan(0);
  });

  it('repeats: a landed squirrel can launch again and reach a further tree', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();

    const visited = [simulation.glider.treeId];
    for (let hop = 0; hop < 5; hop += 1) {
      const result = flyOneHop(simulation, input);
      expect(result.landing, `hop ${hop} never landed`).toBeDefined();
      // Every hop is a real mid-air catch. If altitude were unrecoverable the
      // chain would decay into ground recoveries within a hop or two, so this
      // is the assertion that the loop actually sustains itself.
      expect(result.landing.reason, `hop ${hop} fell to the ground`).toBe('perch');
      expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
      visited.push(simulation.glider.treeId);
    }

    // Five hops, six perches, and no bouncing between the same two branches.
    expect(visited).toHaveLength(6);
    expect(new Set(visited).size).toBe(6);
  });

  it('is deterministic: identical inputs produce an identical trajectory', () => {
    const fly = () => {
      const simulation = createSimulation({ world: generateForest() });
      const input = createInputState();
      input.launch = true;
      simulation.step(input, FIXED_DT);
      for (let tick = 0; tick < 300; tick += 1) {
        input.steer = Math.sin(tick / 40);
        input.pitch = tick > 150 ? -0.5 : 0;
        simulation.step(input, FIXED_DT);
      }
      return simulation.glider.motion;
    };
    expect(fly()).toEqual(fly());
  });

  it('never leaves the squirrel airborne below the forest floor', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();

    input.launch = true;
    simulation.step(input, FIXED_DT);
    // Fly straight with no steering until something catches us.
    for (let tick = 0; tick < 60 * 60; tick += 1) {
      simulation.step(input, FIXED_DT);
      expect(simulation.glider.motion.y).toBeGreaterThan(simulation.world.config.groundY - 1);
      if (simulation.glider.phase === GliderPhase.PERCHED) break;
    }
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
  });

  it('respawns back to the great tree on request', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();

    flyOneHop(simulation, input);
    expect(simulation.glider.treeId).not.toBe(simulation.world.spawnTreeId);

    input.respawn = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.treeId).toBe(simulation.world.spawnTreeId);
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
  });
});
