/**
 * The API client.
 *
 * What is worth asserting here is not "it calls fetch" but the two promises
 * the module makes to everything above it: every outcome arrives as a value
 * rather than an exception, and a refusal keeps the server's own reason
 * intact. Every caller branches on `error`, so a client that flattened
 * `insufficient_materials` into "it failed" would take the shop panel's
 * message away with it.
 */

import { describe, expect, it } from 'vitest';

import { createApiClient, CLIENT_ERRORS } from '../src/net/api.js';
import { createFakeFetch, fakePlayer } from './helpers/fake-server.js';

describe('createApiClient', () => {
  it('sends the token as a bearer header once it has one', async () => {
    const fetchImpl = createFakeFetch({
      'GET /api/player/me': [200, { player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });

    await api.me();
    expect(fetchImpl.calls[0].token).toBeNull();

    api.setToken('token-abc');
    await api.me();
    expect(fetchImpl.calls[1].token).toBe('token-abc');
  });

  it('prefixes the base URL without doubling the slash', async () => {
    const fetchImpl = createFakeFetch({ 'GET /healthz': [200, { ok: true }] });
    const api = createApiClient({ baseUrl: 'http://example.test/', fetch: fetchImpl });

    await api.health();
    expect(fetchImpl.calls[0].path).toBe('/healthz');
  });

  it('returns the payload on success', async () => {
    const player = fakePlayer({ displayName: 'Hazelpaw 200' });
    const api = createApiClient({
      fetch: createFakeFetch({ 'GET /api/player/me': [200, { player }] }),
    });

    const result = await api.me();
    expect(result.ok).toBe(true);
    expect(result.data.player.displayName).toBe('Hazelpaw 200');
  });

  it('keeps the server reason and status on a refusal', async () => {
    const api = createApiClient({
      fetch: createFakeFetch({
        'POST /api/shop/purchase': [409, {
          error: 'insufficient_materials',
          detail: { acorns: 4 },
        }],
      }),
    });

    const result = await api.purchase('distance');
    expect(result).toMatchObject({
      ok: false,
      error: 'insufficient_materials',
      status: 409,
      detail: { acorns: 4 },
    });
  });

  it('reports a dropped connection as offline rather than throwing', async () => {
    const api = createApiClient({ fetch: createFakeFetch({}) });

    // No route registered means the fake throws, exactly as fetch does when
    // there is nothing listening.
    await expect(api.me()).resolves.toEqual({
      ok: false,
      error: CLIENT_ERRORS.OFFLINE,
      status: 0,
    });
  });

  it('reports a non-JSON response rather than throwing', async () => {
    const api = createApiClient({
      fetch: createFakeFetch({ 'GET /api/player/me': [200, 'not-json'] }),
    });

    const result = await api.me();
    expect(result).toMatchObject({ ok: false, error: CLIENT_ERRORS.MALFORMED_RESPONSE });
  });

  it('does not try to parse a 204', async () => {
    const api = createApiClient({
      fetch: createFakeFetch({ 'POST /api/auth/logout': [204, 'not-json'] }),
    });

    const result = await api.logout();
    expect(result.ok).toBe(true);
  });

  it('sends no price with a purchase — the server owns it', async () => {
    const fetchImpl = createFakeFetch({
      'POST /api/shop/purchase': [200, { purchased: {}, player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });

    await api.purchase('agility');
    expect(fetchImpl.calls[0].body).toEqual({ upgrade: 'agility' });
  });

  it('sends no amount with a collection — the server derives it', async () => {
    const fetchImpl = createFakeFetch({
      'POST /api/collect': [200, { credited: {}, materials: {}, player: fakePlayer() }],
    });
    const api = createApiClient({ fetch: fetchImpl });

    await api.collect({
      cacheId: 'cache-7',
      position: { x: 1, y: 2, z: 3 },
      amount: 9999,
    });
    expect(fetchImpl.calls[0].body).toEqual({
      cacheId: 'cache-7',
      position: { x: 1, y: 2, z: 3 },
    });
  });
});
