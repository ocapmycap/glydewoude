/**
 * Turning around while perched (LAN-577).
 *
 * Before this, `input.steer` and `input.pitch` did nothing while perched —
 * the squirrel could only ever launch along the heading it landed at. Now
 * steering rotates the squirrel on the spot, and a back-tap (pitch >= 0.5,
 * the rising edge — S / down / stick pulled down) plays a scripted half-turn
 * over `profile.aboutFaceDuration`. Clinging and climbing keep ignoring both,
 * exactly as before. Same style as `cling.test.js` and `climb.test.js`: a
 * pure-function suite for the new step function, then the wiring through the
 * real `createSimulation`, driven headlessly.
 */

import { describe, expect, it } from 'vitest';
import { TREE_TYPES, deriveGlideProfile, headingVector } from '@glidewood/shared';

import { GliderPhase, perchOn, stepPerch } from '../src/sim/glider.js';
import { createSimulation } from '../src/sim/simulation.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';

const profile = deriveGlideProfile();

/** Wrap a heading difference into (-π, π], matching glider.js's convention. */
function wrapAngle(angle) {
  const turn = Math.PI * 2;
  let wrapped = angle % turn;
  if (wrapped > Math.PI) wrapped -= turn;
  if (wrapped <= -Math.PI) wrapped += turn;
  return wrapped;
}

/** A single spawn perch, nothing else nearby — nothing to catch a launch. */
const openSpawnTree = {
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

function buildOpenWorld() {
  return {
    seed: 1,
    seedLabel: 'perch-turn-open-test',
    config: { groundY: 0 },
    spawnTreeId: openSpawnTree.id,
    trees: [openSpawnTree],
    bounds: { radius: 400 },
  };
}

describe('steering while perched, end to end through the simulation', () => {
  it('right steer (+1) decreases heading and leaves position untouched', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const startHeading = simulation.glider.motion.heading;
    const startPosition = { ...simulation.glider.motion };

    const steps = 5;
    input.steer = 1;
    for (let i = 0; i < steps; i += 1) simulation.step(input, FIXED_DT);

    const delta = wrapAngle(simulation.glider.motion.heading - startHeading);
    const expectedDelta = wrapAngle(-simulation.profile.perchTurnRate * steps * FIXED_DT);
    expect(delta).toBeCloseTo(expectedDelta, 5);
    expect(delta).toBeLessThan(0);

    expect(simulation.glider.motion.x).toBe(startPosition.x);
    expect(simulation.glider.motion.y).toBe(startPosition.y);
    expect(simulation.glider.motion.z).toBe(startPosition.z);
  });

  it('left steer (-1) turns the other way', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const startHeading = simulation.glider.motion.heading;

    input.steer = -1;
    for (let i = 0; i < 5; i += 1) simulation.step(input, FIXED_DT);

    const delta = wrapAngle(simulation.glider.motion.heading - startHeading);
    expect(delta).toBeGreaterThan(0);
  });
});

