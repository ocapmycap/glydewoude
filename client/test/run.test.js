/**
 * Run mode, driven through the shipped loop.
 *
 * Everything here goes through `createSimulation` and the scripted pilot, the
 * way `glide-loop.smoke.test.js` does — a run only exists as a consequence of
 * launching, catching bark and falling, so a test that called the tracker
 * directly would prove the tracker works and nothing about the game.
 *
 * The arithmetic is `shared/test/run.test.js`'s job. What is asserted here is
 * the wiring: which loop transition raises which event, what the event
 * carries, and when `simulation.run` goes back to null.
 */

import { describe, expect, it } from 'vitest';
import { generateForest, isBankable } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { GliderPhase } from '../src/sim/glider.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';
import { chooseTarget, steerToward } from './helpers/autopilot.js';

/** Collect every event a simulation emits, for the life of the test. */
function recordEvents(simulation) {
  const events = [];
  simulation.on((event) => events.push(event));
  return events;
}

/** Fly one hop: launch, steer at a reachable tree, stop when we perch again. */
function flyOneHop(simulation, input, maxSeconds = 40) {
  input.launch = true;
  simulation.step(input, FIXED_DT);

  let target = null;
  const maxTicks = Math.ceil(maxSeconds / FIXED_DT);
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    if (!target || tick % 30 === 0) target = chooseTarget(simulation) ?? target;
    steerToward(input, simulation, target);
    simulation.step(input, FIXED_DT);
  }
}

/**
 * A world with nothing but the great tree in it.
 *
 * `placementAttempts: 0` scatters no trees, so there is no bark to catch and
 * a launch can only end on the forest floor. It is the one situation the
 * autopilot cannot arrange on purpose, and the ground is half the rule.
 */
function emptyClearing() {
  return generateForest({ placementAttempts: 0 });
}

/** Launch and fly straight until something ends the glide. */
function flyUntilLanded(simulation, input, maxSeconds = 60) {
  input.launch = true;
  simulation.step(input, FIXED_DT);
  const maxTicks = Math.ceil(maxSeconds / FIXED_DT);
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    simulation.step(input, FIXED_DT);
  }
}

