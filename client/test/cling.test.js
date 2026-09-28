/**
 * Clinging to a towering tree (LAN-554).
 *
 * `landing.test.js` covers the geometry of `resolveLanding`'s cling check;
 * this file covers what happens once one fires — the glider state machine
 * (`clingTo`, `launch` from a cling) and the wiring through the real
 * `createSimulation`, driven headlessly exactly like `glide-loop.smoke.test.js`
 * and `puzzle-loop.test.js` do.
 */

import { describe, expect, it, vi } from 'vitest';
import { TREE_TYPES, deriveGlideProfile, distance2D, headingVector } from '@glidewood/shared';

import { GliderPhase, clingTo, launch, perchOn, stepAirborne } from '../src/sim/glider.js';
import { resolveLanding } from '../src/sim/landing.js';
import { createSimulation } from '../src/sim/simulation.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';

const profile = deriveGlideProfile();

/** A towering trunk to cling to, matching the Tree shape resolveLanding needs. */
const tower = {
  id: 'tree-tower',
  towering: true,
  position: { x: 10, y: 0, z: 0 },
  trunkHeight: 100,
  trunkRadius: 2,
};

/** A perched glider, arbitrary starting tree — only used to seed clingTo's input. */
function perchedGlider() {
  return perchOn({ id: 'tree-perch', position: { x: 0, y: 0, z: 0 }, perchY: 30 });
}

describe('clingTo', () => {
  const point = { x: tower.position.x + tower.trunkRadius, y: 22, z: tower.position.z };

  it('does not mutate the glider it is given', () => {
    const glider = perchedGlider();
    const snapshot = JSON.parse(JSON.stringify(glider));
    clingTo(glider, tower, point);
    expect(glider).toEqual(snapshot);
  });

  it('puts the glider in the clinging phase, at the given point, on the given tree', () => {
    const clung = clingTo(perchedGlider(), tower, point);

    expect(clung.phase).toBe(GliderPhase.CLINGING);
    expect(clung.treeId).toBe(tower.id);
    expect(clung.motion.x).toBe(point.x);
    expect(clung.motion.y).toBe(point.y);
    expect(clung.motion.z).toBe(point.z);
    expect(clung.motion.speed).toBe(0);
    expect(clung.motion.vy).toBe(0);
    expect(clung.motion.yawRate).toBe(0);
  });

  it('faces the trunk centre from the cling point', () => {
    const clung = clingTo(perchedGlider(), tower, point);
    const forward = headingVector(clung.motion.heading);

    const toCentre = { x: tower.position.x - point.x, z: tower.position.z - point.z };
    const length = Math.hypot(toCentre.x, toCentre.z);

    expect(forward.x).toBeCloseTo(toCentre.x / length, 5);
    expect(forward.z).toBeCloseTo(toCentre.z / length, 5);
  });

  it('carries over the glider’s existing glide stats', () => {
    const glider = { ...perchedGlider(), glide: { startX: 1, startZ: 2, startY: 3, distance: 4, altitudeLost: 5, duration: 6 } };
    const clung = clingTo(glider, tower, point);
    expect(clung.glide).toEqual(glider.glide);
  });
});

describe('launch from clinging', () => {
  const point = { x: tower.position.x + tower.trunkRadius, y: 30, z: tower.position.z };

  function clungGlider() {
    return clingTo(perchedGlider(), tower, point);
  }

  it('starts a glide, at the cling point, at launch speed', () => {
    const glider = clungGlider();
    const launched = launch(glider, profile, profile);

    expect(launched.phase).toBe(GliderPhase.GLIDING);
    expect(launched.motion.x).toBe(point.x);
    expect(launched.motion.y).toBe(point.y);
    expect(launched.motion.z).toBe(point.z);
    expect(launched.motion.speed).toBe(profile.launchSpeed);
  });

  it('records the tower as fromTreeId', () => {
    const launched = launch(clungGlider(), profile, profile);
    expect(launched.fromTreeId).toBe(tower.id);
  });

  it('faces straight away from the trunk centre', () => {
    const launched = launch(clungGlider(), profile, profile);
    const forward = headingVector(launched.motion.heading);

    const awayFromCentre = { x: point.x - tower.position.x, z: point.z - tower.position.z };
    const length = Math.hypot(awayFromCentre.x, awayFromCentre.z);

    expect(forward.x).toBeCloseTo(awayFromCentre.x / length, 5);
    expect(forward.z).toBeCloseTo(awayFromCentre.z / length, 5);
  });

  it('does not mutate the clinging glider it launches from', () => {
    const glider = clungGlider();
    const snapshot = JSON.parse(JSON.stringify(glider));
    launch(glider, profile, profile);
    expect(glider).toEqual(snapshot);
  });

  it('does not re-catch the trunk in the steps right after launching', () => {
    const launched = launch(clungGlider(), profile, profile);
    // Precondition: launch actually left the cling behind. If this fails the
    // loop below is meaningless, so fail loudly here instead of silently
    // "passing" a no-op launch.
    expect(launched.phase).toBe(GliderPhase.GLIDING);

    const world = { config: { groundY: -1000 }, trees: [tower] };
    const input = { steer: 0, pitch: 0 };
    let current = launched;

    for (let tick = 0; tick < 10; tick += 1) {
      const { glider: moved, previous } = stepAirborne(current, input, profile, FIXED_DT, profile);
      const landing = resolveLanding(world, previous, moved.motion, launched.fromTreeId);
      expect(landing).toBeNull();
      current = moved;
    }
  });
});

