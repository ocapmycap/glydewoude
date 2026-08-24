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
