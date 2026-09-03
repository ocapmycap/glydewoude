/**
 * A `fetch` that answers like the real server, for tests only.
 *
 * Not a mock of the API client — a stand-in for the network under it, so the
 * tests exercise the real request building, the real status handling and the
 * real JSON parsing. That is the same discipline as the autopilot: drive the
 * shipped code, do not reimplement it.
 *
 * Routes are keyed `'METHOD /path'` and return `[status, body]`. A route may
 * be a function, so a test can answer differently on the second call.
 */

export function createFakeFetch(routes = {}) {
  /** @type {Array<{method: string, path: string, body: object|null, token: string|null}>} */
  const calls = [];

  async function fetchImpl(url, options = {}) {
    const method = options.method ?? 'GET';
    // The client builds absolute URLs when given a base; strip it back off.
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const token = (options.headers?.authorization ?? '').replace(/^Bearer /, '') || null;
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ method, path, body, token });

    const route = routes[`${method} ${path}`] ?? routes[`${method} ${path.split('?')[0]}`];
    if (!route) throw new TypeError('fetch failed');

    const [status, payload] = typeof route === 'function'
      ? await route({ body, token, calls })
      : route;

    if (status === 'network-error') throw new TypeError('fetch failed');

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (payload === 'not-json') throw new SyntaxError('Unexpected token');
        return payload;
      },
    };
  }

  fetchImpl.calls = calls;
  fetchImpl.pathsCalled = () => calls.map((call) => `${call.method} ${call.path}`);
  return fetchImpl;
}

/** A player as `publicPlayer()` shapes it, with sensible defaults. */
export function fakePlayer(overrides = {}) {
  return {
    id: 'player-1',
    displayName: 'Quicktail 101',
    worldSeed: 'glidewood-phase-1',
    glideStats: { distance: 0, agility: 0, flapCharges: 0, fallControl: 0 },
    materials: { acorns: 0, bark: 0, silk: 0, berries: 0 },
    currencySoft: 0,
    currencyHard: 0,
    inventoryCosmetics: [],
    equippedCosmetics: {},
    lastPosition: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A localStorage-shaped object backed by a Map. */
export function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() {
      return map.size;
    },
  };
}
