/**
 * Fixed-window rate limiting for auth and economy endpoints (§6.2).
 *
 * In-process and in-memory, which is the right size for the single VPS the
 * doc describes (§5.4). It is deliberately not distributed: the moment there
 * is more than one server process this needs to move to Redis, and pretending
 * otherwise would hide that.
 *
 * The clock is injected so the tests do not have to sleep.
 */

export function createRateLimiter({ windowSeconds, max, now = () => Date.now() }) {
  const windows = new Map();

  function sweep(cutoff) {
    for (const [key, entry] of windows) {
      if (entry.resetAt <= cutoff) windows.delete(key);
    }
  }

  return {
    /**
     * @param {string} key  usually the client IP, or the player id once known
     * @returns {{allowed: boolean, remaining: number, retryAfter: number}}
     */
    check(key) {
      const currentMs = now();
      const entry = windows.get(key);

      if (!entry || entry.resetAt <= currentMs) {
        // Cheap opportunistic cleanup: without it a long-running process
        // accumulates one entry per IP it has ever seen.
        if (windows.size > 10_000) sweep(currentMs);
        windows.set(key, { count: 1, resetAt: currentMs + windowSeconds * 1000 });
        return { allowed: true, remaining: max - 1, retryAfter: 0 };
      }

      entry.count += 1;
      const remaining = Math.max(0, max - entry.count);
      return {
        allowed: entry.count <= max,
        remaining,
        retryAfter: Math.ceil((entry.resetAt - currentMs) / 1000),
      };
    },

    reset() {
      windows.clear();
    },

    get size() {
      return windows.size;
    },
  };
}
