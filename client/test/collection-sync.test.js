/**
 * The collection sync, exercised against a real ledger and a fake server.
 *
 * The invariants that matter: a credited claim settles and leaves the queue
 * empty; a permanently-rejected claim is dropped (and, per D-19, its cache is
 * never re-offered); a transient failure keeps the intent for a retry; and
 * offline play never touches the network. `settle()` replacing rather than
 * adding is the §6.1 rule this whole path exists to keep.
 */

import { describe, expect, it } from 'vitest';
import { MATERIAL_TYPES } from '@glidewood/shared';

import { createCollectionLedger } from '../src/sim/collection.js';
import { createCollectionSync } from '../src/net/collection-sync.js';

const caches = [
  {
    id: 'cache-a',
    treeId: 'tree-a',
    material: MATERIAL_TYPES.ACORNS,
    amount: 3,
    effort: 0.4,
    position: { x: 1, y: 2, z: 3 },
  },
  {
    id: 'cache-b',
    treeId: 'tree-b',
    material: MATERIAL_TYPES.ACORNS,
    amount: 2,
    effort: 0.6,
    position: { x: 4, y: 5, z: 6 },
  },
];

/** A session stand-in that hands back scripted responses and records calls. */
function fakeSession({ online = true, responses = [] } = {}) {
  const calls = [];
  let i = 0;
  return {
    online,
    calls,
    async request(path, options) {
      calls.push({ path, body: options.body });
      const response = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return response;
    },
  };
}

const ok = (materials) => ({ ok: true, status: 200, data: { materials }, error: null });
const fail = (status, error) => ({ ok: false, status, data: { error }, error });

describe('collection sync', () => {
  it('settles a credited claim and clears it from pending', async () => {
    const ledger = createCollectionLedger({ caches });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    const session = fakeSession({ responses: [ok({ acorns: 3 })] });

    await createCollectionSync({ session, collection: ledger }).flush();

    expect(ledger.pending).toHaveLength(0);
    expect(ledger.confirmed.acorns).toBe(3);
    expect(session.calls[0].path).toBe('/api/collect');
    expect(session.calls[0].body).toEqual({ cacheId: 'cache-a', position: { x: 1, y: 2, z: 3 } });
  });

  it('replaces the confirmed total rather than adding to it', async () => {
    const ledger = createCollectionLedger({ caches });
    // Pretend the server already banked 10 from a previous session.
    ledger.settle([], { acorns: 10 });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    // The server returns the authoritative running total, not just the delta.
    const session = fakeSession({ responses: [ok({ acorns: 13 })] });

    await createCollectionSync({ session, collection: ledger }).flush();

    expect(ledger.confirmed.acorns).toBe(13);
  });

  it('drops a permanently-rejected claim without crediting it', async () => {
    const ledger = createCollectionLedger({ caches });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    const session = fakeSession({ responses: [fail(409, 'already_collected')] });

    await createCollectionSync({ session, collection: ledger }).flush();

    expect(ledger.pending).toHaveLength(0);
    expect(ledger.confirmed.acorns).toBe(0);
    // Rejected caches stay claimed, so nothing re-offers this one.
    expect(ledger.hasClaimed('cache-a')).toBe(true);
  });

  it('keeps an intent pending when the request fails transiently', async () => {
    const ledger = createCollectionLedger({ caches });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    const session = fakeSession({ responses: [fail(0, 'network_error')] });

    const sync = createCollectionSync({ session, collection: ledger });
    await sync.flush();

    expect(ledger.pending).toHaveLength(1);
    expect(ledger.confirmed.acorns).toBe(0);

    // A later flush, once the server is back, settles the same intent.
    session.calls.length = 0;
    Object.assign(session, fakeSession({ responses: [ok({ acorns: 3 })] }));
    await sync.flush();
    expect(ledger.pending).toHaveLength(0);
    expect(ledger.confirmed.acorns).toBe(3);
  });

  it('stops at the first transient failure and preserves queue order', async () => {
    const ledger = createCollectionLedger({ caches });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    ledger.collectAt({ id: 'tree-b' }, { atTime: 2 });
    // First settles, second hits a rate limit: the second must stay pending.
    const session = fakeSession({ responses: [ok({ acorns: 3 }), fail(429, 'rate_limited')] });

    await createCollectionSync({ session, collection: ledger }).flush();

    expect(ledger.pending.map((i) => i.cacheId)).toEqual(['cache-b']);
    expect(session.calls.map((c) => c.body.cacheId)).toEqual(['cache-a', 'cache-b']);
  });

  it('does nothing while offline', async () => {
    const ledger = createCollectionLedger({ caches });
    ledger.collectAt({ id: 'tree-a' }, { atTime: 1 });
    const session = fakeSession({ online: false, responses: [ok({ acorns: 3 })] });

    await createCollectionSync({ session, collection: ledger }).flush();

    expect(session.calls).toHaveLength(0);
    expect(ledger.pending).toHaveLength(1);
  });
});
