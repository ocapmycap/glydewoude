import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, registerPlayer, request } from './helpers/harness.js';

let harness;
afterEach(async () => { await harness?.close(); harness = null; });

describe('server smoke', () => {
  it('migrates and answers healthz', async () => {
    harness = await createHarness();
    const response = await request(harness.app, 'GET', '/healthz');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('registers a player and returns a token', async () => {
    harness = await createHarness();
    const { status, token, player } = await registerPlayer(harness.app, 'Nutkin');

    expect(status).toBe(201);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);
    expect(player.displayName).toBe('Nutkin');
    expect(player.glideStats).toEqual({
      distance: 0, agility: 0, flapCharges: 0, fallControl: 0,
    });
    expect(player.materials).toEqual({ acorns: 0, silk: 0, bark: 0, berries: 0 });
  });

  it('never returns the raw token again', async () => {
    harness = await createHarness();
    const { token } = await registerPlayer(harness.app);
    const me = await request(harness.app, 'GET', '/api/player/me', { token });
    expect(JSON.stringify(me.body)).not.toContain(token);
  });

  it('404s an unknown path', async () => {
    harness = await createHarness();
    const response = await request(harness.app, 'GET', '/api/nope');
    expect(response.status).toBe(404);
  });
});
