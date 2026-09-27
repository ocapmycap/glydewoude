/**
 * Unit tests for the ring-trial puzzle state machine (LAN-548).
 *
 * `createPuzzleTrial` is pure bookkeeping over hand-built trees, courses and
 * flight points — no simulation, no world, no clock. `puzzle-loop.test.js`
 * covers the wiring into the real `createSimulation` loop.
 */

import { describe, expect, it } from 'vitest';
import { TREE_TYPES } from '@glidewood/shared';

import { createPuzzleTrial } from '../src/sim/puzzle.js';

/** A ring facing +Z, centred on the line x=0, y=10. */
function ring(z, overrides = {}) {
  return { center: { x: 0, y: 10, z }, normal: { x: 0, y: 0, z: 1 }, radius: 2, ...overrides };
}

function makeCourse(targetTreeId = 'tree-target', ringOverrides = [{}, {}, {}]) {
  return {
    targetTreeId,
    rings: [ring(10, ringOverrides[0]), ring(20, ringOverrides[1]), ring(30, ringOverrides[2])],
  };
}

const puzzleTree = { id: 'tree-puzzle', type: TREE_TYPES.PUZZLE, course: makeCourse() };
const sceneryTree = { id: 'tree-scenery', type: TREE_TYPES.SCENERY, course: null };
const targetTree = { id: 'tree-target', type: TREE_TYPES.LANDMARK, course: null };
const otherTree = { id: 'tree-other', type: TREE_TYPES.LANDMARK, course: null };

/** A point just behind a ring's plane, on-centre. */
function before(z) {
  return { x: 0, y: 10, z: z - 1 };
}
/** A point just past a ring's plane, on-centre. */
function after(z) {
  return { x: 0, y: 10, z: z + 1 };
}

