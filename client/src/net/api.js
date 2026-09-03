/**
 * The eight endpoints, as functions.
 *
 * This is the only module in the client that knows an HTTP server exists.
 * `sim/` never sees it — CLAUDE.md's dependency diagram has three arms out of
 * `main.js` and this is a fourth peer alongside them (D-29), owned by `main.js`
 * and handed to whatever needs it, exactly as the clock already is.
 *
 * Two rules shape everything here:
 *
 * **`fetch` is injected.** Defaulted to the browser's, but a parameter, so the
 * tests drive this in plain Node with a hand-written stub and no server, the
 * same way `createLoop` takes its own clock.
 *
 * **Nothing throws.** A call returns `{ok: true, data}` or `{ok: false, error,
 * status}`, because every caller has to handle refusal anyway: a purchase can
 * come back `insufficient_materials` and a collection `implausible_travel`,
 * and those are ordinary answers rather than exceptions. A dropped connection
 * arrives the same way, as `error: 'offline'` with status 0, so the calling
 * code has one shape to deal with instead of two.
 */

/** Reasons the server never sends, raised here instead. */
export const CLIENT_ERRORS = Object.freeze({
  OFFLINE: 'offline',
  MALFORMED_RESPONSE: 'malformed_response',
});

/**
 * @param {object} [options]
 * @param {string} [options.baseUrl]  origin of the API, '' for a same-origin proxy
 * @param {Function} [options.fetch]  injected for testability
 * @param {string|null} [options.token]  a session token to start with
 * @param {number} [options.timeoutMs]  abort a request that goes quiet
 */
export function createApiClient({
  baseUrl = '',
  fetch: fetchImpl = globalThis.fetch,
  token = null,
  timeoutMs = 8000,
} = {}) {
  // Trailing slashes would produce '//api/...', which some proxies treat as a
  // different path than the one the router registered.
  const origin = baseUrl.replace(/\/+$/, '');
  let sessionToken = token;

  async function request(method, path, body) {
    const headers = { accept: 'application/json' };
    if (sessionToken) headers.authorization = `Bearer ${sessionToken}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // A refused connection fails at once, but a host that accepts the
        // socket and then says nothing would hang forever. Aborting is what
        // lets the caller treat a silent server as offline and move on —
        // and, unlike racing a timer, it actually cancels the request, so
        // there is no late success arriving after we gave up on it.
        signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch {
      // No server, no network, CORS refusal — indistinguishable from here, and
      // the caller's response to all three is the same: carry on without it.
      return { ok: false, error: CLIENT_ERRORS.OFFLINE, status: 0 };
    }

    // 204 has no body to parse; every other response should be JSON, and one
    // that is not means we are talking to something that is not our server.
    let payload = {};
    if (response.status !== 204) {
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          error: CLIENT_ERRORS.MALFORMED_RESPONSE,
          status: response.status,
        };
      }
    }

    if (!response.ok) {
      return {
        ok: false,
        error: payload?.error ?? 'request_failed',
        status: response.status,
        detail: payload?.detail,
      };
    }
    return { ok: true, data: payload, status: response.status };
  }

  return {
    /** The token in use, or null. `main.js` persists this; we only hold it. */
    get token() {
      return sessionToken;
    },

    setToken(next) {
      sessionToken = next ?? null;
    },

    get isAuthenticated() {
      return sessionToken !== null;
    },

    register(displayName) {
      return request('POST', '/api/auth/register', { displayName });
    },

    logout() {
      return request('POST', '/api/auth/logout');
    },

    me() {
      return request('GET', '/api/player/me');
    },

    savePosition(position) {
      return request('POST', '/api/player/position', { position });
    },

    catalog() {
      return request('GET', '/api/shop/catalog');
    },

    /**
     * Bank a collection intent. Only the cache and where we claim to have been
     * go up — the amount is the server's to decide from its own copy of the
     * world (§6.1), and sending ours would just be a number to be edited.
     */
    collect({ cacheId, position }) {
      return request('POST', '/api/collect', { cacheId, position });
    },

    /** Buy the next tier. No price is sent; the server owns it (D-25). */
    purchase(upgradeKey) {
      return request('POST', '/api/shop/purchase', { upgrade: upgradeKey });
    },

    transactions(limit = 50) {
      return request('GET', `/api/player/transactions?limit=${limit}`);
    },

    /** Cheap liveness check, used to decide whether to bother with a session. */
    health() {
      return request('GET', '/healthz');
    },
  };
}
