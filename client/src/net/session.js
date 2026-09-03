/**
 * Who the player is, across reloads.
 *
 * A session is one saved token. On a first visit there is none, so we register
 * and keep what comes back; on every visit after, the stored token is offered
 * to `/api/player/me` and the player picks up where they left off. That round
 * trip is the whole of "persists across sessions" — everything else in Phase 2
 * hangs off having a player id the server recognises.
 *
 * Registration is anonymous and automatic (D-24: no password, no email — the
 * product doc's "keep account scope minimal" until there are real cosmetics to
 * protect). A name is generated rather than asked for, because a modal
 * standing between a new player and the first glide is a worse trade than a
 * name they can change later.
 *
 * `storage` is injected for the same reason `fetch` is: these tests run in
 * Node, where `localStorage` does not exist.
 */

/** The key the token lives under. Namespaced so it survives sharing an origin. */
export const TOKEN_KEY = 'glidewood.session.token';

const NAME_FIRST = ['Quick', 'Bramble', 'Hazel', 'Sorrel', 'Rowan', 'Pipp', 'Fen', 'Juniper'];
const NAME_LAST = ['tail', 'paw', 'leaf', 'bark', 'wing', 'drift', 'bough', 'nut'];

/**
 * A display name that satisfies the server's rules without asking anyone.
 *
 * Takes its randomness as a parameter so a test can pin it — nothing under
 * `net/` reaches for `Math.random()` any more than `sim/` does, though here it
 * is for testability rather than the determinism `shared/` needs.
 */
export function generateDisplayName(random = Math.random) {
  const first = NAME_FIRST[Math.floor(random() * NAME_FIRST.length)];
  const last = NAME_LAST[Math.floor(random() * NAME_LAST.length)];
  const suffix = String(Math.floor(random() * 900) + 100);
  return `${first}${last} ${suffix}`;
}

/** A storage that forgets everything, so a missing `localStorage` is not fatal. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

/**
 * @param {object} options
 * @param {object} options.api        from createApiClient()
 * @param {object} [options.storage]  localStorage-shaped; in-memory if omitted
 * @param {Function} [options.random] injected for deterministic names in tests
 */
export function createSession({ api, storage = memoryStorage(), random = Math.random } = {}) {
  // A browser with storage disabled throws on access rather than returning
  // null, and losing the save is better than losing the game.
  const store = safeStorage(storage);
  let player = null;

  async function register() {
    const result = await api.register(generateDisplayName(random));
    if (!result.ok) return { ok: false, reason: result.error, status: result.status };

    api.setToken(result.data.token);
    store.setItem(TOKEN_KEY, result.data.token);
    player = result.data.player;
    return { ok: true, player, resumed: false };
  }

  return {
    /** The last player state the server sent, or null while offline. */
    get player() {
      return player;
    },

    get isSignedIn() {
      return player !== null;
    },

    /**
     * Restore a session, or make one.
     *
     * @returns {Promise<{ok: true, player: object, resumed: boolean}
     *                  |{ok: false, reason: string, status: number}>}
     *   `resumed` is true when a stored token was still good — the difference
     *   between "welcome back" and "welcome", which the hint text uses.
     */
    async start() {
      const stored = store.getItem(TOKEN_KEY);
      if (!stored) return register();

      api.setToken(stored);
      const result = await api.me();
      if (result.ok) {
        player = result.data.player;
        return { ok: true, player, resumed: true };
      }

      // A rejected token is spent — expired, revoked, or from a database that
      // has been reset in development. Registering again is the only way back,
      // and it is what a player would want. Any other failure (offline, a 500)
      // leaves the token alone, because it may well work in a minute.
      if (result.status === 401) {
        store.removeItem(TOKEN_KEY);
        api.setToken(null);
        return register();
      }
      return { ok: false, reason: result.error, status: result.status };
    },

    /** Adopt server state fetched elsewhere, so there is one copy of the player. */
    adopt(next) {
      if (next) player = next;
      return player;
    },

    async signOut() {
      if (api.isAuthenticated) await api.logout();
      store.removeItem(TOKEN_KEY);
      api.setToken(null);
      player = null;
    },
  };
}

function safeStorage(storage) {
  return {
    getItem(key) {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        storage.setItem(key, value);
      } catch {
        // Private browsing, a full quota, storage switched off. The session
        // still works for this tab; it just will not outlive it.
      }
    },
    removeItem(key) {
      try {
        storage.removeItem(key);
      } catch {
        // As above.
      }
    },
  };
}