describe('createPuzzleTrial', () => {
  describe('arm', () => {
    it('arms a puzzle tree, emitting puzzle:armed with the tree and its course', () => {
      const trial = createPuzzleTrial();
      const events = trial.arm(puzzleTree);

      expect(events).toEqual([
        { type: 'puzzle:armed', tree: puzzleTree, course: puzzleTree.course },
      ]);
      expect(trial.trial).toEqual({
        treeId: puzzleTree.id,
        course: puzzleTree.course,
        started: false,
        nextRing: 0,
      });
    });

    it('emits nothing for a tree that is not a puzzle tree', () => {
      const trial = createPuzzleTrial();
      expect(trial.arm(sceneryTree)).toEqual([]);
      expect(trial.trial).toBeNull();
    });

    it('emits nothing for a PUZZLE-typed tree with no course', () => {
      const trial = createPuzzleTrial();
      expect(trial.arm({ id: 'tree-empty', type: TREE_TYPES.PUZZLE, course: null })).toEqual([]);
      expect(trial.trial).toBeNull();
    });

    it('silently clears an armed-but-unstarted trial when a non-puzzle tree is armed', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);

      expect(trial.arm(sceneryTree)).toEqual([]);
      expect(trial.trial).toBeNull();
    });
  });

  describe('start', () => {
    it('starts an armed trial and emits puzzle:started', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);

      const events = trial.start(puzzleTree);

      expect(events).toEqual([
        { type: 'puzzle:started', treeId: puzzleTree.id, course: puzzleTree.course },
      ]);
      expect(trial.trial.started).toBe(true);
      expect(trial.trial.nextRing).toBe(0);
    });

    it('does nothing when launching from a tree other than the armed one', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);

      expect(trial.start(otherTree)).toEqual([]);
      expect(trial.trial.started).toBe(false);
    });

    it('does nothing when nothing is armed', () => {
      const trial = createPuzzleTrial();
      expect(trial.start(puzzleTree)).toEqual([]);
      expect(trial.trial).toBeNull();
    });

    it('does nothing when the trial is already started', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      expect(trial.start(puzzleTree)).toEqual([]);
    });
  });

  describe('step', () => {
    it('does nothing before the trial has started', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      expect(trial.step(before(10), after(10))).toEqual([]);
    });

    it('emits puzzle:ring and advances when the next ring in order is crossed', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      expect(trial.step(before(10), after(10))).toEqual([
        { type: 'puzzle:ring', treeId: puzzleTree.id, index: 0 },
      ]);
      expect(trial.trial.nextRing).toBe(1);
    });

    it('emits nothing for a step that crosses no ring', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      expect(trial.step({ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 1 })).toEqual([]);
      expect(trial.trial.nextRing).toBe(0);
    });

    it('does not count a ring crossed out of order, but counts it once its turn comes', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      // Ring 1's plane, crossed before ring 0's — must not advance anything.
      expect(trial.step(before(20), after(20))).toEqual([]);
      expect(trial.trial.nextRing).toBe(0);

      // Now ring 0 in order, then ring 1 in order — both register.
      expect(trial.step(before(10), after(10))).toEqual([
        { type: 'puzzle:ring', treeId: puzzleTree.id, index: 0 },
      ]);
      expect(trial.step(before(20), after(20))).toEqual([
        { type: 'puzzle:ring', treeId: puzzleTree.id, index: 1 },
      ]);
      expect(trial.trial.nextRing).toBe(2);
    });
  });

  describe('land', () => {
    function fullyRung() {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);
      trial.step(before(10), after(10));
      trial.step(before(20), after(20));
      trial.step(before(30), after(30));
      return trial;
    }

    it('solves the trial on reaching the target with every ring crossed', () => {
      const trial = fullyRung();
      const glide = { distance: 42 };

      const events = trial.land(targetTree, { reason: 'perch', atTime: 12.5, glide });

      expect(events).toEqual([
        { type: 'puzzle:solved', treeId: puzzleTree.id, atTime: 12.5, glide },
      ]);
      expect(trial.trial).toBeNull();
    });

    it('fails with missed-ring when the target is reached without every ring', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      const events = trial.land(targetTree, { reason: 'perch', atTime: 1, glide: {} });

      expect(events[0]).toEqual({
        type: 'puzzle:failed', treeId: puzzleTree.id, reason: 'missed-ring',
      });
    });

    it('fails with ground on a ground landing mid-attempt', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      const events = trial.land(otherTree, { reason: 'ground', atTime: 1, glide: {} });

      expect(events[0]).toEqual({
        type: 'puzzle:failed', treeId: puzzleTree.id, reason: 'ground',
      });
    });

    it('fails with wrong-tree when perching somewhere else mid-attempt', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      const events = trial.land(otherTree, { reason: 'perch', atTime: 1, glide: {} });

      expect(events[0]).toEqual({
        type: 'puzzle:failed', treeId: puzzleTree.id, reason: 'wrong-tree',
      });
    });

    it('re-arms after a failure when the landed-on tree is the puzzle tree itself', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      const events = trial.land(puzzleTree, { reason: 'ground', atTime: 1, glide: {} });

      expect(events).toEqual([
        { type: 'puzzle:failed', treeId: puzzleTree.id, reason: 'ground' },
        { type: 'puzzle:armed', tree: puzzleTree, course: puzzleTree.course },
      ]);
      expect(trial.trial).toEqual({
        treeId: puzzleTree.id, course: puzzleTree.course, started: false, nextRing: 0,
      });
    });

    it('a failed trial is over: landing elsewhere afterwards does not re-fail it', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);
      trial.land(otherTree, { reason: 'perch', atTime: 1, glide: {} });

      // Nothing is running any more, so this is arm() semantics on a
      // non-puzzle tree: no event, no state.
      expect(trial.land(otherTree, { reason: 'perch', atTime: 2, glide: {} })).toEqual([]);
      expect(trial.trial).toBeNull();
    });

    it('applies arm semantics with no failure or solve when nothing was started', () => {
      const trial = createPuzzleTrial();
      expect(trial.land(sceneryTree, { reason: 'perch', atTime: 1, glide: {} })).toEqual([]);
      expect(trial.land(puzzleTree, { reason: 'perch', atTime: 1, glide: {} })).toEqual([
        { type: 'puzzle:armed', tree: puzzleTree, course: puzzleTree.course },
      ]);
    });
  });

  describe('respawn', () => {
    it('fails the started attempt with reason respawn', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);
      trial.start(puzzleTree);

      const events = trial.respawn();

      expect(events).toEqual([
        { type: 'puzzle:failed', treeId: puzzleTree.id, reason: 'respawn' },
      ]);
      expect(trial.trial).toBeNull();
    });

    it('disarms an armed-but-unstarted trial silently', () => {
      const trial = createPuzzleTrial();
      trial.arm(puzzleTree);

      expect(trial.respawn()).toEqual([]);
      expect(trial.trial).toBeNull();
    });

    it('does nothing when nothing is armed', () => {
      const trial = createPuzzleTrial();
      expect(trial.respawn()).toEqual([]);
      expect(trial.trial).toBeNull();
    });
  });

  describe('purity', () => {
    it('does not mutate the tree, course or points passed to any method', () => {
      const tree = { id: 'tree-puzzle', type: TREE_TYPES.PUZZLE, course: makeCourse() };
      const treeSnapshot = structuredClone(tree);
      const from = before(10);
      const to = after(10);
      const fromSnapshot = structuredClone(from);
      const toSnapshot = structuredClone(to);
      const landInfo = { reason: 'ground', atTime: 1, glide: { distance: 3 } };
      const landInfoSnapshot = structuredClone(landInfo);

      const trial = createPuzzleTrial();
      trial.arm(tree);
      trial.start(tree);
      trial.step(from, to);
      trial.land(tree, landInfo);
      trial.respawn();

      expect(tree).toEqual(treeSnapshot);
      expect(from).toEqual(fromSnapshot);
      expect(to).toEqual(toSnapshot);
      expect(landInfo).toEqual(landInfoSnapshot);
    });
  });
});