describe('the back-tap about-face, end to end through the simulation', () => {
  it('plays out over several steps rather than snapping instantly', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const startHeading = simulation.glider.motion.heading;

    input.pitch = 1;
    simulation.step(input, FIXED_DT);
    input.pitch = 0;

    const afterOneStep = Math.abs(wrapAngle(simulation.glider.motion.heading - startHeading));
    expect(afterOneStep).toBeGreaterThan(0);
    expect(afterOneStep).toBeLessThan(Math.PI / 2);
  });

  it('adds up to exactly pi, toward increasing heading, once aboutFaceDuration has elapsed', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const startHeading = simulation.glider.motion.heading;

    input.pitch = 1;
    simulation.step(input, FIXED_DT);
    input.pitch = 0;

    const margin = 0.2; // seconds of slack over the tuned duration
    const remainingSteps = Math.ceil((simulation.profile.aboutFaceDuration + margin) / FIXED_DT);
    for (let i = 0; i < remainingSteps; i += 1) simulation.step(input, FIXED_DT);

    const totalTurn = Math.abs(wrapAngle(simulation.glider.motion.heading - startHeading));
    expect(totalTurn).toBeCloseTo(Math.PI, 6);
  });

  it('gives exactly one pi turn even if pitch is held down for the whole duration, not one per step', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const startHeading = simulation.glider.motion.heading;

    const margin = 0.2;
    const totalSteps = Math.ceil((simulation.profile.aboutFaceDuration + margin) / FIXED_DT);
    input.pitch = 1;
    for (let i = 0; i < totalSteps; i += 1) simulation.step(input, FIXED_DT);

    const totalTurn = Math.abs(wrapAngle(simulation.glider.motion.heading - startHeading));
    expect(totalTurn).toBeCloseTo(Math.PI, 6);
  });

  it('steer is ignored while an about-face is in progress', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();

    input.pitch = 1;
    simulation.step(input, FIXED_DT);
    input.pitch = 0;

    // Right in the middle of the turn, try to steer too — it must not add on
    // top of the scripted about-face.
    const midway = simulation.glider.motion.heading;
    input.steer = 1;
    simulation.step(input, FIXED_DT);
    input.steer = 0;
    const afterSteerAttempt = simulation.glider.motion.heading;

    // The about-face is still turning the *same* direction (increasing
    // heading) it was already turning in, regardless of the steer held
    // alongside it — steer alone would have decreased heading instead.
    const stepDelta = wrapAngle(afterSteerAttempt - midway);
    expect(stepDelta).toBeGreaterThan(0);
  });

  it('pitch already held when the squirrel lands does not trigger an about-face', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();

    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING); // precondition

    // Hold pitch >= 0.5 (a flare) for the whole glide down to ground contact
    // — the rising edge happens mid-air, well before the squirrel is perched
    // again, so it must not fire once it lands.
    input.pitch = 1;
    const maxTicks = Math.ceil(30 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }
    expect(simulation.glider.phase).toBe(GliderPhase.PERCHED); // precondition

    const headingAtLanding = simulation.glider.motion.heading;
    // Still held, one more perched step — no about-face should start, since
    // the edge already happened before landing, not after.
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.motion.heading).toBe(headingAtLanding);
  });
});

describe('launching after a perch turn leaves along the new heading', () => {
  it('flies toward the heading the squirrel was turned to face, not the original spawn heading', () => {
    const simulation = createSimulation({ world: buildOpenWorld(), caches: [] });
    const input = createInputState();
    const spawnHeading = simulation.glider.motion.heading;

    input.steer = 1;
    for (let i = 0; i < 10; i += 1) simulation.step(input, FIXED_DT);
    input.steer = 0;

    const turnedHeading = simulation.glider.motion.heading;
    // Precondition: the turn actually happened. Without it this test would
    // pass vacuously (launching along the untouched spawn heading matches
    // itself), so fail loudly here instead.
    expect(wrapAngle(turnedHeading - spawnHeading)).not.toBeCloseTo(0, 5);

    const startPosition = { ...simulation.glider.motion };

    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(simulation.glider.phase).toBe(GliderPhase.GLIDING);

    for (let i = 0; i < 5; i += 1) simulation.step(input, FIXED_DT);

    const forward = headingVector(turnedHeading);
    const dx = simulation.glider.motion.x - startPosition.x;
    const dz = simulation.glider.motion.z - startPosition.z;
    const length = Math.hypot(dx, dz);

    expect(length).toBeGreaterThan(0);
    expect(dx / length).toBeCloseTo(forward.x, 2);
    expect(dz / length).toBeCloseTo(forward.z, 2);
  });
});

describe('clinging still ignores steer and pitch', () => {
  // Same minimal world as cling.test.js: a spawn perch pointed straight at a
  // towering trunk placed on the launch heading, close enough to hit while
  // still well above the ground.
  const spawnTree = { ...openSpawnTree };
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

  function buildClingWorld() {
    return {
      seed: 1,
      seedLabel: 'perch-turn-cling-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree, towerTree],
      bounds: { radius: 100 },
    };
  }

  function flyIntoTower() {
    const simulation = createSimulation({ world: buildClingWorld(), caches: [] });
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    const maxTicks = Math.ceil(10 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }
    return { simulation, input };
  }

  it('does not change heading while steer and pitch are held', () => {
    const { simulation, input } = flyIntoTower();
    expect(simulation.glider.phase).toBe(GliderPhase.CLINGING); // precondition

    const headingAtCling = simulation.glider.motion.heading;
    input.steer = 1;
    input.pitch = 1;
    for (let i = 0; i < 10; i += 1) {
      simulation.step(input, FIXED_DT);
      expect(simulation.glider.phase).toBe(GliderPhase.CLINGING);
    }
    expect(simulation.glider.motion.heading).toBe(headingAtCling);
  });
});

