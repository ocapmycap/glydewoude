/**
 * Sessions (§6.2).
 *
 * Opaque random tokens stored as SHA-256 hashes, not JWTs. Two reasons: there
 * are no keys to manage or rotate, and a session can actually be revoked —
 * with a stateless JWT you cannot log anyone out before it expires. The doc
 * allows either ("session/JWT-based"); this is the one with fewer ways to go
 * wrong at this size.
 *
 * A leaked database still does not yield usable tokens, because only the hash
 * is stored (§6.5).
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

export function generateToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time compare, for anywhere a token is checked directly. */
export function tokensMatch(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const DISPLAY_NAME = /^[\p{L}\p{N} '_-]{1,40}$/u;

/**
 * Display names are shown to other players in Phase 3, so they are validated
 * now rather than after they are already in the database.
 */
export function normaliseDisplayName(raw) {
  if (typeof raw !== 'string') return { ok: false, reason: 'display_name_required' };
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!DISPLAY_NAME.test(trimmed)) return { ok: false, reason: 'display_name_invalid' };
  return { ok: true, value: trimmed };
}

export function createAuth({ db, players, config }) {
  return {
    /**
     * Create a player and hand back a token.
     *
     * Phase 2 has no passwords and no social login. The token *is* the
     * account — whoever holds it is the player. That is the smallest thing
     * that satisfies "player accounts + save/load" and keeps §6.2's "keep
     * scope minimal" honest; real identity arrives with real cosmetics to
     * protect. See docs/decisions.md.
     */
    async register({ displayName, worldSeed = config.worldSeed }) {
      const name = normaliseDisplayName(displayName);
      if (!name.ok) return name;

      const token = generateToken();
      const player = await db.transaction(async (client) => {
        const created = await players.create(
          { id: randomUUID(), displayName: name.value, worldSeed },
          client,
        );
        await client.query(
          `INSERT INTO sessions (token_hash, player_id, expires_at)
           VALUES ($1, $2, now() + ($3 || ' seconds')::interval)`,
          [hashToken(token), created.id, String(config.sessionTtlSeconds)],
        );
        return created;
      });

      return { ok: true, token, player };
    },

    /** Resolve a bearer token to a player id, or null. */
    async playerIdForToken(token) {
      if (typeof token !== 'string' || token.length < 16) return null;
      const { rows } = await db.query(
        `SELECT player_id FROM sessions
          WHERE token_hash = $1 AND expires_at > now()`,
        [hashToken(token)],
      );
      if (!rows[0]) return null;

      // Best effort: a failed touch must not fail the request.
      db.query('UPDATE sessions SET last_used_at = now() WHERE token_hash = $1', [
        hashToken(token),
      ]).catch(() => {});

      return rows[0].player_id;
    },

    async revoke(token) {
      const result = await db.query('DELETE FROM sessions WHERE token_hash = $1', [
        hashToken(token),
      ]);
      return result.rowCount > 0;
    },
  };
}
