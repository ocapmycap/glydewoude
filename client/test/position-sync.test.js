/**
 * The position sync, exercised with a fake session.
 *
 * It is best-effort by design, so the assertions are about *when* a save goes
 * out, not about what the server did with it: online sends, offline stays
 * silent, an unchanged position is not re-sent, and a malformed one never
 * leaves the client.
 */

import { describe, expect, it } from 'vitest';

import { createPositionSync } from '../src/net/position-sync.js';

function fakeSession({ online = true } = {}) {
  const calls = [];
  return {
    online,
    calls,
    async request(path, options) {
      calls.push({ path, body: options.body });
      return { ok: true, status: 200, data: { ok: true }, error: null };
    },
  };
}

describe('position sync', () => {
  it('posts the position when online', async () => {
    const session = fakeSession();
    await createPositionSync({ session }).save({ x: 1, y: 2, z: 3, heading: 0.5 });

    expect(session.calls).toHaveLength(1);
    expect(session.calls[0].path).toBe('/api/player/position');
    // Only the coordinates travel — heading and any other motion fields stay home.
    expect(session.calls[0].body).toEqual({ position: { x: 1, y: 2, z: 3 } });
  });

  it('does nothing while offline', async () => {
    const session = fakeSession({ online: false });
    await createPositionSync({ session }).save({ x: 1, y: 2, z: 3 });

    expect(session.calls).toHaveLength(0);
  });

  it('skips an identical repeat but sends when the position changes', async () => {
    const session = fakeSession();
    const sync = createPositionSync({ session });

    await sync.save({ x: 1, y: 2, z: 3 });
    await sync.save({ x: 1, y: 2, z: 3 });
    expect(session.calls).toHaveLength(1);

    await sync.save({ x: 1, y: 2, z: 4 });
    expect(session.calls).toHaveLength(2);
  });

  it('ignores a non-finite position rather than sending garbage', async () => {
    const session = fakeSession();
    await createPositionSync({ session }).save({ x: 1, y: Number.NaN, z: 3 });

    expect(session.calls).toHaveLength(0);
  });
});
