/**
 * The ring-trial puzzle (LAN-548): a course of rings to cross, in order,
 * between launching from a puzzle tree and catching its target.
 *
 * This module only watches. It reads the glider's motion each step and
 * compares it against ring geometry — it never steers or lands the squirrel,
 * so it cannot fight the player's own input. Whether a solve pays out is a
 * later phase's problem: product doc §6.1 puts anything touching a balance
 * behind the server, so `puzzle:solved` is an event to be validated and
 * rewarded elsewhere (LAN-550), not a place to credit currency here.
 */

import { TREE_TYPES, crossesRing } from '@glidewood/shared';

/**
 * @typedef {object} PuzzleTrial
 * @property {string} treeId    the puzzle tree's id
 * @property {object} course    `{ targetTreeId, rings }` copied from the tree
 * @property {boolean} started  false once armed, true once launched
 * @property {number} nextRing  index of the next ring in `course.rings` due
 */

/**
 * @returns {{
 *   arm: (tree: object) => object[],
 *   start: (tree: object) => object[],
 *   step: (previous: object, next: object) => object[],
 *   land: (tree: object, info: { reason: string, atTime: number, glide: object }) => object[],
 *   respawn: () => object[],
 *   trial: PuzzleTrial|null,
 * }}
 */
export function createPuzzleTrial() {
  /** @type {PuzzleTrial|null} */
  let trial = null;

  /** Arm `tree`'s course, or — for anything else — clear an unstarted one. */
  function arm(tree) {
    if (tree.type === TREE_TYPES.PUZZLE && tree.course) {
      trial = { treeId: tree.id, course: tree.course, started: false, nextRing: 0 };
      return [{ type: 'puzzle:armed', tree, course: tree.course }];
    }
    if (trial && !trial.started) {
      trial = null;
    }
    return [];
  }

  function start(tree) {
    if (trial && trial.treeId === tree.id && !trial.started) {
      trial = { ...trial, started: true };
      return [{ type: 'puzzle:started', treeId: trial.treeId, course: trial.course }];
    }
    return [];
  }

  function step(previous, next) {
    if (!trial || !trial.started) return [];
    const { rings } = trial.course;
    if (trial.nextRing >= rings.length) return [];
    if (!crossesRing(previous, next, rings[trial.nextRing])) return [];
    const index = trial.nextRing;
    trial = { ...trial, nextRing: index + 1 };
    return [{ type: 'puzzle:ring', treeId: trial.treeId, index }];
  }

  function land(tree, { reason, atTime, glide }) {
    if (!trial || !trial.started) {
      return arm(tree);
    }

    const { treeId, course, nextRing } = trial;
    let events;
    if (reason === 'ground') {
      events = [{ type: 'puzzle:failed', treeId, reason: 'ground' }];
    } else if (tree.id === course.targetTreeId) {
      events = nextRing === course.rings.length
        ? [{ type: 'puzzle:solved', treeId, atTime, glide }]
        : [{ type: 'puzzle:failed', treeId, reason: 'missed-ring' }];
    } else {
      events = [{ type: 'puzzle:failed', treeId, reason: 'wrong-tree' }];
    }

    trial = null;
    return [...events, ...arm(tree)];
  }

  function respawn() {
    const events = trial && trial.started
      ? [{ type: 'puzzle:failed', treeId: trial.treeId, reason: 'respawn' }]
      : [];
    trial = null;
    return events;
  }

  return {
    arm,
    start,
    step,
    land,
    respawn,
    get trial() {
      return trial ? { ...trial } : null;
    },
  };
}
