/**
 * Server configuration, entirely from the environment.
 *
 * No secrets in the repo (§6.5). `DATABASE_URL` is the only setting with no
 * usable default — everything else falls back to something safe for local dev.
 */

function intFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

export function loadConfig(env = process.env) {
  return {
    port: intFromEnv(env, 'PORT', 8787),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? '',

    /** The forest every player explores. Must match the client's world seed. */
    worldSeed: env.WORLD_SEED ?? 'glidewood-phase-1',

    /** Session lifetime. Long, because losing a save is a trust event (§8). */
    sessionTtlSeconds: intFromEnv(env, 'SESSION_TTL_SECONDS', 60 * 60 * 24 * 90),

    /**
     * Anti-cheat tolerances (§6.3 — "proportionate, not paranoid").
     * These catch teleporting and speed hacks, not micro-optimised routes.
     */
    validation: {
      /**
       * Slack on the speed bound, for latency and clock skew.
       *
       * Keep this small. It is multiplied by top speed, so every second of
       * grace buys the client ~38 metres of teleport: at 15 seconds the
       * allowance exceeded the diameter of the whole forest and the check
       * could never fire. Jitter is covered by `graceMetres` instead, which
       * does not scale with speed.
       */
      graceSeconds: intFromEnv(env, 'VALIDATION_GRACE_SECONDS', 3),
      /** Flat distance allowance, for position updates arriving out of order. */
      graceMetres: intFromEnv(env, 'VALIDATION_GRACE_METRES', 25),
      /** How far from a cache a player may claim to be, in metres. */
      claimRadius: intFromEnv(env, 'VALIDATION_CLAIM_RADIUS', 30),
      /** Multiplier on the stat-implied top speed before we call it a hack. */
      speedTolerance: Number(env.VALIDATION_SPEED_TOLERANCE ?? 1.6),
    },

    rateLimit: {
      windowSeconds: intFromEnv(env, 'RATE_LIMIT_WINDOW_SECONDS', 60),
      authMax: intFromEnv(env, 'RATE_LIMIT_AUTH_MAX', 10),
      economyMax: intFromEnv(env, 'RATE_LIMIT_ECONOMY_MAX', 120),
    },

    /** Comma-separated list, or '*' for local dev. */
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((o) => o.trim()).filter(Boolean),
  };
}
