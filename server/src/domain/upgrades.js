/**
 * The upgrade catalogue — prices included.
 *
 * This lives on the server rather than in `/shared` on purpose. §6.1 makes the
 * server the only authority on what anything costs, so a client that ships its
 * own price list is at best redundant and at worst a thing to be edited. The
 * client renders whatever `GET /api/shop/catalog` returns.
 *
 * Tier counts come from the product doc's upgrade tree (§3.2). Prices escalate
 * and pull in scarcer materials as they go, which is §3.3's "rare materials
 * gate the best upgrades" expressed as a table.
 *
 * Pure data and pure functions — no database, no HTTP.
 */

import { MATERIAL_TYPES } from '@glidewood/shared';

const { ACORNS, BARK, SILK, BERRIES } = MATERIAL_TYPES;

/**
 * `prices[i]` is the cost of moving from tier `i` to tier `i + 1`, so a
 * category with 5 tiers has 5 prices.
 */
export const UPGRADE_CATALOGUE = Object.freeze({
  distance: Object.freeze({
    stat: 'distance',
    label: 'Glide distance',
    description: 'Further per metre of height lost.',
    prices: Object.freeze([
      Object.freeze({ [ACORNS]: 12 }),
      Object.freeze({ [ACORNS]: 24, [BARK]: 8 }),
      Object.freeze({ [ACORNS]: 40, [BARK]: 16, [SILK]: 2 }),
      Object.freeze({ [ACORNS]: 64, [BARK]: 28, [SILK]: 6 }),
      Object.freeze({ [ACORNS]: 96, [BARK]: 44, [SILK]: 12, [BERRIES]: 1 }),
    ]),
  }),
  agility: Object.freeze({
    stat: 'agility',
    label: 'Turn control',
    description: 'Tighter turns without losing the line.',
    prices: Object.freeze([
      Object.freeze({ [ACORNS]: 10, [BARK]: 4 }),
      Object.freeze({ [ACORNS]: 26, [BARK]: 12, [SILK]: 2 }),
      Object.freeze({ [ACORNS]: 52, [BARK]: 24, [SILK]: 8 }),
    ]),
  }),
  flapCharges: Object.freeze({
    stat: 'flapCharges',
    label: 'Flap charges',
    description: 'Regain a little height mid-glide.',
    prices: Object.freeze([
      Object.freeze({ [ACORNS]: 18, [SILK]: 2 }),
      Object.freeze({ [ACORNS]: 38, [SILK]: 6, [BARK]: 10 }),
      Object.freeze({ [ACORNS]: 70, [SILK]: 14, [BERRIES]: 1 }),
    ]),
  }),
  fallControl: Object.freeze({
    stat: 'fallControl',
    label: 'Dive control',
    description: 'Steadier sink and a later stall.',
    prices: Object.freeze([
      Object.freeze({ [ACORNS]: 14, [BARK]: 6 }),
      Object.freeze({ [ACORNS]: 30, [BARK]: 14, [SILK]: 3 }),
      Object.freeze({ [ACORNS]: 58, [BARK]: 26, [SILK]: 9 }),
    ]),
  }),
});

export const UPGRADE_KEYS = Object.freeze(Object.keys(UPGRADE_CATALOGUE));

export function maxTierFor(key) {
  return UPGRADE_CATALOGUE[key]?.prices.length ?? 0;
}

/**
 * What the next tier of `key` costs a player currently at `currentTier`.
 * @returns {{ok: true, price: object, nextTier: number}
 *          |{ok: false, reason: string}}
 */
export function priceFor(key, currentTier) {
  const entry = UPGRADE_CATALOGUE[key];
  if (!entry) return { ok: false, reason: 'unknown_upgrade' };
  if (!Number.isInteger(currentTier) || currentTier < 0) {
    return { ok: false, reason: 'invalid_tier' };
  }
  if (currentTier >= entry.prices.length) return { ok: false, reason: 'max_tier' };
  return { ok: true, price: entry.prices[currentTier], nextTier: currentTier + 1 };
}

/** Can `materials` cover `price`? Returns the shortfall if not. */
export function canAfford(materials, price) {
  const missing = {};
  for (const [material, cost] of Object.entries(price)) {
    const held = materials[material] ?? 0;
    if (held < cost) missing[material] = cost - held;
  }
  return Object.keys(missing).length === 0
    ? { ok: true }
    : { ok: false, reason: 'insufficient_materials', missing };
}

/** The catalogue as the client should see it, with each player's next price. */
export function catalogueFor(stats = {}) {
  return UPGRADE_KEYS.map((key) => {
    const entry = UPGRADE_CATALOGUE[key];
    const currentTier = stats[key] ?? 0;
    const next = priceFor(key, currentTier);
    return {
      key,
      label: entry.label,
      description: entry.description,
      currentTier,
      maxTier: entry.prices.length,
      nextPrice: next.ok ? next.price : null,
    };
  });
}
