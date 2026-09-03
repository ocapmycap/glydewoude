/**
 * The thing that drains the queues.
 *
 * `collection.settle()` and `shop.settle()` were written in Phase 2's earlier
 * sessions to be driven from outside, and this is the outside. It listens for
 * the intents the simulation raises, carries them to the server one at a time,
 * and feeds the verdict back — totals into the collection ledger, new tiers
 * into the physics.
 *
 * Three decisions are worth knowing before changing anything here.
 *
 * **One at a time, in order.** The server anchors a player's position on every
 * validated collection and bounds the next claim against it (D-27). Posting
 * two collections concurrently means they can be validated in either order,
 * and the pair that arrives backwards looks exactly like a teleport. A serial
 * queue costs a few hundred milliseconds of latency on a pickup nobody is
 * watching, and buys a check that does not fire on honest play.
 *
 * **Refusals are not failures.** A 4xx is the server doing its job: the cache
 * was already banked, the materials do not cover the tier. Those intents leave
 * the queue and the UI is told why. Only "we could not ask" — offline, a 5xx,
 * a rate limit — is retried, because only that might come out differently.
 *
 * **Position is saved on a timer, and it matters.** It is not there so other
 * players can see you; that is Phase 3. It is there because the anti-cheat
 * bound is distance-from-anchor over elapsed time, and a squirrel that glides
 * 200 metres without ever refreshing its anchor is indistinguishable from one
 * that jumped there. Saving as we fly keeps the anchor honest.
 *
 * No DOM and no Three.js, but this is not `sim/` — it is allowed to know the
 * server exists, and it is the only client module besides `main.js` that does.
 */

/** Statuses worth asking again about. Everything else is an answer. */
function isRetryable(status) {
  // 0 is our own offline marker; 429 will pass once the window rolls over.
  return status === 0 || status === 429 || status >= 500;
}

const BACKOFF_MS = Object.freeze([500, 1500, 4000, 10000, 30000]);

/**
 * @param {object} options
 * @param {object} options.api         from createApiClient()
 * @param {object} options.simulation  from createSimulation()
 * @param {object} [options.session]   from createSession(); kept in step with server state
 * @param {number} [options.positionIntervalSeconds]  how often to re-anchor
 * @param {Function} [options.delay]   ms => Promise, injected so tests do not wait
 */
