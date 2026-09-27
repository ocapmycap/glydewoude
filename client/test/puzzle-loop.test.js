/**
 * The ring-trial puzzle, driven end to end through the real `createSimulation`
 * (LAN-548). `puzzle.test.js` covers `createPuzzleTrial` in isolation; this
 * file covers the wiring — arming on the spawn perch, starting on launch,
 * checking rings against the actual airborne motion, and resolving on landing
 * or respawn.
 *
 * The rings and the target tree are not guessed at: a probe flight (straight,
 * no steering) records real points on the trajectory the fixed-timestep
 * physics produces, and the puzzle geometry is built from those points. That
 * is what makes a hand-authored course reliably solvable by a straight glide
 * without hardcoding a tuning-sensitive distance or time.
 */

import { describe, expect, it } from 'vitest';
import { TREE_TYPES, generateForest } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { GliderPhase } from '../src/sim/glider.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';

/** A world with nothing but the great tree — see run.test.js's emptyClearing. */
function emptyClearing() {
  return generateForest({ placementAttempts: 0 });
}

/** Collect every event a simulation emits, for the life of the test. */
function recordEvents(simulation) {
  const events = [];
  simulation.on((event) => events.push(event));
  return events;
}

/**
 * Fly straight (steer 0, pitch 0) from a fresh launch until the glide ends,
 * recording every airborne motion sample. Physics never reads the world, so
 * these samples land on the exact same points a later run reaches, as long as
 * the input script and the starting perch match.
 */
function probeTrajectory(world) {
  const simulation = createSimulation({ world });
  const input = createInputState();
  input.launch = true;
  simulation.step(input, FIXED_DT);

  const positions = [];
  while (simulation.glider.phase === GliderPhase.GLIDING) {
    positions.push({ ...simulation.glider.motion });
    simulation.step(input, FIXED_DT);
  }
  return positions;
}

/** A ring facing +Z, centred exactly on a probed trajectory point. */
function ringAt(point, overrides = {}) {
  return {
    center: { x: point.x, y: point.y, z: point.z },
    normal: { x: 0, y: 0, z: 1 },
    radius: 3,
    ...overrides,
  };
}

/**
 * A tree that will catch the glide at `point`, whichever of the two catch
 * volumes ends up applying — the height band is built around the sampled
 * altitude itself, not a trunk height, so the probe's own numbers decide it.
 */
function makeCatchTree(id, point) {
  return {
    id,
    type: TREE_TYPES.LANDMARK,
    name: 'Test Target',
    isDestination: true,
    position: { x: point.x, y: 0, z: point.z },
    trunkHeight: point.y,
    trunkRadius: 1,
    canopyRadius: 4,
    perchY: point.y + 5,
    perchRadius: 6,
    canopyDepth: 12,
    catchRadius: 6,
    minCatchY: point.y - 10,
    structures: [],
    course: null,
  };
}

/** Turn the spawn tree of `base` into a puzzle tree carrying `course`. */
function buildWorld(base, course, extraTrees = []) {
  const spawnTree = base.trees.find((tree) => tree.id === base.spawnTreeId);
  const puzzleTree = { ...spawnTree, type: TREE_TYPES.PUZZLE, course };
  return { ...base, trees: [puzzleTree, ...extraTrees] };
}

// --- Shared geometry, derived once from a real probe flight ---------------

const base = emptyClearing();
const trajectory = probeTrajectory(base);
// Comfortably long enough that the fractions below land on distinct, ordered
// ticks with real room between them.
if (trajectory.length < 200) {
  throw new Error('probe flight too short for this test\'s assumptions');
}

const idx25 = Math.floor(trajectory.length * 0.25);
const idx50 = Math.floor(trajectory.length * 0.5);
const idx75 = Math.floor(trajectory.length * 0.75);
const idxTarget = Math.floor(trajectory.length * 0.9);

const targetTree = makeCatchTree('tree-target', trajectory[idxTarget]);
const ringsOnPath = [ringAt(trajectory[idx25]), ringAt(trajectory[idx50]), ringAt(trajectory[idx75])];
// Same planes, but centred far off the flight line: the plane is still
// crossed, but never inside the ring's radius, so this course cannot be rung.
const ringsOffPath = ringsOnPath.map((ring) => ({
  ...ring,
  center: { ...ring.center, x: ring.center.x + 50 },
  radius: 1,
}));

