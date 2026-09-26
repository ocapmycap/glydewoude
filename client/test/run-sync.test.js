/**
 * Posting a finished run to the server, exercised with a fake session and a
 * fake simulation event emitter.
 *
 * `run:ended` is the only event that ever posts. The sync only submits a run
 * that is bankable (T1's `isBankable`, chain >= RUN_TUNING.minChainToBank)
 * and that beats the best known so far — the server is the final word on
 * "improved", but there is no point spending a request on a run the client
 * already knows cannot win.
 */

import { describe, expect, it } from 'vitest';

import { RUN_TUNING, endRun, extendRun, startRun } from '@glidewood/shared';

import { createRunSync } from '../src/net/run-sync.js';

function fakeSession({ online = true, player = null } = {}) {
  const calls = [];
  return {
    online,
    player,
    calls,
    async request(path, options) {
      calls.push({ path, options });
      return { ok: true, status: 200, data: { best: null, improved: false }, error: null };
    },
  };
}

function fakeSimulation() {
  const listeners = [];
  return {
    listeners,
    on(listener) {
      listeners.push(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

/** A run whose chain reaches RUN_TUNING.minChainToBank, ended at `endedAt`. */
function bankableRun({ startedAt = 0, endedAt = 10, distance = 50 } = {}) {
  let run = startRun(startedAt);
  for (let i = 0; i < RUN_TUNING.minChainToBank; i += 1) {
    run = extendRun(run, { tree: { id: `t${i}` }, glide: { distance } });
  }
  return endRun(run, endedAt);
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('run sync', () => {
  it('posts a bankable run that beats the known best exactly once', async () => {
    const session = fakeSession({ player: { bestRun: { score: 0, chain: 0, distance: 0 } } });
    session.request = async (path, options) => {
      session.calls.push({ path, options });
      return {
        ok: true,
        status: 200,
        data: { best: { score: 9999, chain: 3, recordedAt: 'x' }, improved: true },
        error: null,
      };
    };
    const sync = createRunSync({ session, simulation: fakeSimulation() });

    const run = bankableRun({ startedAt: 2, endedAt: 6 });
    await sync.submit(run);

    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].path).toBe('/api/player/run');
    expect(session.calls[0].options.method).toBe('POST');
    expect(session.calls[0].options.body).toEqual({
      score: run.score,
      chain: run.chain,
      distance: run.distance,
      durationMs: (run.endedAt - run.startedAt) * 1000,
    });
  });

  it('hands the authoritative best back through onBest and sync.best', async () => {
    const session = fakeSession({ player: { bestRun: { score: 0, chain: 0, distance: 0 } } });
    const returnedBest = { score: 9999, chain: 3, recordedAt: 'x' };
    session.request = async (path, options) => {
      session.calls.push({ path, options });
      return { ok: true, status: 200, data: { best: returnedBest, improved: true }, error: null };
    };
    const sync = createRunSync({ session, simulation: fakeSimulation() });

    let heard = null;
    sync.onBest((best) => {
      heard = best;
    });

    await sync.submit(bankableRun());

    expect(heard).toEqual(returnedBest);
    expect(sync.best).toEqual(returnedBest);
  });

  it('submits automatically when the simulation emits run:ended, and ignores other events', async () => {
    const session = fakeSession({ player: null });
    const simulation = fakeSimulation();
    createRunSync({ session, simulation });

    const run = bankableRun();
    simulation.emit({ type: 'run:started', run: startRun(0) });
    simulation.emit({ type: 'run:extended', run, tree: { id: 't0' }, points: 10 });
    simulation.emit({ type: 'glide:landed', tree: { id: 't0' }, reason: 'perch', glide: {} });
    await flush();
    expect(session.calls).toHaveLength(0);

    simulation.emit({ type: 'run:ended', run, reason: 'ground' });
    await flush();

    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].path).toBe('/api/player/run');
  });

  it('never posts a run below minChainToBank', async () => {
    const session = fakeSession({ player: null });
    const sync = createRunSync({ session, simulation: fakeSimulation() });

    let run = startRun(0);
    run = extendRun(run, { tree: { id: 't0' }, glide: { distance: 100 } });
    run = endRun(run, 5); // chain === 1, below minChainToBank (2)

    await sync.submit(run);

    expect(session.calls).toHaveLength(0);
  });

  it('never posts a run that does not beat the known best', async () => {
    const sample = bankableRun({ distance: 50 });

    const equalSession = fakeSession({ player: { bestRun: { score: sample.score, chain: 5, distance: 500 } } });
    const equalSync = createRunSync({ session: equalSession, simulation: fakeSimulation() });
    await equalSync.submit(bankableRun({ distance: 50 }));
    expect(equalSession.calls).toHaveLength(0);

    const higherBestSession = fakeSession({
      player: { bestRun: { score: sample.score + 1, chain: 5, distance: 500 } },
    });
    const higherBestSync = createRunSync({ session: higherBestSession, simulation: fakeSimulation() });
    await higherBestSync.submit(bankableRun({ distance: 50 }));
    expect(higherBestSession.calls).toHaveLength(0);
  });

  it('does not post a later run once a returned best already beats it', async () => {
    const session = fakeSession({ player: { bestRun: { score: 0, chain: 0, distance: 0 } } });
    session.request = async (path, options) => {
      session.calls.push({ path, options });
      return {
        ok: true,
        status: 200,
        data: { best: { score: 1_000_000, chain: 20, recordedAt: 'x' }, improved: true },
        error: null,
      };
    };
    const sync = createRunSync({ session, simulation: fakeSimulation() });

    const first = bankableRun({ distance: 50 });
    await sync.submit(first);
    expect(session.calls).toHaveLength(1);

    const second = bankableRun({ distance: 10 });
    await sync.submit(second);

    // The client's own posted request already raised sync.best above what a
    // small later run could beat, so no second request goes out.
    expect(session.calls).toHaveLength(1);
  });

  it('does nothing while offline, and treats a null player as no known best', async () => {
    const offlineSession = fakeSession({ online: false, player: null });
    const offlineSync = createRunSync({ session: offlineSession, simulation: fakeSimulation() });
    await expect(offlineSync.submit(bankableRun())).resolves.not.toThrow();
    expect(offlineSession.calls).toHaveLength(0);

    const onlineSession = fakeSession({ online: true, player: null });
    const onlineSync = createRunSync({ session: onlineSession, simulation: fakeSimulation() });
    expect(onlineSync.best).toBeNull();

    await onlineSync.submit(bankableRun());
    expect(onlineSession.calls).toHaveLength(1);
  });

  it('leaves best unchanged and does not call the listener on a failed request', async () => {
    const session = fakeSession({ player: { bestRun: { score: 0, chain: 0, distance: 0 } } });
    session.request = async (path, options) => {
      session.calls.push({ path, options });
      return { ok: false, status: 500, data: null, error: 'server_error' };
    };
    const sync = createRunSync({ session, simulation: fakeSimulation() });

    let heard = false;
    sync.onBest(() => {
      heard = true;
    });

    const before = sync.best;
    await expect(sync.submit(bankableRun())).resolves.not.toThrow();

    expect(session.calls).toHaveLength(1);
    expect(sync.best).toEqual(before);
    expect(heard).toBe(false);
  });
});