export function createSync({
  api,
  simulation,
  session = null,
  positionIntervalSeconds = 4,
  delay = (ms) => new Promise((resolve) => globalThis.setTimeout(resolve, ms)),
} = {}) {
  /** @type {Array<{kind: string, seq?: number, payload: object}>} */
  const queue = [];
  const listeners = new Set();
  const emit = (event) => listeners.forEach((listener) => listener(event));

  let draining = false;
  let failures = 0;
  let online = api.isAuthenticated;
  let stopped = false;
  let sincePosition = 0;
  /** The latest position waiting to be sent, replaced rather than queued. */
  let pendingPosition = null;
  /** Resolvers waiting for the queue to empty. See idle(). */
  let idleWaiters = [];

  function setOnline(next) {
    if (online === next) return;
    online = next;
    emit({ type: next ? 'net:online' : 'net:offline' });
  }

  /** One place where server player state lands, so nothing holds a stale copy. */
  function adoptPlayer(player) {
    if (!player) return;
    session?.adopt(player);
    if (player.glideStats) simulation.applyStats(player.glideStats);
    emit({ type: 'net:player', player });
  }

  const unsubscribe = simulation.on((event) => {
    if (event.type === 'material:collected') {
      enqueue({ kind: 'collect', seq: event.intent.seq, payload: event.intent });
    }
    if (event.type === 'shop:purchase-requested') {
      enqueue({ kind: 'purchase', seq: event.intent.seq, payload: event.intent });
    }
    if (event.type === 'shop:opened') {
      // The catalogue carries the player's own next price, so it is fetched at
      // the counter rather than cached — a tier bought two shops ago has to be
      // reflected here or the panel offers something already owned.
      enqueue({ kind: 'catalog', payload: { tree: event.tree } });
    }
  });

  function enqueue(entry) {
    queue.push(entry);
    void drain();
  }

  async function drain() {
    if (draining || stopped) return;
    draining = true;

    try {
      while (queue.length > 0 || pendingPosition) {
        if (stopped) return;
        // Position goes first: it re-anchors us, which is what makes the
        // collection queued behind it survive the plausibility check.
        const entry = pendingPosition
          ? { kind: 'position', payload: takePendingPosition() }
          : queue[0];

        const result = await send(entry);

        if (result === 'retry') {
          setOnline(false);
          const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
          failures += 1;
          await delay(wait);
          continue;
        }

        setOnline(true);
        failures = 0;
        if (entry.kind !== 'position') queue.shift();
      }
    } finally {
      draining = false;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  function takePendingPosition() {
    const position = pendingPosition;
    pendingPosition = null;
    return position;
  }

  /** @returns {Promise<'done'|'retry'>} */
  async function send(entry) {
    if (entry.kind === 'position') {
      const result = await api.savePosition(entry.payload);
      // A refused position save is not worth retrying or reporting: the next
      // tick produces a fresher one, and re-sending a stale anchor is worse
      // than skipping it.
      return result.ok || !isRetryable(result.status) ? 'done' : 'retry';
    }

    if (entry.kind === 'catalog') {
      const result = await api.catalog();
      if (result.ok) {
        emit({ type: 'net:catalog', upgrades: result.data.upgrades, tree: entry.payload.tree });
        return 'done';
      }
      // Nothing to settle — a missing catalogue leaves the panel saying so.
      if (isRetryable(result.status)) return 'retry';
      emit({ type: 'net:catalog-failed', error: result.error });
      return 'done';
    }

    if (entry.kind === 'collect') {
      const intent = entry.payload;
      const result = await api.collect({
        cacheId: intent.cacheId,
        position: intent.atPosition,
      });

      if (result.ok) {
        simulation.collection.settle([intent.seq], result.data.materials);
        adoptPlayer(result.data.player);
        emit({ type: 'net:collected', intent, credited: result.data.credited });
        return 'done';
      }
      if (isRetryable(result.status)) return 'retry';

      // The server said no and meant it. The cache stays claimed locally — see
      // collection.reject(), which exists so a refusal cannot become a retry
      // loop over the same acorn.
      simulation.collection.reject([intent.seq]);
      emit({ type: 'net:collect-refused', intent, error: result.error, detail: result.detail });
      return 'done';
    }

    if (entry.kind === 'purchase') {
      const intent = entry.payload;
      const result = await api.purchase(intent.upgradeKey);

      if (result.ok) {
        simulation.shop.settle([intent.seq]);
        adoptPlayer(result.data.player);
        emit({ type: 'net:purchased', intent, purchased: result.data.purchased });
        // The player can afford less than they could a moment ago, so the
        // prices on screen are stale the instant this succeeds.
        if (simulation.shop.isOpen) {
          queue.push({ kind: 'catalog', payload: { tree: simulation.shop.openTree } });
        }
        return 'done';
      }
      if (isRetryable(result.status)) return 'retry';

      // Accepted or refused, a purchase intent leaves the queue the same way —
      // nothing local was spent, so there is nothing to roll back.
      simulation.shop.settle([intent.seq]);
      emit({
        type: 'net:purchase-refused',
        intent,
        error: result.error,
        missing: result.detail,
      });
      return 'done';
    }

    return 'done';
  }

  return {
    /** Subscribe to network events; returns an unsubscribe function. */
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    get isOnline() {
      return online;
    },

    /** Work still unanswered, so the HUD can be honest about it. */
    get inFlight() {
      return queue.length;
    },

    /**
     * Resolves once the queue has drained.
     *
     * Sending is fire-and-forget by design — nothing in the game loop should
     * ever wait on the network — so this is the seam for the things that do
     * need to wait: a test asserting on what the server was told, and, later,
     * a last flush before the tab closes.
     */
    idle() {
      if (!draining && queue.length === 0 && !pendingPosition) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },

    /**
     * Advance the position timer. Driven from the simulation loop with the
     * fixed timestep, so it counts game seconds rather than wall-clock ones
     * and a backgrounded tab does not queue a hundred saves.
     */
    tick(dt) {
      sincePosition += dt;
      if (sincePosition < positionIntervalSeconds) return;
      sincePosition = 0;
      if (!api.isAuthenticated) return;

      const { motion } = simulation.glider;
      pendingPosition = { x: motion.x, y: motion.y, z: motion.z };
      void drain();
    },

    /** Pull the current player from the server, e.g. right after sign-in. */
    async refresh() {
      const result = await api.me();
      if (!result.ok) {
        if (isRetryable(result.status)) setOnline(false);
        return null;
      }
      setOnline(true);
      adoptPlayer(result.data.player);
      return result.data.player;
    },

    /** Ask for the catalogue without waiting to land on a shop. */
    requestCatalog(tree = null) {
      enqueue({ kind: 'catalog', payload: { tree } });
    },

    stop() {
      stopped = true;
      unsubscribe();
      listeners.clear();
    },
  };
}
