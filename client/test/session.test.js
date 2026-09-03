/**
 * Sessions.
 *
 * The deliverable Phase 2 is measured against is "reload and still have it",
 * and this module is the half of that which survives the reload. So the tests
 * are about the token's lifecycle rather than about HTTP: kept when it works,
 * dropped when the server rejects it, and — the case worth being careful about
 * — *kept* when the server merely could not be reached, because throwing away
 * a good token because the wifi dropped would lose the save the section exists
 * to protect.
 */

import { describe, expect, it } from 'vitest';

import { createApiClient } from '../src/net/api.js';
import { createSession, generateDisplayName, TOKEN_KEY } from '../src/net/session.js';
import { createFakeFetch, fakePlayer, fakeStorage } from './helpers/fake-server.js';

/** A deterministic stand-in for Math.random, cycling through fixed values. */
function scriptedRandom(values = [0, 0, 0]) {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('generateDisplayName', () => {
  it('produces a name the server would accept', () => {
    const name = generateDisplayName(scriptedRandom([0.1, 0.5, 0.9]));
    expect(name).toMatch(/^[\p{L}\p{N} '_-]{1,40}$/u);
  });

  it('takes its randomness as a parameter, so a test can pin it', () => {
    const a = generateDisplayName(scriptedRandom([0.2, 0.4, 0.6]));
    const b = generateDisplayName(scriptedRandom([0.2, 0.4, 0.6]));
    expect(a).toBe(b);
  });
});

describe('createSession', () => {
  it('registers on a first visit and keeps the token', async () => {
    const storage = fakeStorage();
    const fetchImpl = createFakeFetch({
      'POST /api/auth/register': [201, { token: 'token-new', player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });
    const session = createSession({ api, storage, random: scriptedRandom() });

    const result = await session.start();

    expect(result).toMatchObject({ ok: true, resumed: false });
    expect(storage.getItem(TOKEN_KEY)).toBe('token-new');
    expect(api.token).toBe('token-new');
  });

  it('resumes with a stored token instead of registering again', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: 'token-old' });
    const fetchImpl = createFakeFetch({
      'GET /api/player/me': [200, { player: fakePlayer({ displayName: 'Rowanleaf 300' }) }],
      'POST /api/auth/register': [201, { token: 'should-not-happen', player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });
    const session = createSession({ api, storage });

    const result = await session.start();

    expect(result).toMatchObject({ ok: true, resumed: true });
    expect(result.player.displayName).toBe('Rowanleaf 300');
    expect(fetchImpl.pathsCalled()).toEqual(['GET /api/player/me']);
    expect(storage.getItem(TOKEN_KEY)).toBe('token-old');
  });

  it('registers again when the stored token is rejected', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: 'token-expired' });
    const fetchImpl = createFakeFetch({
      'GET /api/player/me': [401, { error: 'unauthorized' }],
      'POST /api/auth/register': [201, { token: 'token-fresh', player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });
    const session = createSession({ api, storage, random: scriptedRandom() });

    const result = await session.start();

    expect(result).toMatchObject({ ok: true, resumed: false });
    expect(storage.getItem(TOKEN_KEY)).toBe('token-fresh');
  });

  it('keeps a token the server merely failed to answer about', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: 'token-good' });
    const api = createApiClient({
      // No route: the connection is refused, not the token.
      fetch: createFakeFetch({}),
    });
    const session = createSession({ api, storage });

    const result = await session.start();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('offline');
    expect(storage.getItem(TOKEN_KEY)).toBe('token-good');
  });

  it('keeps a token through a server error too', async () => {
    const storage = fakeStorage({ [TOKEN_KEY]: 'token-good' });
    const api = createApiClient({
      fetch: createFakeFetch({ 'GET /api/player/me': [500, { error: 'internal_error' }] }),
    });
    const session = createSession({ api, storage });

    await session.start();
    expect(storage.getItem(TOKEN_KEY)).toBe('token-good');
  });

  it('survives storage that throws on every access', async () => {
    const hostile = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    const api = createApiClient({
      fetch: createFakeFetch({
        'POST /api/auth/register': [201, { token: 'token-x', player: fakePlayer() }],
      }),
    });
    const session = createSession({ api, storage: hostile, random: scriptedRandom() });

    // The session works for this tab; it just will not outlive it.
    await expect(session.start()).resolves.toMatchObject({ ok: true });
    expect(api.token).toBe('token-x');
  });

  it('forgets everything on sign-out', async () => {
    const storage = fakeStorage();
    const api = createApiClient({
      fetch: createFakeFetch({
        'POST /api/auth/register': [201, { token: 'token-y', player: fakePlayer() }],
        'POST /api/auth/logout': [200, { ok: true }],
      }),
    });
    const session = createSession({ api, storage, random: scriptedRandom() });

    await session.start();
    await session.signOut();

    expect(storage.getItem(TOKEN_KEY)).toBeNull();
    expect(api.token).toBeNull();
    expect(session.isSignedIn).toBe(false);
  });
});
