/**
 * Scoring a run.
 *
 * A run is a chain of perch landings with no ground contact in between. It
 * starts on the first launch, extends on every tree that catches you, and ends
 * when you hit the ground. The rules for what that is worth live here.
 *
 * Why `shared/` and not `client/src/sim/`: CLAUDE.md's test is whether a server
 * would need it to check a client's claim. Today it would not — D-28 lets the
 * server store the score the client reports, because a run buys nothing. The
 * moment a run pays out materials that stops being true and §6.1 applies, so
 * the maths sits where a server can import it unchanged.
 *
 * Pure. No clock, no `Math.random`, and nothing here mutates the run it is
 * given — every function returns a new one, the way `stepGlide` does.
 */

import { RUN_TUNING } from './constants.js';

/**
 * @typedef {object} Run
 * @property {number} chain      landings so far
 * @property {number} score      integer points, see `extendRun`
 * @property {number} distance   metres flown across the whole chain
 * @property {string[]} treeIds  trees already used, for the freshness bonus
 * @property {number} startedAt  simulation time at the first launch (s)
 * @property {number|null} endedAt  simulation time of ground contact (s)
 */

/** Begin a run at simulation time `atTime`. */
export function startRun(atTime = 0) {
  return {
    chain: 0,
    score: 0,
    distance: 0,
    treeIds: [],
    startedAt: atTime,
    endedAt: null,
  };
}

/**
 * The multiplier a landing earns, given the chain already behind it.
 *
 * The first landing of a run is worth face value; each one after is worth more
 * per metre, up to a ceiling. Without the ceiling a patient player on a big
 * forest could ride one chain to an unreadable number, and a score nobody can
 * read is not a reward.
 */
export function runMultiplier(chain, tuning = RUN_TUNING) {
  return Math.min(1 + tuning.chainStep * chain, tuning.maxMultiplier);
}

/**
 * Extend a run with a perch landing.
 *
 * Points are `distance × multiplier × freshness`, rounded to an integer here
 * rather than at the edges. Rounding once, at the moment the points are
 * earned, means the score the HUD shows, the score posted to the server and
 * the score compared against a best are all the same number — there is no
 * float to drift between them.
 *
 * A run that has already ended is not extended; it comes back untouched, the
 * way `launch()` returns an airborne glider unchanged.
 *
 * @param {Run} run
 * @param {{tree: {id: string}, glide: {distance: number}}} landing
 * @param {object} [tuning]
 * @returns {Run}
 */
export function extendRun(run, { tree, glide }, tuning = RUN_TUNING) {
  if (run.endedAt !== null) return run;

  const distance = Math.max(0, glide?.distance ?? 0);
  const fresh = run.treeIds.includes(tree.id) ? 1 : tuning.freshBonus;
  const points = Math.round(distance * runMultiplier(run.chain, tuning) * fresh);

  return {
    ...run,
    chain: run.chain + 1,
    score: run.score + points,
    distance: run.distance + distance,
    treeIds: fresh === 1 ? run.treeIds : [...run.treeIds, tree.id],
  };
}

/** End a run at `atTime`. Ending an ended run is a no-op, not an error. */
export function endRun(run, atTime = 0) {
  if (run.endedAt !== null) return run;
  return { ...run, endedAt: atTime };
}

/**
 * Whether a finished run is worth showing or saving.
 *
 * One landing is just a glide, and every game begins with one. Treating that
 * as a run would put a "new best!" on the screen before the player has done
 * anything, so the threshold lives here and both the HUD and the sync ask.
 */
export function isBankable(run, tuning = RUN_TUNING) {
  return Boolean(run) && run.chain >= tuning.minChainToBank;
}