describe('climbing still ignores steer and pitch', () => {
  // Same minimal world as climb.test.js: a spawn perch pointed at an ordinary
  // tree far enough away that a straight glide catches the bare trunk below
  // its canopy band.
  const spawnTree = { ...openSpawnTree };
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

  function buildClimbWorld() {
    return {
      seed: 1,
      seedLabel: 'perch-turn-climb-test',
      config: { groundY: 0 },
      spawnTreeId: spawnTree.id,
      trees: [spawnTree, trunkTree],
      bounds: { radius: 200 },
    };
  }

  function flyIntoTrunk() {
    const simulation = createSimulation({ world: buildClimbWorld(), caches: [] });
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    const maxTicks = Math.ceil(20 / FIXED_DT);
    for (let tick = 0; tick < maxTicks; tick += 1) {
      simulation.step(input, FIXED_DT);
      if (simulation.glider.phase !== GliderPhase.GLIDING) break;
    }
    return { simulation, input };
  }

  it('reaches the same heading whether or not steer and pitch are held throughout the climb', () => {
    const control = flyIntoTrunk();
    const steered = flyIntoTrunk();
    expect(control.simulation.glider.phase).toBe(GliderPhase.CLIMBING); // precondition
    expect(steered.simulation.glider.phase).toBe(GliderPhase.CLIMBING); // precondition

    const maxTicks = Math.ceil(30 / FIXED_DT);
    let tick = 0;
    while (control.simulation.glider.phase === GliderPhase.CLIMBING && tick < maxTicks) {
      control.simulation.step(control.input, FIXED_DT);
      steered.input.steer = 1;
      steered.input.pitch = 1;
      steered.simulation.step(steered.input, FIXED_DT);
      tick += 1;
    }
    expect(tick).toBeLessThan(maxTicks); // the climb actually finished in budget

    expect(control.simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(steered.simulation.glider.phase).toBe(GliderPhase.PERCHED);
    expect(steered.simulation.glider.motion.heading).toBeCloseTo(control.simulation.glider.motion.heading, 5);
  });
});

describe('stepPerch (glider.js), pure function', () => {
  const tree = { id: 'tree-perch', position: { x: 0, y: 0, z: 0 }, perchY: 20 };

  function perched(heading = 0) {
    return perchOn(tree, heading);
  }

  it('does not mutate the glider it is given', () => {
    const glider = perched();
    const snapshot = JSON.parse(JSON.stringify(glider));
    stepPerch(glider, { steer: 1, aboutFace: false }, profile, FIXED_DT);
    expect(glider).toEqual(snapshot);
  });

  it('does not mutate the glider mid about-face either', () => {
    const glider = perched();
    const turning = stepPerch(glider, { steer: 0, aboutFace: true }, profile, FIXED_DT);
    const snapshot = JSON.parse(JSON.stringify(turning));
    stepPerch(turning, { steer: 0, aboutFace: false }, profile, FIXED_DT);
    expect(turning).toEqual(snapshot);
  });

  it('returns the same glider unchanged when not perched', () => {
    const clinging = { phase: GliderPhase.CLINGING, treeId: tree.id, motion: perched().motion, glide: null };
    const result = stepPerch(clinging, { steer: 1, aboutFace: true }, profile, FIXED_DT);
    expect(result).toBe(clinging);
  });

  it('rotates heading in place by perchTurnRate * dt, leaving position untouched', () => {
    const glider = perched();
    const turned = stepPerch(glider, { steer: 1, aboutFace: false }, profile, FIXED_DT);

    expect(turned.motion.heading).toBeCloseTo(wrapAngle(-profile.perchTurnRate * FIXED_DT), 5);
    expect(turned.motion.x).toBe(glider.motion.x);
    expect(turned.motion.y).toBe(glider.motion.y);
    expect(turned.motion.z).toBe(glider.motion.z);
  });

  it('keeps heading wrapped into (-pi, pi] across many steps of turning', () => {
    let glider = perched();
    for (let i = 0; i < 200; i += 1) {
      glider = stepPerch(glider, { steer: 1, aboutFace: false }, profile, FIXED_DT);
      expect(glider.motion.heading).toBeGreaterThan(-Math.PI);
      expect(glider.motion.heading).toBeLessThanOrEqual(Math.PI);
    }
  });
});
