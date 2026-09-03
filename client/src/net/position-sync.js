/**
 * Reporting the squirrel's position to the server.
 *
 * The server anchors its plausibility check (§6.1, §6.3, D-27) on the player's
 * last known position: a collection claim is refused if it is further from the
 * anchor than the player could have travelled in the elapsed time. Every
 * validated `/collect` already advances that anchor, but a landing that claims
 * no cache does not — so without this a player who glides a long way between
 * caches looks like they teleported when they finally do collect.
 *
 * So we push position on landings too. It is deliberately best-effort and low
 * stakes: a spoofed or dropped position only moves where others would see the
 * squirrel (Phase 3) and re-anchors the very check meant to catch it, so a lost
 * save just means the next one carries the update. It must never interrupt
 * play, which is why a failure is swallowed rather than retried.
 *
 * Session injected; runs headlessly under Vitest. Lives in net/ with its peers.
 */

/**
 * @param {object} deps
 * @param {{online:boolean, request:Function}} deps.session  from createSession()
 */
export function createPositionSync({ session }) {
  let last = null;

  return {
    /**
     * Save the current position, if it has moved and we have a session. Fire
     * and forget — the returned promise settles once the request is done, but
     * callers on the game loop need not await it.
     */
    async save(position) {
      if (!session.online || !position) return;

      const point = { x: position.x, y: position.y, z: position.z };
      if (![point.x, point.y, point.z].every((n) => Number.isFinite(n))) return;

      // Skip an identical repeat — landing back on the same perch should not
      // re-send the same coordinates.
      if (last && last.x === point.x && last.y === point.y && last.z === point.z) return;
      last = point;

      // Best-effort: the verdict is ignored on purpose. See the module note.
      await session.request('/api/player/position', {
        method: 'POST',
        body: { position: point },
      });
    },
  };
}
