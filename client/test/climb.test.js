/**
 * Climbing the trunk after an ordinary tree's side catch (LAN-571).
 *
 * Before this, a trunk catch teleported straight to the perch exactly like a
 * canopy drop. Now a catch below the canopy band should enter a `climbing`
 * phase, rise up the trunk it was actually caught on, and only become
 * `perched` once it reaches the top — mirroring how `cling.test.js` covers
 * the glider state machine and the wiring through the real `createSimulation`.
 */

import { describe, expect, it } from 'vitest';
import { GLIDE_TUNING, TREE_TYPES, deriveGlideProfile, distance2D } from '@glidewood/shared';

import { GliderPhase, climbFrom, perchOn, stepClimb } from '../src/sim/glider.js';
import { resolveLanding } from '../src/sim/landing.js';
import { createSimulation } from '../src/sim/simulation.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';

describe('GliderPhase.CLIMBING', () => {
  it('exists as its own phase, distinct from the others', () => {
    expect(GliderPhase.CLIMBING).toBe('climbing');
    const values = Object.values(GliderPhase);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('GLIDE_TUNING.climbSpeed', () => {
  it('is 8 m/s — the agreed default', () => {
    expect(GLIDE_TUNING.climbSpeed).toBe(8);
  });

  it('flows into the derived profile untouched', () => {
    const tuning = { ...GLIDE_TUNING, climbSpeed: 12 };
    const profile = deriveGlideProfile(undefined, tuning);
    expect(profile.climbSpeed).toBe(12);
  });

  it('changing the tuning changes the profile, so nothing downstream needs GLIDE_TUNING directly', () => {
    const slow = deriveGlideProfile(undefined, { ...GLIDE_TUNING, climbSpeed: 3 });
    const fast = deriveGlideProfile(undefined, { ...GLIDE_TUNING, climbSpeed: 30 });
    expect(fast.climbSpeed).toBeGreaterThan(slow.climbSpeed);
  });
});

describe('resolveLanding: a trunk catch adds climbFrom', () => {
  const tree = {
    id: 'tree-trunk',
    towering: false,
    position: { x: 5, y: 0, z: -3 },
    perchY: 30,
    minCatchY: 4,
    catchRadius: 3,
    perchRadius: 4,
    canopyDepth: 6,
    trunkRadius: 1.3,
  };
  const world = { config: { groundY: 0 }, trees: [tree] };
  // Below the canopy band (perchY - canopyDepth = 24) and above minCatchY —
  // a hit on the bare trunk, not a drop into the canopy.
  const trunkY = tree.minCatchY + 2;

  function at(y, offset) {
    return { x: tree.position.x + offset, y, z: tree.position.z };
  }

  it('still reports reason "perch" for a trunk catch', () => {
    const spot = at(trunkY, tree.catchRadius - 0.2);
    const landing = resolveLanding(world, { ...spot, y: trunkY + 1 }, spot);
    expect(landing.reason).toBe('perch');
  });

  it('adds climbFrom on the trunk surface, at the height it was caught', () => {
    const spot = at(trunkY, tree.catchRadius - 0.2);
    const landing = resolveLanding(world, { ...spot, y: trunkY + 1 }, spot);

    expect(landing.climbFrom).toBeDefined();
    expect(landing.climbFrom.y).toBe(spot.y);
    expect(distance2D(tree.position, landing.climbFrom)).toBeCloseTo(tree.trunkRadius, 5);
  });

  it('does not add climbFrom for a canopy catch', () => {
    const spot = at(tree.perchY - 0.5, tree.perchRadius - 0.5);
    const landing = resolveLanding(world, { ...spot, y: tree.perchY + 1 }, spot);

    expect(landing.reason).toBe('perch');
    expect(landing.climbFrom).toBeUndefined();
  });
});

describe('climbFrom (glider.js)', () => {
  const tree = { id: 'tree-climb', position: { x: 2, y: 0, z: 7 }, perchY: 22 };
  const point = { x: tree.position.x + 1.3, y: 10, z: tree.position.z };

  function perchedGlider() {
    return perchOn({ id: 'tree-perch', position: { x: 0, y: 0, z: 0 }, perchY: 15 });
  }

  it('does not mutate the glider it is given', () => {
    const glider = perchedGlider();
    const snapshot = JSON.parse(JSON.stringify(glider));
    climbFrom(glider, tree, point);
    expect(glider).toEqual(snapshot);
  });

  it('enters climbing, at the given point, on the given tree, at rest', () => {
    const climbing = climbFrom(perchedGlider(), tree, point);

    expect(climbing.phase).toBe(GliderPhase.CLIMBING);
    expect(climbing.treeId).toBe(tree.id);
    expect(climbing.motion.x).toBe(point.x);
    expect(climbing.motion.y).toBe(point.y);
    expect(climbing.motion.z).toBe(point.z);
    expect(climbing.motion.speed).toBe(0);
    expect(climbing.motion.vy).toBe(0);
  });

  it('carries over the glider’s existing glide stats', () => {
    const glide = { startX: 1, startZ: 2, startY: 3, distance: 4, altitudeLost: 5, duration: 6 };
    const glider = { ...perchedGlider(), glide };
    const climbing = climbFrom(glider, tree, point);
    expect(climbing.glide).toEqual(glide);
  });
});

describe('stepClimb (glider.js)', () => {
  const tree = { id: 'tree-climb', position: { x: 0, y: 0, z: 0 }, perchY: 20 };
  const profile = deriveGlideProfile(undefined, { ...GLIDE_TUNING, climbSpeed: 5 });

  function climbingGliderAt(y) {
    const perched = perchOn({ id: 'tree-perch', position: { x: 9, y: 0, z: 9 }, perchY: 5 });
    return climbFrom(perched, tree, { x: tree.position.x + 1, y, z: tree.position.z });
  }

  it('does not mutate the glider it is given', () => {
    const glider = climbingGliderAt(10);
    const snapshot = JSON.parse(JSON.stringify(glider));
    stepClimb(glider, tree, profile, FIXED_DT);
    expect(glider).toEqual(snapshot);
  });

  it('rises by climbSpeed * dt, keeping x and z fixed, while still below the perch', () => {
    const glider = climbingGliderAt(10);
    const dt = 0.1;
    const climbed = stepClimb(glider, tree, profile, dt);

    expect(climbed.phase).toBe(GliderPhase.CLIMBING);
    expect(climbed.motion.y).toBeCloseTo(10 + profile.climbSpeed * dt, 5);
    expect(climbed.motion.x).toBe(glider.motion.x);
    expect(climbed.motion.z).toBe(glider.motion.z);
  });

  it('becomes perched at the tree once it reaches perchY', () => {
    const dt = FIXED_DT;
    // Close enough to the top that one more step overshoots perchY.
    const nearTop = climbingGliderAt(tree.perchY - profile.climbSpeed * dt * 0.5);
    const climbed = stepClimb(nearTop, tree, profile, dt);

    expect(climbed.phase).toBe(GliderPhase.PERCHED);
    expect(climbed.treeId).toBe(tree.id);
    expect(climbed.motion.x).toBe(tree.position.x);
    expect(climbed.motion.z).toBe(tree.position.z);
    expect(climbed.motion.y).toBe(tree.perchY);
  });

  it('keeps the glide stats once the climb finishes', () => {
    const glide = { startX: 1, startZ: 2, startY: 3, distance: 4, altitudeLost: 5, duration: 6 };
    const nearTop = { ...climbingGliderAt(tree.perchY - 0.01), glide };
    const climbed = stepClimb(nearTop, tree, profile, FIXED_DT);
    expect(climbed.glide).toEqual(glide);
  });
});

describe('climbing, end to end through the simulation', () => {
  // A minimal hand-built world, in the same style as cling.test.js: an
  // ordinary spawn perch pointed straight at a second ordinary tree far
  // enough away that a straight glide arrives well below its canopy band —
  // a trunk catch, not a canopy drop.
  const spawnTree = {
    id: 'tree-spawn',
    type: TREE_TYPES.LANDMARK,
    isDestination: true,
    name: 'Spawn Bough',
    position: { x: 0, y: 0, z: 0 },
    trunkHeight: 40,
    trunkRadius: 1,
    canopyRadius: 5,
    perchY: 40,
    perchRadius: 5,
    canopyDepth: 8,
    catchRadius: 3,
    minCatchY: 5,
    structures: [],
    course: null,
    towering: false,
  };
  const trunkTree = {
    id: 'tree-trunk-target',
    type: TREE_TYPES.SCENERY,
    isDestination: false,
    name: undefined,
    position: { x: 0, y: 0, z: 140 },
    trunkHeight: 40,
    trunkRadius: 1.2,
    canopyRadius: 6,
    perchY: 40,
    perchRadius: 5,
    canopyDepth: 8,
    catchRadius: 4,
    minCatchY: 4,
    structures: [],
    course: null,
    towering: false,
  };

  function buildWorld() {
    return {
      seed: 1,
      seedLabel: 'climb-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree, trunkTree],
      bounds: { radius: 200 },
    };
  }

  /** Launch and fly straight until something other than gliding happens. */
  function flyIntoTrunk() {
    const simulation = createSimulation({ world: buildWorld(), caches: [] });
    const events = [];
    simulation.on((event) => events.push(event));

    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    const maxTicks = Math.ceil(20 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }

    return { simulation, events, input };
  }

  it('a trunk catch enters climbing on the caught tree, and glide:landed fires once, at the catch', () => {
    const { simulation, events } = flyIntoTrunk();

    expect(simulation.glider.phase).toBe(GliderPhase.CLIMBING);
    expect(simulation.glider.treeId).toBe(trunkTree.id);

    // The catch geometry is chosen so the hit happens under the canopy band —
    // proving this is the LAN-571 trunk catch and not a canopy drop.
    expect(simulation.glider.motion.y).toBeLessThan(trunkTree.perchY - trunkTree.canopyDepth);
    expect(simulation.glider.motion.y).toBeGreaterThan(trunkTree.minCatchY);

    const landedEvents = events.filter((event) => event.type === 'glide:landed');
    expect(landedEvents).toHaveLength(1);
    expect(landedEvents[0].tree.id).toBe(trunkTree.id);
  });

  it('rises without leaving the trunk, and ends perched on the same tree', () => {
    const { simulation, input } = flyIntoTrunk();
    expect(simulation.glider.phase).toBe(GliderPhase.CLIMBING); // precondition

    let lastY = simulation.glider.motion.y;
    const maxTicks = Math.ceil(30 / FIXED_DT);
    let tick = 0;
    while (simulation.glider.phase === GliderPhase.CLIMBING && tick < maxTicks) {
      simulation.step(input, FIXED_DT);
      tick += 1;

      if (simulation.glider.phase === GliderPhase.CLIMBING) {
        const horizontal = distance2D(trunkTree.position, simulation.glider.motion);
        expect(horizontal).toBeCloseTo(trunkTree.trunkRadius, 1);
      }
      expect(simulation.glider.motion.y).toBeGreaterThanOrEqual(lastY);
      expect(simulation.glider.motion.y).toBeLessThanOrEqual(trunkTree.perchY);
      lastY = simulation.glider.motion.y;
    }

    // The climb actually finished inside the tick budget, so the assertions
    // above cover a real climb rather than a loop that timed out mid-air.
    expect(tick).toBeLessThan(maxTicks);
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(simulation.glider.treeId).toBe(trunkTree.id);
  });

  it('ignores launch held down through the climb, and does not queue it for after', () => {
    const { simulation, input } = flyIntoTrunk();
    expect(simulation.glider.phase).toBe(GliderPhase.CLIMBING); // precondition

    const maxTicks = Math.ceil(30 / FIXED_DT);
    let tick = 0;
    while (simulation.glider.phase === GliderPhase.CLIMBING && tick < maxTicks) {
      // A held key is asserted every frame by the real input system — this
      // is what "launch ignored mid-climb" actually has to survive.
      input.launch = true;
      simulation.step(input, FIXED_DT);
      tick += 1;
    }
    expect(tick).toBeLessThan(maxTicks);

    // The climb finished perched, not airborne — the launch held throughout
    // never queued up and fired the moment the climb ended.
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);

    // A fresh launch input does start a glide, proving the squirrel is not
    // stuck — only that the held one never queued.
    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);
  });
});

describe('a canopy catch still goes straight to perched, not climbing', () => {
  const spawnTree = {
    id: 'tree-spawn-canopy',
    type: TREE_TYPES.LANDMARK,
    isDestination: true,
    name: 'Spawn Bough',
    position: { x: 0, y: 0, z: 0 },
    trunkHeight: 40,
    trunkRadius: 1,
    canopyRadius: 5,
    perchY: 40,
    perchRadius: 5,
    canopyDepth: 8,
    catchRadius: 3,
    minCatchY: 5,
    structures: [],
    course: null,
    towering: false,
  };
  // Close enough that a straight glide is still up in the canopy band when it
  // arrives, rather than having sunk down to the bare trunk.
  const canopyTree = {
    id: 'tree-canopy-target',
    type: TREE_TYPES.SCENERY,
    isDestination: false,
    name: undefined,
    position: { x: 0, y: 0, z: 15 },
    trunkHeight: 40,
    trunkRadius: 1.2,
    canopyRadius: 6,
    perchY: 40,
    perchRadius: 5,
    canopyDepth: 8,
    catchRadius: 4,
    minCatchY: 4,
    structures: [],
    course: null,
    towering: false,
  };

  function buildWorld() {
    return {
      seed: 1,
      seedLabel: 'canopy-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree, canopyTree],
      bounds: { radius: 100 },
    };
  }

  it('never passes through climbing on the way to perched', () => {
    const simulation = createSimulation({ world: buildWorld(), caches: [] });
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    const maxTicks = Math.ceil(10 / FIXED_DT);
    let sawClimbing = false;
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase === GliderPhase.CLIMBING) sawClimbing = true;
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }

    expect(sawClimbing).toBe(false);
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(simulation.glider.treeId).toBe(canopyTree.id);
    // Caught up in the canopy band, not down on the bare trunk.
    expect(simulation.glider.motion.y).toBeGreaterThanOrEqual(canopyTree.perchY - canopyTree.canopyDepth);
  });
});

describe('ground contact still teleports straight to perched, not climbing', () => {
  const spawnTree = {
    id: 'tree-spawn-ground',
    type: TREE_TYPES.LANDMARK,
    isDestination: true,
    name: 'Spawn Bough',
    position: { x: 0, y: 0, z: 0 },
    trunkHeight: 20,
    trunkRadius: 1,
    canopyRadius: 5,
    perchY: 20,
    perchRadius: 5,
    canopyDepth: 6,
    catchRadius: 3,
    minCatchY: 3,
    structures: [],
    course: null,
    towering: false,
  };

  function buildWorld() {
    return {
      seed: 1,
      seedLabel: 'ground-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree],
      bounds: { radius: 50 },
    };
  }

  it('recovers straight to perched off a ground hit', () => {
    const simulation = createSimulation({ world: buildWorld(), caches: [] });
    const input = createInputState();
    input.launch = true;
    input.pitch = -1; // dive hard, straight to the floor
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    const maxTicks = Math.ceil(20 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }

    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(simulation.glider.treeId).toBe(spawnTree.id);
  });
});
