/** Unit tests for the pure pieces: pricing, validation bounds, rate limiting. */

import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';
import { canAfford, catalogueFor, maxTierFor, priceFor } from '../src/domain/upgrades.js';
import { checkReachable, maxHorizontalSpeed } from '../src/domain/validation.js';
import { normaliseDisplayName, hashToken, generateToken } from '../src/domain/auth.js';
import { createRateLimiter } from '../src/middleware/rate-limit.js';

const config = loadConfig({});
const BASE_STATS = { distance: 0, agility: 0, flapCharges: 0, fallControl: 0 };

describe('upgrade pricing', () => {
  it('matches the tier counts in the product doc §3.2', () => {
    expect(maxTierFor('distance')).toBe(5);
    expect(maxTierFor('agility')).toBe(3);
    expect(maxTierFor('flapCharges')).toBe(3);
    expect(maxTierFor('fallControl')).toBe(3);
  });

  it('gets strictly more expensive each tier', () => {
    for (const key of ['distance', 'agility', 'flapCharges', 'fallControl']) {
      const totals = [];
      for (let tier = 0; tier < maxTierFor(key); tier += 1) {
        const { price } = priceFor(key, tier);
        totals.push(Object.values(price).reduce((sum, n) => sum + n, 0));
      }
      for (let i = 1; i < totals.length; i += 1) {
        expect(totals[i], `${key} tier ${i}`).toBeGreaterThan(totals[i - 1]);
      }
    }
  });

  it('pulls scarcer materials into the later tiers', () => {
    const first = priceFor('distance', 0).price;
    const last = priceFor('distance', 4).price;
    expect(Object.keys(first)).toEqual(['acorns']);
    expect(Object.keys(last)).toContain('berries');
  });

  it('refuses unknown upgrades and out-of-range tiers', () => {
    expect(priceFor('nope', 0)).toMatchObject({ ok: false, reason: 'unknown_upgrade' });
    expect(priceFor('distance', 5)).toMatchObject({ ok: false, reason: 'max_tier' });
    expect(priceFor('distance', -1)).toMatchObject({ ok: false, reason: 'invalid_tier' });
    expect(priceFor('distance', 1.5)).toMatchObject({ ok: false, reason: 'invalid_tier' });
  });

  it('reports exactly what is missing', () => {
    const verdict = canAfford({ acorns: 10, bark: 0 }, { acorns: 12, bark: 4 });
    expect(verdict).toMatchObject({ ok: false, missing: { acorns: 2, bark: 4 } });
  });

  it('treats an exact balance as affordable', () => {
    expect(canAfford({ acorns: 12 }, { acorns: 12 })).toEqual({ ok: true });
  });

  it('shows no next price at max tier', () => {
    const entry = catalogueFor({ agility: 3 }).find((row) => row.key === 'agility');
    expect(entry.nextPrice).toBeNull();
  });
});

describe('travel plausibility', () => {
  const anchor = { x: 0, y: 20, z: 0 };

  const check = (claimedPosition, secondsAgo, stats = BASE_STATS) => checkReachable({
    lastPosition: anchor,
    lastPositionAt: new Date(Date.now() - secondsAgo * 1000),
    claimedPosition,
    now: new Date(),
    stats,
    config,
  });

  it('passes a player with no anchor yet', () => {
    expect(checkReachable({
      lastPosition: null, lastPositionAt: null,
      claimedPosition: { x: 9999, y: 0, z: 9999 },
      now: new Date(), stats: BASE_STATS, config,
    })).toMatchObject({ ok: true, reason: 'no_anchor' });
  });

  it('allows a short hop straight away', () => {
    expect(check({ x: 20, y: 20, z: 0 }, 0).ok).toBe(true);
  });

  it('rejects crossing the forest instantly', () => {
    expect(check({ x: 5000, y: 20, z: 0 }, 0)).toMatchObject({
      ok: false, reason: 'implausible_travel',
    });
  });

  it('allows the same distance given enough time', () => {
    expect(check({ x: 5000, y: 20, z: 0 }, 3600).ok).toBe(true);
  });

  it('keeps the allowance smaller than the forest, or it could never fire', () => {
    // Regression guard: the first version of this used a 15-second grace,
    // which bought ~576 m — more than the map is wide — so no teleport was
    // detectable at all.
    const budget = config.validation.graceMetres
      + config.validation.graceSeconds * maxHorizontalSpeed(BASE_STATS, config);
    expect(budget).toBeLessThan(300);
  });

  it('gives a faster squirrel a larger budget', () => {
    const slow = maxHorizontalSpeed(BASE_STATS, config);
    const fast = maxHorizontalSpeed({ ...BASE_STATS, distance: 5 }, config);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('display names', () => {
  it('accepts ordinary names and trims them', () => {
    expect(normaliseDisplayName('  Nutkin  the   Swift ')).toEqual({
      ok: true, value: 'Nutkin the Swift',
    });
  });

  it('accepts non-Latin scripts', () => {
    expect(normaliseDisplayName('りす').ok).toBe(true);
  });

  it('rejects empty, overlong, and markup-bearing names', () => {
    for (const bad of ['', '   ', 'x'.repeat(41), '<b>hi</b>', 'drop;table']) {
      expect(normaliseDisplayName(bad).ok, bad).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(normaliseDisplayName(bad).ok).toBe(false);
    }
  });
});

describe('tokens', () => {
  it('are long, unique, and stored only as hashes', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).not.toContain(a);
  });

  it('hash deterministically', () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });
});

describe('rate limiter', () => {
  it('allows up to the limit then blocks', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, max: 3, now: () => 0 });
    expect([1, 2, 3].map(() => limiter.check('ip').allowed)).toEqual([true, true, true]);
    expect(limiter.check('ip').allowed).toBe(false);
  });

  it('keeps callers separate', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, max: 1, now: () => 0 });
    expect(limiter.check('a').allowed).toBe(true);
    expect(limiter.check('b').allowed).toBe(true);
  });

  it('resets when the window rolls over', () => {
    let clock = 0;
    const limiter = createRateLimiter({ windowSeconds: 60, max: 1, now: () => clock });
    expect(limiter.check('ip').allowed).toBe(true);
    expect(limiter.check('ip').allowed).toBe(false);
    clock += 61_000;
    expect(limiter.check('ip').allowed).toBe(true);
  });

  it('reports a retry-after within the window', () => {
    const limiter = createRateLimiter({ windowSeconds: 60, max: 1, now: () => 0 });
    limiter.check('ip');
    const blocked = limiter.check('ip');
    expect(blocked.retryAfter).toBeGreaterThan(0);
    expect(blocked.retryAfter).toBeLessThanOrEqual(60);
  });
});
