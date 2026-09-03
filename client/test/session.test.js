/**
 * The client session, exercised headlessly with a fake transport and storage.
 *
 * The behaviours that matter here are the ones item 2 and beyond depend on: a
 * fresh player is registered and its token persisted; an existing token is
 * restored without re-registering; a dead token is thrown away and replaced;
 * and an unreachable server leaves the game offline rather than broken.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSession } from '../src/net/session.js';

/** A localStorage stand-in — the real one is a browser global. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    _map: map,
  };
}

/** A JSON Response good enough for the session's needs. */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const PLAYER = {
  id: 'p-1',
  displayName: 'Glider 4242',
  worldSeed: 7,
  glideStats: { distance: 0, agility: 0, flapCharges: 0, fallControl: 0 },
  materials: {},
};

describe('client session', () => {
  let storage;

  beforeEach(() => {
    storage = fakeStorage();
  });

  it('registers a fresh player and persists the token', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(201, { token: 'tok-abc', player: PLAYER }),
    );
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });

    const result = await session.connect();

    expect(result.online).toBe(true);
    expect(result.player).toEqual(PLAYER);
    expect(session.online).toBe(true);
    expect(session.token).toBe('tok-abc');
    expect(storage.getItem('glidewood.token')).toBe('tok-abc');

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api.test/api/auth/register');
    expect(init.method).toBe('POST');
    // Registration must not carry a stale Authorization header.
    expect(init.headers.authorization).toBeUndefined();
    expect(JSON.parse(init.body).displayName).toMatch(/^[\p{L}\p{N} '_-]{1,40}$/u);
  });

  it('restores an existing token via /me without re-registering', async () => {
    storage.setItem('glidewood.token', 'stored-tok');
    const fetch = vi.fn(async () => jsonResponse(200, { player: PLAYER }));
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });

    const result = await session.connect();

    expect(result.online).toBe(true);
    expect(result.player).toEqual(PLAYER);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://api.test/api/player/me');
    expect(init.headers.authorization).toBe('Bearer stored-tok');
  });

  it('discards a dead token and registers a new one', async () => {
    storage.setItem('glidewood.token', 'dead-tok');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: 'unauthorized' }))
      .mockResolvedValueOnce(jsonResponse(201, { token: 'fresh-tok', player: PLAYER }));
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });

    const result = await session.connect();

    expect(result.online).toBe(true);
    expect(session.token).toBe('fresh-tok');
    expect(storage.getItem('glidewood.token')).toBe('fresh-tok');
    expect(fetch.mock.calls[0][0]).toBe('http://api.test/api/player/me');
    expect(fetch.mock.calls[1][0]).toBe('http://api.test/api/auth/register');
  });

  it('falls back to offline when the server is unreachable', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });

    const result = await session.connect();

    expect(result.online).toBe(false);
    expect(result.player).toBeNull();
    expect(session.online).toBe(false);
    expect(session.player).toBeNull();
  });

  it('keeps a stored token when /me fails on a network error', async () => {
    storage.setItem('glidewood.token', 'stored-tok');
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });

    const result = await session.connect();

    expect(result.online).toBe(false);
    // A flaky network must not cost the player their session.
    expect(storage.getItem('glidewood.token')).toBe('stored-tok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses an authed request while offline instead of firing it', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });
    await session.connect();

    const before = fetch.mock.calls.length;
    const result = await session.request('/api/collect', { method: 'POST', body: {} });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('offline');
    // No extra call went out — we short-circuit without a session.
    expect(fetch.mock.calls.length).toBe(before);
  });

  it('attaches the bearer token to an authed request once online', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(201, { token: 'tok-xyz', player: PLAYER }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const session = createSession({ fetch, storage, baseUrl: 'http://api.test' });
    await session.connect();

    const result = await session.request('/api/player/position', {
      method: 'POST',
      body: { position: { x: 0, y: 0, z: 0 } },
    });

    expect(result.ok).toBe(true);
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe('http://api.test/api/player/position');
    expect(init.headers.authorization).toBe('Bearer tok-xyz');
    expect(init.headers['content-type']).toBe('application/json');
  });
});
