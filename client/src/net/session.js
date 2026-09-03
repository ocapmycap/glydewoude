/**
 * The client's session with the Phase 2 server.
 *
 * This is the seam product doc §6.1 has been waiting for: the client holds a
 * token, the server holds the truth. Everything that later needs to talk to
 * the server — draining collection intents, saving position, buying upgrades —
 * goes through the authed `request()` this module hands back, so there is one
 * place that knows the base URL, attaches the bearer token, and parses a reply.
 *
 * Why it lives in `net/` and not `sim/` or `shared/`: it uses `fetch` and
 * `localStorage`, both browser globals, which CLAUDE.md's core rule bars from
 * the pure layers. Those two, plus the base URL, are injected so the whole
 * thing runs headlessly under Vitest with fakes — the same discipline the
 * simulation uses for its clock.
 *
 * The server is optional on purpose. If it is unreachable the game still runs,
 * unpersisted, exactly as it did before this module existed: `online` is false
 * and `player` is null. That keeps "clone and it runs" true (D-9 territory) and
 * means a teammate working on the renderer does not need a database up.
 */

const DEFAULT_BASE_URL = 'http://localhost:8787';
const TOKEN_KEY = 'glidewood.token';

/** A default name that satisfies the server's DISPLAY_NAME rule (auth.js). */
function defaultDisplayName() {
  // Letters, digits and a space are all inside the server's allowed set, so an
  // auto-registered player never bounces on validation.
  return `Glider ${Math.floor(1000 + Math.random() * 9000)}`;
}

/** localStorage throws in some privacy modes; a missing token is not fatal. */
function readToken(storage) {
  try {
    return storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeToken(storage, token) {
  try {
    storage?.setItem(TOKEN_KEY, token);
  } catch {
    // A session that cannot be persisted still works for this run; it just
    // registers fresh next time. Better than refusing to start.
  }
}

function clearToken(storage) {
  try {
    storage?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do — the token is already unusable if we got here.
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {object} [deps]
 * @param {string} [deps.baseUrl]      server origin; injected from Vite env in main.js
 * @param {typeof fetch} [deps.fetch]  the transport; a fake in tests
 * @param {Storage} [deps.storage]     where the token lives; a fake in tests
 * @param {string} [deps.displayName]  name to register with; a default is generated
 */
export function createSession({
  baseUrl = DEFAULT_BASE_URL,
  fetch = globalThis.fetch,
  storage = globalThis.localStorage,
  displayName,
} = {}) {
  let token = readToken(storage);
  let player = null;
  let online = false;

  /**
   * One low-level call. Returns a verdict rather than throwing, so callers read
   * like the server's own `{ ok, reason }` handlers. A network failure and an
   * HTTP error are both `ok: false`; `status` is 0 only when the request never
   * reached the server.
   */
  async function call(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && token) headers.authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Server down, offline, CORS refusal — indistinguishable here and all
      // handled the same way: we simply have no session.
      return { ok: false, status: 0, data: null, error: 'network_error' };
    }

    const data = parseJson(await response.text());
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : data?.error ?? 'request_failed',
    };
  }

  async function register() {
    const result = await call('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: { displayName: displayName ?? defaultDisplayName() },
    });
    if (!result.ok || !result.data?.token) return result;

    token = result.data.token;
    writeToken(storage, token);
    player = result.data.player ?? null;
    online = true;
    return result;
  }

  return {
    get player() {
      return player;
    },
    get token() {
      return token;
    },
    /** True once we hold a live session; false means run locally, unpersisted. */
    get online() {
      return online;
    },

    /**
     * Establish the session: restore the stored token if it still resolves to a
     * player, otherwise register a fresh one. Idempotent enough to call once at
     * boot. Never throws — an unreachable server leaves us offline, not broken.
     *
     * @returns {Promise<{online:boolean, player:object|null, reason?:string}>}
     */
    async connect() {
      if (token) {
        const me = await call('/api/player/me');
        if (me.ok && me.data?.player) {
          player = me.data.player;
          online = true;
          return { online, player };
        }
        // A 401 (or a 404 unknown_player) means the token is dead — drop it and
        // start over. A network error leaves the token in place to retry later.
        if (me.status === 401 || me.status === 404) {
          clearToken(storage);
          token = null;
        } else if (me.status === 0) {
          return { online: false, player: null, reason: 'network_error' };
        }
      }

      const registered = await register();
      if (registered.ok) return { online, player };
      return { online: false, player: null, reason: registered.error };
    },

    /**
     * The authed request helper the rest of the client builds on (collect,
     * position, shop). Refuses cleanly when there is no session rather than
     * firing an unauthenticated call the server would only reject.
     *
     * @returns {Promise<{ok:boolean, status:number, data:any, error:string|null}>}
     */
    async request(path, options = {}) {
      if (!online || !token) {
        return { ok: false, status: 0, data: null, error: 'offline' };
      }
      return call(path, options);
    },

    /** Revoke the session server-side and forget the token. */
    async logout() {
      if (token) await call('/api/auth/logout', { method: 'POST' });
      clearToken(storage);
      token = null;
      player = null;
      online = false;
    },
  };
}
