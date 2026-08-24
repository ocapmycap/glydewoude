/** JSON response helpers, and the one place error shapes are decided. */

/**
 * Client-visible reasons map to status codes here. Anything not listed is a
 * bug on our side, not theirs, so it becomes a 500 with no detail leaked.
 */
const STATUS_BY_REASON = Object.freeze({
  display_name_required: 400,
  display_name_invalid: 400,
  malformed_claim: 400,
  malformed_position: 400,
  malformed_body: 400,
  unknown_upgrade: 400,
  invalid_tier: 400,
  unauthorized: 401,
  unknown_player: 404,
  unknown_cache: 404,
  not_found: 404,
  already_collected: 409,
  max_tier: 409,
  tier_changed: 409,
  insufficient_materials: 409,
  not_at_cache: 422,
  implausible_travel: 422,
  payload_too_large: 413,
  rate_limited: 429,
});

export function statusForReason(reason) {
  return STATUS_BY_REASON[reason] ?? 500;
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // Player state is per-session and must never be cached by a proxy.
    'cache-control': 'no-store',
  });
  res.end(payload);
}

export function sendError(res, reason, detail) {
  const status = statusForReason(reason);
  // A 500 means we do not understand what happened; saying more than that
  // risks leaking internals to a caller who should not see them.
  const body = status >= 500
    ? { error: 'internal_error' }
    : { error: reason, ...(detail ? { detail } : {}) };
  sendJson(res, status, body);
}