describe('cling, end to end through the simulation', () => {
  // A minimal hand-built world: an ordinary spawn perch pointed straight at a
  // towering trunk placed on the launch heading (heading 0 -> +Z, per
  // shared/src/glide.js's headingVector), close enough to hit while still well
  // above the ground, and with minCatchY set above the hit height so a
  // catch here can only be the LAN-554 cling, never the ordinary trunk catch.
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
  const towerTree = {
    id: 'tree-tower',
    type: TREE_TYPES.SCENERY,
    isDestination: false,
    name: undefined,
    position: { x: 0, y: 0, z: 25 },
    trunkHeight: 200,
    trunkRadius: 3,
    canopyRadius: 10,
    perchY: null,
    perchRadius: 10,
    canopyDepth: 25,
    catchRadius: 4,
    minCatchY: 60,
    structures: [],
    course: null,
    towering: true,
  };

  function buildWorld() {
    return {
      seed: 1,
      seedLabel: 'cling-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree, towerTree],
      bounds: { radius: 100 },
    };
  }

  /** Launch and fly straight until something other than gliding happens. */
  function flyIntoTower() {
    const simulation = createSimulation({ world: buildWorld(), caches: [] });
    const events = [];
    simulation.on((event) => events.push(event));
    const sceneryOnLand = vi.fn();
    simulation.interactions.register(TREE_TYPES.SCENERY, { onLand: sceneryOnLand });

    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    const maxTicks = Math.ceil(10 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }

    return { simulation, events, input, sceneryOnLand };
  }

  it('clings to the trunk instead of landing, falling through, or hitting ground', () => {
    const { simulation, events, sceneryOnLand } = flyIntoTower();

    expect(simulation.glider.phase).toBe(GliderPhase.CLINGING);
    expect(simulation.glider.treeId).toBe(towerTree.id);

    const clung = events.find((event) => event.type === 'glide:clung');
    expect(clung).toBeDefined();
    expect(clung.tree.id).toBe(towerTree.id);
    expect(clung.height).toBe(simulation.glider.motion.y);
    // The geometry is chosen so the hit happens well under minCatchY, proving
    // this is the LAN-554 cling and not the ordinary trunk catch.
    expect(clung.height).toBeLessThan(towerTree.minCatchY);

    expect(events.some((event) => event.type === 'glide:landed')).toBe(false);
    expect(events.some((event) => event.type === 'material:collected')).toBe(false);
    expect(sceneryOnLand).not.toHaveBeenCalledWith(
      expect.objectContaining({ tree: expect.objectContaining({ id: towerTree.id }) }),
    );

    // The chain the player was building keeps going — clinging is a catch,
    // not a fall.
    expect(events.some((event) => event.type === 'run:extended')).toBe(true);
  });

  it('launches back off the trunk and moves away from it, without re-clinging', () => {
    const { simulation, events, input } = flyIntoTower();
    // Precondition for the rest of this test to mean anything.
    expect(simulation.glider.phase).toBe(GliderPhase.CLINGING);

    const clingPoint = { ...simulation.glider.motion };

    input.launch = true;
    simulation.step(input, FIXED_DT);

    expect(events.some((event) => event.type === 'glide:launched')).toBe(true);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    const startDistance = distance2D(towerTree.position, clingPoint);

    for (let tick = 0; tick < 60; tick += 1) {
      simulation.step(input, FIXED_DT);
      expect(simulation.glider.phase).not.toBe(GliderPhase.CLINGING);
    }

    const endDistance = distance2D(towerTree.position, simulation.glider.motion);
    expect(endDistance).toBeGreaterThan(startDistance);
  });
});
