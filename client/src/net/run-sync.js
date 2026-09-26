/**
 * Posting a finished run to the server.
 *
 * The best run only survives a reload if the server has it — the client's
 * own copy lives in memory and is gone the moment the tab closes. So every
 * `run:ended` is a chance to bank a new record, and the server's reply is the
 * one written back into `best`: it alone decides "improved" (`WHERE
 * best_run_score < $2` in T2's route), and a replayed or racing submission
 * can never lower what it already holds.
 *
 * Offline is not an error — the session is optional by design
 * (`client/src/net/session.js`) and run mode must work with no server at
 * all. A run below `minChainToBank`, or one that cannot beat the best this
 * client already knows about, is skipped locally too: the server would
 * reject or ignore it anyway, so there is no point spending the request.
 *
 * Best-effort and unretried, same as `position-sync.js`: a dropped submit
 * just means this run's score never overtakes the last one that made it
 * through.
 */

import { isBankable } from '@glidewood/shared';

/**
 * @param {object} deps
 * @param {{online:boolean, player:?object, request:Function}} deps.session  from createSession()
 * @param {{on:Function}} deps.simulation  from createSimulation()
 */
export function createRunSync({ session, simulation }) {
  let best = session.player?.bestRun ?? null;
  const listeners = [];

  async function submit(run) {
    if (!session.online) return;
    if (!isBankable(run)) return;
    if (best && run.score <= best.score) return;

    const result = await session.request('/api/player/run', {
      method: 'POST',
      body: {
        score: run.score,
        chain: run.chain,
        distance: run.distance,
        durationMs: Math.round((run.endedAt - run.startedAt) * 1000),
      },
    });

    // A failed request, or a reply without a best, leaves the known best alone.
    if (!result.ok || !result.data?.best) return;

    best = result.data.best;
    for (const listener of listeners) listener(best);
  }

  simulation.on((event) => {
    if (event.type === 'run:ended') submit(event.run);
  });

  return {
    get best() {
      return best;
    },
    onBest(listener) {
      listeners.push(listener);
    },
    submit,
  };
}