describe('run mode', () => {
  it('has no run in progress until the first launch', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    expect(simulation.run).toBeNull();

    input.launch = true;
    simulation.step(input, FIXED_DT);

    expect(events.filter((event) => event.type === 'run:started')).toHaveLength(1);
    expect(simulation.run).not.toBeNull();
    expect(simulation.run.chain).toBe(0);
    expect(simulation.run.score).toBe(0);
    expect(simulation.run.endedAt).toBeNull();
  });

  it('extends the chain on every perch landing, and only opens one run', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    for (let hop = 0; hop < 4; hop += 1) flyOneHop(simulation, input);

    const landings = events.filter((event) => event.type === 'glide:landed');
    expect(landings.every((event) => event.reason === 'perch')).toBe(true);

    const extended = events.filter((event) => event.type === 'run:extended');
    expect(extended).toHaveLength(landings.length);
    // Four hops without touching the ground is one run, not four.
    expect(events.filter((event) => event.type === 'run:started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'run:ended')).toHaveLength(0);

    expect(simulation.run.chain).toBe(extended.length);
    expect(simulation.run.score).toBeGreaterThan(0);
    expect(simulation.run.distance).toBeGreaterThan(0);
  });

  it('reports the points a landing added, and they sum to the score', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    for (let hop = 0; hop < 3; hop += 1) flyOneHop(simulation, input);

    const extended = events.filter((event) => event.type === 'run:extended');
    expect(extended.length).toBeGreaterThan(0);
    for (const event of extended) {
      expect(event.points).toBeGreaterThan(0);
      expect(event.run.treeIds).toContain(event.tree.id);
    }
    const summed = extended.reduce((total, event) => total + event.points, 0);
    expect(summed).toBe(simulation.run.score);
  });

  it('carries the run forward across events rather than restarting it', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    for (let hop = 0; hop < 3; hop += 1) flyOneHop(simulation, input);

    const chains = events
      .filter((event) => event.type === 'run:extended')
      .map((event) => event.run.chain);
    expect(chains).toEqual(chains.map((_, index) => index + 1));

    // Every landing is on a tree the run has not used, so each is fresher and
    // further into the chain than the last.
    const scores = events
      .filter((event) => event.type === 'run:extended')
      .map((event) => event.run.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it('ends the run on ground contact and clears the run in progress', () => {
    const simulation = createSimulation({ world: emptyClearing() });
    const input = createInputState();
    const events = recordEvents(simulation);

    flyUntilLanded(simulation, input);

    const landing = events.find((event) => event.type === 'glide:landed');
    expect(landing?.reason).toBe('ground');

    const ended = events.filter((event) => event.type === 'run:ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].reason).toBe('ground');
    expect(ended[0].run.endedAt).toBeGreaterThan(0);
    expect(simulation.run).toBeNull();
  });

  it('ends a run below the bank threshold silently — the event still fires', () => {
    const simulation = createSimulation({ world: emptyClearing() });
    const input = createInputState();
    const events = recordEvents(simulation);

    flyUntilLanded(simulation, input);

    const ended = events.find((event) => event.type === 'run:ended');
    // Nothing was caught, so the chain never started: an event to clear the
    // HUD with, and nothing for the sync to post.
    expect(ended.run.chain).toBe(0);
    expect(isBankable(ended.run)).toBe(false);
  });

  it('starts a fresh run on the next launch after a run ended', () => {
    const simulation = createSimulation({ world: emptyClearing() });
    const input = createInputState();
    const events = recordEvents(simulation);

    flyUntilLanded(simulation, input);
    expect(simulation.run).toBeNull();

    flyUntilLanded(simulation, input);

    expect(events.filter((event) => event.type === 'run:started')).toHaveLength(2);
    expect(events.filter((event) => event.type === 'run:ended')).toHaveLength(2);
  });

  it('ends the run on respawn, with a reason the HUD can tell apart', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    for (let hop = 0; hop < 3; hop += 1) flyOneHop(simulation, input);
    const chain = simulation.run.chain;
    expect(chain).toBeGreaterThanOrEqual(2);

    input.respawn = true;
    simulation.step(input, FIXED_DT);

    const ended = events.filter((event) => event.type === 'run:ended');
    expect(ended).toHaveLength(1);
    expect(ended[0].reason).toBe('respawn');
    expect(ended[0].run.chain).toBe(chain);
    expect(ended[0].run.endedAt).toBeGreaterThan(0);
    // A real chain, so the HUD and the sync both act on this one.
    expect(isBankable(ended[0].run)).toBe(true);
    expect(simulation.run).toBeNull();
  });

  it('does not end a run that was never started', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();
    const events = recordEvents(simulation);

    input.respawn = true;
    simulation.step(input, FIXED_DT);

    expect(events.filter((event) => event.type === 'run:ended')).toHaveLength(0);
    expect(simulation.run).toBeNull();
  });

  it('leaves the collection ledger alone when a run ends', () => {
    const simulation = createSimulation({ world: generateForest() });
    const input = createInputState();

    for (let hop = 0; hop < 4; hop += 1) flyOneHop(simulation, input);
    const collected = simulation.collection.pending.length;
    expect(collected).toBeGreaterThan(0);

    input.respawn = true;
    simulation.step(input, FIXED_DT);

    // A run ending is not a death: the chain is gone and the materials are not.
    expect(simulation.run).toBeNull();
    expect(simulation.collection.pending).toHaveLength(collected);
  });

  it('is deterministic: the same flight scores the same run', () => {
    const fly = () => {
      const simulation = createSimulation({ world: generateForest() });
      const input = createInputState();
      for (let hop = 0; hop < 3; hop += 1) flyOneHop(simulation, input);
      return simulation.run;
    };
    expect(fly()).toEqual(fly());
  });
});
