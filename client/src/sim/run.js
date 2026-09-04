/**
 * The run in progress.
 *
 * A run is a chain of perch landings with no ground contact in between. This
 * module owns *when* one starts, extends and ends; it owns none of the
 * arithmetic. Every number comes from `shared/src/run.js`, which is where a
 * server could one day import it from (D-28).
 *
 * The tracker returns event objects rather than emitting them, the same way
 * `createCollectionLedger.collectAt` returns an intent for its caller to emit.
 * That keeps every `emit` call in `simulation.js`, so the order a subscriber
 * sees events in is readable in one file instead of two.
 *
 * Pure JS: no Three.js, no DOM, no clock. Simulation time arrives as an
 * argument, so a replay produces identical runs.
 */

import { RUN_TUNING, endRun, extendRun, startRun } from '@glidewood/shared';

/**
 * @typedef {object} RunEvent
 * @property {'run:started'|'run:extended'|'run:ended'} type
 * @property {object} run       the full run object from shared/src/run.js
 * @property {object} [tree]    the tree just caught, on `run:extended`
 * @property {number} [points]  points this landing added, on `run:extended`
 * @property {'ground'|'respawn'} [reason]  why it stopped, on `run:ended`
 */

/**
 * @param {object} [options]
 * @param {object} [options.tuning]  a mutable copy of RUN_TUNING
 */
export function createRunTracker({ tuning = RUN_TUNING } = {}) {
  /** The run in progress, or null when perched with no chain going. */
  let current = null;

  return {
    get run() {
      return current;
    },

    /**
     * Begin a run, if one is not already going.
     *
     * Launching mid-chain is the ordinary case — you land, you leave again —
     * so a launch with a run already open is not an error and raises no event.
     *
     * @returns {RunEvent|null}
     */
    start(atTime) {
      if (current) return null;
      current = startRun(atTime);
      return { type: 'run:started', run: current };
    },

    /**
     * Score a perch landing.
     *
     * `points` is reported as the difference the landing made rather than
     * recomputed here, so the HUD can never disagree with the running total.
     *
     * @returns {RunEvent|null} null when nothing is in progress
     */
    extend(tree, glide) {
      if (!current) return null;
      const before = current.score;
      current = extendRun(current, { tree, glide }, tuning);
      return { type: 'run:extended', run: current, tree, points: current.score - before };
    },

    /**
     * Stop the run. `reason` is `'ground'` for a fall and `'respawn'` for the
     * player asking to go home — the HUD treats the two differently, and only
     * one of them is a finish worth celebrating.
     *
     * A run shorter than `minChainToBank` still ends here and still raises the
     * event; deciding it is not worth showing or saving is `isBankable`'s job,
     * not this module's.
     *
     * @returns {RunEvent|null} null when nothing was in progress
     */
    end(atTime, reason) {
      if (!current) return null;
      const run = endRun(current, atTime);
      current = null;
      return { type: 'run:ended', run, reason };
    },
  };
}
