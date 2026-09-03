/**
 * Draining collection intents to the server.
 *
 * The collection ledger (sim/collection.js) deliberately never awards itself
 * materials: every pickup is an *intent* that sits in `pending` until a server
 * blesses it (product doc §6.1, D-17). This is the transport that does the
 * blessing — it drains those intents to `POST /api/collect` and writes the
 * server's authoritative verdict back with `settle()` / `reject()`.
 *
 * It owns no balance of its own and mutates nothing but the ledger through its
 * published methods, so it stays on the right side of the same boundary: the
 * server decides what is true, the client only relays and displays.
 *
 * Kept out of `sim/` because it speaks to the network; the ledger and session
 * are injected, so this runs headlessly under Vitest with fakes.
 */

/**
 * Which way a claim's HTTP status sends us. Classifying by status rather than
 * by reason string means a new server reason lands in the right bucket without
 * a code change here:
 *  - 200: the server credited it — settle.
 *  - 401 / 429 / no-response: transient (session hiccup, rate limit, offline).
 *    Keep the intent and try again on the next flush.
 *  - any other 4xx (malformed, unknown cache, already collected, not at cache,
 *    implausible travel): a permanent verdict on *this* claim — drop it. The
 *    cache stays claimed (D-19), so we never re-offer a rejected one.
 */
function verdictFor(status) {
  if (status === 200) return 'settle';
  if (status === 0 || status === 401 || status === 429) return 'retry';
  return 'reject';
}

/**
 * @param {object} deps
 * @param {{online:boolean, request:Function}} deps.session  from createSession()
 * @param {object} deps.collection  a collection ledger (sim/collection.js)
 */
export function createCollectionSync({ session, collection }) {
  // One drain at a time: a second landing mid-flush must not race the queue.
  // `again` remembers that new intents arrived so we re-run once we are done.
  let flushing = false;
  let again = false;

  async function drainOnce() {
    // A snapshot: settle()/reject() shrink the ledger's own pending list as we
    // go, and anything landed after this point is caught by the re-run.
    for (const intent of collection.pending) {
      const result = await session.request('/api/collect', {
        method: 'POST',
        body: { cacheId: intent.cacheId, position: intent.atPosition },
      });

      const verdict = verdictFor(result.status);
      if (verdict === 'settle') {
        // Replaces the confirmed total with the server's number — never adds.
        collection.settle([intent.seq], result.data?.materials);
      } else if (verdict === 'reject') {
        collection.reject([intent.seq]);
      } else {
        // Transient: stop here so the queue keeps its order and its place.
        return;
      }
    }
  }

  return {
    /**
     * Flush pending intents to the server. A no-op while offline — intents then
     * simply accumulate locally, exactly as they did before a server existed.
     * Safe to call on every collection event; overlapping calls coalesce.
     */
    async flush() {
      if (!session.online) return;
      if (flushing) {
        again = true;
        return;
      }
      flushing = true;
      try {
        await drainOnce();
      } finally {
        flushing = false;
      }
      if (again) {
        again = false;
        await this.flush();
      }
    },
  };
}