describe('puzzle trial, end to end', () => {
  it('arms on construction, starts on launch, rings in order, solves on the target', () => {
    const course = { targetTreeId: targetTree.id, rings: ringsOnPath };
    const world = buildWorld(base, course, [targetTree]);
    const simulation = createSimulation({ world });

    // The spawn announcement fires during construction (see
    // interactions.test.js), so read the armed state directly rather than
    // relying on a listener that was not attached yet.
    expect(simulation.puzzle.trial).toEqual({
      treeId: world.spawnTreeId, course, started: false, nextRing: 0,
    });

    const events = recordEvents(simulation);
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);
    expect(events.some((event) => event.type === 'puzzle:started')).toBe(true);

    while (simulation.glider.phase === GliderPhase.GLIDING) {
      simulation.step(input, FIXED_DT);
    }

    const rings = events.filter((event) => event.type === 'puzzle:ring');
    expect(rings.map((event) => event.index)).toEqual([0, 1, 2]);
    expect(rings.every((event) => event.treeId === world.spawnTreeId)).toBe(true);

    const landed = events.find((event) => event.type === 'glide:landed');
    expect(landed?.reason).toBe('perch');
    expect(landed?.tree.id).toBe(targetTree.id);

    const solved = events.find((event) => event.type === 'puzzle:solved');
    expect(solved).toEqual({
      type: 'puzzle:solved',
      treeId: world.spawnTreeId,
      atTime: simulation.elapsed,
      glide: landed.glide,
    });

    // A solved trial is over until the puzzle tree is landed on again.
    expect(simulation.puzzle.trial).toBeNull();
  });

  it('fails with missed-ring when the target is caught without ringing the course', () => {
    const course = { targetTreeId: targetTree.id, rings: ringsOffPath };
    const world = buildWorld(base, course, [targetTree]);
    const simulation = createSimulation({ world });
    const events = recordEvents(simulation);
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);

    while (simulation.glider.phase === GliderPhase.GLIDING) {
      simulation.step(input, FIXED_DT);
    }

    // Same reachable target as the solved case, but no ring was ever inside.
    expect(events.some((event) => event.type === 'puzzle:ring')).toBe(false);

    const landed = events.find((event) => event.type === 'glide:landed');
    expect(landed?.reason).toBe('perch');
    expect(landed?.tree.id).toBe(targetTree.id);

    expect(events).toContainEqual({
      type: 'puzzle:failed', treeId: world.spawnTreeId, reason: 'missed-ring',
    });
    // Landed on the target, not the puzzle tree, so nothing re-arms.
    expect(simulation.puzzle.trial).toBeNull();
  });

  it('fails with ground and re-arms when nothing catches the glide', () => {
    // No target tree at all, so the only possible ending is the ground.
    const course = { targetTreeId: 'tree-nowhere', rings: ringsOnPath };
    const world = buildWorld(base, course);
    const simulation = createSimulation({ world });
    const events = recordEvents(simulation);
    const input = createInputState();
    input.launch = true;
    simulation.step(input, FIXED_DT);

    while (simulation.glider.phase === GliderPhase.GLIDING) {
      simulation.step(input, FIXED_DT);
    }

    const landed = events.find((event) => event.type === 'glide:landed');
    expect(landed?.reason).toBe('ground');

    expect(events).toContainEqual({
      type: 'puzzle:failed', treeId: world.spawnTreeId, reason: 'ground',
    });
    // Ground recovery puts the squirrel back on the only tree there is — the
    // puzzle tree itself — so landing() re-arms it.
    expect(events.filter((event) => event.type === 'puzzle:armed')).toHaveLength(1);
    expect(simulation.puzzle.trial).toEqual({
      treeId: world.spawnTreeId, course, started: false, nextRing: 0,
    });
  });

  it('fails with respawn mid-attempt, then re-arms the spawn perch', () => {
    const course = { targetTreeId: 'tree-nowhere', rings: ringsOnPath };
    const world = buildWorld(base, course);
    const simulation = createSimulation({ world });
    const events = recordEvents(simulation);
    const input = createInputState();

    input.launch = true;
    simulation.step(input, FIXED_DT);
    input.launch = false;
    simulation.step(input, FIXED_DT); // a tick airborne, before any ring

    input.respawn = true;
    simulation.step(input, FIXED_DT);

    expect(events).toContainEqual({
      type: 'puzzle:failed', treeId: world.spawnTreeId, reason: 'respawn',
    });
    expect(simulation.puzzle.trial).toEqual({
      treeId: world.spawnTreeId, course, started: false, nextRing: 0,
    });
  });

  it('disarms silently on a respawn that never launched — no puzzle:failed', () => {
    const course = { targetTreeId: 'tree-nowhere', rings: ringsOnPath };
    const world = buildWorld(base, course);
    const simulation = createSimulation({ world });
    const events = recordEvents(simulation);
    const input = createInputState();

    input.respawn = true;
    simulation.step(input, FIXED_DT);

    expect(events.some((event) => event.type === 'puzzle:failed')).toBe(false);
    // Respawning lands back on the spawn perch, which is the puzzle tree
    // here, so it re-arms rather than staying disarmed.
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'puzzle:armed', course }),
    );
  });

  it('never touches the glide trajectory, with or without a course on the tree', () => {
    const withCourse = buildWorld(base, { targetTreeId: 'tree-nowhere', rings: ringsOnPath });
    const spawnTree = base.trees.find((tree) => tree.id === base.spawnTreeId);
    const withoutCourse = { ...base, trees: [{ ...spawnTree }] };

    const flyStraight = (world) => {
      const simulation = createSimulation({ world });
      const input = createInputState();
      input.launch = true;
      simulation.step(input, FIXED_DT);
      for (let tick = 0; tick < 200; tick += 1) simulation.step(input, FIXED_DT);
      return simulation.glider.motion;
    };

    expect(flyStraight(withCourse)).toEqual(flyStraight(withoutCourse));
  });
});
