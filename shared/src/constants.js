/**
 * Tuning constants for Glidewood.
 *
 * Two separate things live here and they are deliberately separate:
 *
 *  - GLIDE_TUNING  — the feel dials. Phase 1 exists to iterate on these, and
 *                    the in-game tuning panel edits a copy of this object live.
 *  - BASE_GLIDE_STATS — the per-player upgrade tiers from the product doc's
 *                    upgrade tree. Phase 1 always runs at tier 0; the physics
 *                    takes stats as a parameter so Phase 2 can raise them
 *                    without touching the integrator.
 */

/** Upgrade tiers. Phase 1 never changes these — see docs/decisions.md. */
export const BASE_GLIDE_STATS = Object.freeze({
  /** Glide distance tier — raises glide ratio and cruise speed. */
  distance: 0,
  /** Turn control tier — raises turn rate. */
  agility: 0,
  /** Flap charges tier — declared for shape only, unused in Phase 1. */
  flapCharges: 0,
  /** Fall control tier — lowers stall speed, steadies sink response. */
  fallControl: 0,
});

export const GLIDE_TUNING = Object.freeze({
  /** Downward acceleration while stalled or not generating lift (m/s²). */
  gravity: 22,
  /** Hard floor on descent rate (m/s). */
  terminalFallSpeed: 34,

  /** Horizontal metres travelled per metre of altitude lost, at cruise. */
  baseGlideRatio: 5.5,
  glideRatioPerDistanceTier: 0.8,

  /** Steady-state horizontal speed with no pitch input (m/s). */
  baseCruiseSpeed: 17,
  cruiseSpeedPerDistanceTier: 1.2,

  /** Maximum yaw rate (rad/s). */
  baseTurnRate: 1.35,
  turnRatePerAgilityTier: 0.35,
  /** How fast yaw rate reaches the commanded rate — this is the turn inertia. */
  turnSmoothing: 4.5,

  /** How fast speed converges on its target (1/s). Low = momentum-y. */
  speedResponse: 1.6,
  /** Speed a full dive adds / a full flare removes (m/s). */
  pitchSpeedTrade: 7,

  /** Off-cruise speed costs glide efficiency, so cruise is the optimum. */
  glideEfficiencyFalloff: 0.55,
  minGlideEfficiency: 0.4,

  /** Below this the wings stop working and you fall (m/s). */
  stallSpeed: 6.5,
  stallSpeedPerFallControlTier: 0.6,

  /** How fast vertical speed converges on the glide's sink rate (1/s). */
  baseSinkResponse: 2.4,
  sinkResponsePerFallControlTier: 0.5,

  /** Launch: fraction of cruise speed granted, plus a small upward hop (m/s). */
  launchSpeedFactor: 0.85,
  launchHop: 2.4,

  /** Clamps, purely defensive. */
  minSpeed: 0,
  maxSpeed: 40,
});

/** Default forest layout. One small area — Phase 1 is a single zone. */
export const WORLD_CONFIG = Object.freeze({
  seed: 'glidewood-phase-1',
  /** Radius of the playable disc (m). */
  areaRadius: 260,
  /** Minimum distance between trunks (m). */
  minSpacing: 24,
  /** How hard to try before accepting the forest is full. */
  placementAttempts: 900,
  /** Ordinary tree trunk height range (m). */
  trunkHeightRange: [12, 34],
  trunkRadiusRange: [0.7, 1.4],
  canopyRadiusRange: [4.5, 8.5],
  /** The central landmark — tallest thing in the forest, and the spawn. */
  greatTree: {
    trunkHeight: 46,
    trunkRadius: 2.6,
    canopyRadius: 11,
    name: 'The Great Oak',
  },
  /**
   * Share of trees that are destination trees rather than scenery.
   * The product doc calls for 10–15% (§2.3).
   */
  destinationRatio: 0.12,
  /**
   * Share of destination trees that are shops rather than plain landmarks.
   * The rest stay orientation landmarks: a shop on every destination would
   * make the forest a high street, and the glide between two of them is the
   * part the doc actually cares about (§2.3).
   */
  shopShare: 0.4,
  /**
   * Seed offset for deciding what a destination *is*. Rolling that from the
   * placement stream would shift every tree drawn after it, silently moving
   * forests the server validates claimed positions against (§6.1). Same
   * reason MATERIAL_CONFIG salts its own seed (D-3, D-16).
   */
  destinationTypeSalt: 0x517cc1b7,
  /**
   * Landing volumes. Two of them per tree, and both are generous on purpose:
   * the canopy blob you can drop into from above, and the trunk you can fly
   * into from the side and climb. See client/src/sim/landing.js.
   */
  perchRadius: 3.2,
  /**
   * Canopy catch height as a multiple of canopy radius. Matched to how far
   * the rendered foliage actually hangs below the perch (see CANOPY_DROP in
   * client/src/render/trees.js) so you catch what you can see.
   */
  canopyDepthFactor: 1.75,
  /** Extra grab radius around a trunk — the squirrel catches bark, generously. */
  catchMargin: 2.4,
  /** Fraction of trunk height below which you slide past instead of catching. */
  minCatchHeightFraction: 0.35,
  groundY: 0,
});

/** Tree types from the product doc's data model (§5.3). */
export const TREE_TYPES = Object.freeze({
  SCENERY: 'scenery',
  SHOP: 'shop',
  PUZZLE: 'puzzle',
  CAFETERIA: 'cafeteria',
  CUSTOMIZATION: 'customization',
  /** Phase 1 addition: an orientation landmark with no economy attached. */
  LANDMARK: 'landmark',
});

/**
 * Soft-currency materials from the product doc §3.1.
 *
 * Rarity is not just a spawn weight — it is biased toward trees that are hard
 * to get to, so the scarce materials sit behind reach rather than behind
 * repetition. §3.3 asks for exactly that: rare materials gated by skill, not
 * by grind.
 */
export const MATERIAL_TYPES = Object.freeze({
  ACORNS: 'acorns',
  SILK: 'silk',
  BARK: 'bark',
  BERRIES: 'berries',
});

/**
 * Base spawn weight, how strongly effort skews it, and the size of a cache.
 * `rarity` 0 means "found anywhere"; higher means "the far, tall corners of
 * the forest".
 */
export const MATERIAL_TABLE = Object.freeze({
  [MATERIAL_TYPES.ACORNS]: Object.freeze({ weight: 1, rarity: 0, amount: [1, 3] }),
  [MATERIAL_TYPES.BARK]: Object.freeze({ weight: 0.7, rarity: 0, amount: [1, 3] }),
  [MATERIAL_TYPES.SILK]: Object.freeze({ weight: 0.1, rarity: 1, amount: [1, 2] }),
  [MATERIAL_TYPES.BERRIES]: Object.freeze({ weight: 0.02, rarity: 2, amount: [1, 1] }),
});

export const MATERIAL_CONFIG = Object.freeze({
  /** Share of trees carrying a cache. Rewarding without saturating the map. */
  cacheChance: 0.45,
  /** How hard effort skews the rare materials. 0 would make rarity cosmetic. */
  effortWeighting: 8,
  /** Height a cache floats above the perch, in metres. */
  cacheHeightOffset: 1.2,
  /** Seed offset, so material placement does not consume the worldgen stream. */
  seedSalt: 0x9e3779b9,
});
