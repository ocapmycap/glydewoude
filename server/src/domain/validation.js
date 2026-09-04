/**
 * "Never trust the client for anything economically meaningful." (§6.1)
 *
 * The client tells us it collected a cache. This module decides whether to
 * believe it. Everything here is pure — it takes the claim, the player's last
 * known state, and the world, and returns a verdict. No database, no clock:
 * the caller passes `now` in, so a test can put a claim anywhere in time.
 *
 * The bar is §6.3's: proportionate, not paranoid. These checks catch the
 * things that actually break an economy — a cache that does not exist, the
 * same cache banked twice, a player teleporting across the map — and do not
 * try to model whether a particular glide line was optimal.
 */

import { GLIDE_TUNING, deriveGlideProfile, distance2D } from '@glidewood/shared';

/**
 * The fastest a player could possibly be moving horizontally, given their
 * upgrade tiers. Cruise speed plus a full dive, times a tolerance for latency
 * and for the fact that we are bounding a straight line through a world where
 * players do not fly straight lines.
 */
export function maxHorizontalSpeed(stats, config, tuning = GLIDE_TUNING) {
  const profile = deriveGlideProfile(stats, tuning);
  const topSpeed = profile.cruiseSpeed + tuning.pitchSpeedTrade;
  return topSpeed * config.validation.speedTolerance;
}

/**
 * Could the player have got from where we last saw them to where they claim
 * to be, in the time that has passed?
 *
 * Deliberately one-dimensional: horizontal distance against elapsed seconds.
 * Altitude is not bounded because climbing a trunk is free height by design
 * (decisions.md D-11), so a vertical bound would flag legitimate play.
 *
 * A player we have never seen before passes — there is no anchor to measure
 * against, and the claim seeds one.
 */
export function checkReachable({ lastPosition, lastPositionAt, claimedPosition, now, stats, config }) {
  if (!lastPosition || !lastPositionAt) return { ok: true, reason: 'no_anchor' };

  const elapsedSeconds = Math.max(0, (now.getTime() - lastPositionAt.getTime()) / 1000);
  const budget = config.validation.graceMetres
    + (elapsedSeconds + config.validation.graceSeconds) * maxHorizontalSpeed(stats, config);
  const travelled = distance2D(lastPosition, claimedPosition);

  if (travelled > budget) {
    return {
      ok: false,
      reason: 'implausible_travel',
      detail: { travelled, budget, elapsedSeconds },
    };
  }
  return { ok: true };
}

/**
 * Validate a single collection claim.
 *
 * @param {object} args
 * @param {object} args.claim          {cacheId, position}
 * @param {Map<string, object>} args.cachesById  the seed-derived world's caches
 * @param {object} args.player         stats, last known position and time
 * @param {Set<string>} args.alreadyCollected
 * @param {Date} args.now              server clock, never the client's
 * @param {object} args.config
 * @returns {{ok: true, cache: object} | {ok: false, reason: string, detail?: object}}
 */
export function validateCollection({ claim, cachesById, player, alreadyCollected, now, config }) {
  if (!claim || typeof claim.cacheId !== 'string') {
    return { ok: false, reason: 'malformed_claim' };
  }

  // 1. Does this cache exist at all? The server regenerates the forest from
  //    the same seed the client used, so an invented cache id has nowhere to
  //    hide (decisions.md D-16).
  const cache = cachesById.get(claim.cacheId);
  if (!cache) return { ok: false, reason: 'unknown_cache' };

  // 2. Has it already been banked? The database primary key is the real
  //    guarantee; this is the friendly answer before we get there.
  if (alreadyCollected.has(claim.cacheId)) {
    return { ok: false, reason: 'already_collected' };
  }

  // 3. Was the player anywhere near it? The claim carries a position; it has
  //    to be the cache's position, or close enough for a moving squirrel.
  const claimedPosition = claim.position ?? cache.position;
  if (!Number.isFinite(claimedPosition?.x) || !Number.isFinite(claimedPosition?.z)) {
    return { ok: false, reason: 'malformed_position' };
  }
  const offset = distance2D(cache.position, claimedPosition);
  if (offset > config.validation.claimRadius) {
    return { ok: false, reason: 'not_at_cache', detail: { offset } };
  }

  // 4. Could they have got there? (§6.3 — catches teleports and speed hacks.)
  const reachable = checkReachable({
    lastPosition: player.lastPosition,
    lastPositionAt: player.lastPositionAt,
    claimedPosition,
    now,
    stats: player.stats,
    config,
  });
  if (!reachable.ok) return reachable;

  return { ok: true, cache };
}

/**
 * Bounds on a submitted run.
 *
 * These are not anti-cheat — D-28 says a run score is client-reported and a
 * spoofed one buys nothing. They exist because the columns are `INTEGER`: a
 * number past 2^31 would come back as a database error and a 500, when the
 * honest answer is that the client sent nonsense. Every ceiling sits far above
 * anything a real run reaches and far below where the column breaks.
 */
export const RUN_LIMITS = Object.freeze({
  maxScore: 100_000_000,
  maxChain: 10_000,
  maxDistance: 10_000_000,
  maxDurationMs: 24 * 60 * 60 * 1000,
});

/** A finite number in [0, max]. `Infinity` reaches here from JSON as `1e999`. */
function withinBounds(value, max) {
  return Number.isFinite(value) && value >= 0 && value <= max;
}

/**
 * Validate a finished run before it is offered to the best-run update.
 *
 * Pure, and shaped like `/api/player/position`'s own check: the numbers have
 * to be finite, non-negative and sane, or the request bounces rather than
 * storing rubbish.
 *
 * `durationMs` is bounded but not returned — nothing stores it. A best run
 * keeps score, chain and distance, and how long it took is not one of the
 * three things the HUD shows.
 *
 * @param {object} body  the parsed request body
 * @returns {{ok: true, run: {score: number, chain: number, distance: number}}
 *          | {ok: false, reason: string, detail?: object}}
 */
export function validateRunSubmission(body) {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'malformed_run' };

  const { score, chain, distance, durationMs } = body;

  if (!withinBounds(score, RUN_LIMITS.maxScore)) {
    return { ok: false, reason: 'malformed_run', detail: { field: 'score' } };
  }
  if (!Number.isInteger(chain) || !withinBounds(chain, RUN_LIMITS.maxChain)) {
    return { ok: false, reason: 'malformed_run', detail: { field: 'chain' } };
  }
  if (!withinBounds(distance, RUN_LIMITS.maxDistance)) {
    return { ok: false, reason: 'malformed_run', detail: { field: 'distance' } };
  }
  if (!withinBounds(durationMs, RUN_LIMITS.maxDurationMs)) {
    return { ok: false, reason: 'malformed_run', detail: { field: 'durationMs' } };
  }

  // Score is already an integer by the time `extendRun` is done with it;
  // distance is raw metres and is not. Rounding here rather than in the
  // repository keeps the SQL free of any opinion about the numbers.
  return {
    ok: true,
    run: { score: Math.round(score), chain, distance: Math.round(distance) },
  };
}
