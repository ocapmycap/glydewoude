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

  /** Speed scampering up a trunk after a climb-triggering catch (m/s). */
  climbSpeed: 8,
  /**
   * Shortest a climb may take (s), however close the catch already was to the
   * perch. Without a floor a canopy catch a few centimetres below the perch
   * would finish in a single tick — a teleport with extra math, not a climb
   * (LAN-579).
   */
  minClimbDuration: 0.3,

  /** Turn rate spinning on the spot while perched (rad/s). */
  perchTurnRate: 2.5,
  /** How long the back-tap about-face takes, so the camera sweeps rather than cuts (s). */
  aboutFaceDuration: 0.4,
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

/**
 * Run mode's dials — see `run-mode-tasks.md`.
 *
 * Separate from GLIDE_TUNING on purpose, the same way BASE_GLIDE_STATS is:
 * these change what a landing is *worth*, never how the squirrel flies. A
 * value moved here can never alter a glide, which is what makes the score
 * safe to retune without re-testing the physics.
 */
export const RUN_TUNING = Object.freeze({
  /** Score multiplier gained per link already in the chain. */
  chainStep: 0.25,
  /** Ceiling on the multiplier, so a long chain cannot run away. */
  maxMultiplier: 4,
  /** Paid for landing on a tree the run has not used yet — rewards crossing
   *  the forest over bouncing between the same two trunks. */
  freshBonus: 1.5,
  /** Below this many landings it was not a run, and nothing banks it. */
  minChainToBank: 2,
  /** Chain lengths worth a celebratory beat in the HUD, not a score bonus. */
  milestoneChains: Object.freeze([3, 5, 10]),
});

/** Decorations worldgen tucks into destination canopies (LAN-520). Drawing only; landing ignores them. */
export const STRUCTURE_KINDS = Object.freeze({ DREY: 'drey', PLATFORM: 'platform' });

/**
 * Puzzle tree course dials (LAN-546).
 *
 * Kept apart from GLIDE_TUNING the same way BASE_GLIDE_STATS is: these
 * numbers decide which trees get a course and how tight it is, never how the
 * squirrel actually flies. worldgen consults them when choosing puzzle trees
 * and shaping their rings; nothing in glide.js or the sim's step functions
 * reads them.
 */
export const PUZZLE_CONFIG = Object.freeze({
  /** How many destination trees become puzzle trees. */
  treeCount: 3,
  /** Rings per course. */
  ringCount: 3,
  /**
   * Ring radius, metres. Raised from 2.5 (LAN-581): once rings sat on the
   * real, simulated glide path instead of the straight line between the two
   * perches, a tighter ring left no margin for the small steering corrections
   * a neutral-pitch pilot actually needs to line one up.
   */
  ringRadius: 4,
  /**
   * Seconds per step used to simulate a candidate course's flight path.
   * Must match client/src/sim/loop.js's FIXED_DT — a course built on a
   * different timestep would land its rings between the points the shipped
   * fixed-timestep sim actually samples, instead of on them (LAN-581).
   */
  pathStep: 1 / 60,
  /**
   * Horizontal distance, metres, the first ring sits from the puzzle tree —
   * clears the launch hop and the tree's own canopy before a ring appears.
   */
  firstRingDistance: 15,
  /**
   * Horizontal distance, metres, the last ring sits short of the target —
   * leaves room to line up the final catch after the last ring.
   */
  lastRingClearance: 10,
  /**
   * Altitude, metres, a neutral-pitch (steer 0, pitch 0) simulated glide must
   * still clear above the target's perch at the last ring's horizontal
   * distance. Without this slack a target could be "reachable" only by diving
   * past the last ring, which the ring layout — meant to be flown neutral —
   * could never actually deliver (LAN-581).
   */
  lastRingSlack: 2,
  /** Minimum horizontal gap between a puzzle tree and its target, metres, so the rings between them have room to breathe. */
  minTargetDistance: 30,
  /** Seed offset, so puzzle selection does not disturb the main worldgen stream. */
  seedSalt: 0x51ed270b,
});

/**
 * Towering tree placement dials (LAN-553).
 *
 * A handful of trees dwarfing everything else in the forest — landmarks
 * visible from anywhere, and (LAN-554) something you cling to the trunk of
 * rather than perch on. Kept apart from
 * WORLD_CONFIG the same way PUZZLE_CONFIG is: these numbers decide how many
 * giants spawn and how big they are, never how an ordinary tree is scattered
 * or shaped.
 */
export const TOWERING_TREE_CONFIG = Object.freeze({
  /** How many towering trees the default world gets. */
  count: 4,
  /** Trunk height as a multiple of WORLD_CONFIG.trunkHeightRange[1] — always taller than every ordinary trunk. */
  heightFactorRange: [2.5, 3.5],
  /** Trunk radius as a multiple of WORLD_CONFIG.trunkRadiusRange[1]. */
  radiusFactorRange: [2, 3],
  /** Canopy radius as a multiple of WORLD_CONFIG.canopyRadiusRange[1] — high and wide. */
  canopyFactorRange: [2, 2.5],
  /** Placed no closer to the centre than this fraction of areaRadius — the outer half of the forest. */
  minRimFraction: 0.5,
  /**
   * Minimum distance between two towering trees, as a fraction of areaRadius.
   * Generous on purpose (~half the forest's radius) so the giants read as
   * scattered landmarks rather than a cluster.
   */
  separationFraction: 0.5,
  /** How hard to try before accepting fewer than `count` fit. */
  placementAttempts: 4000,
  /** Seed offset, so towering placement does not disturb the worldgen or puzzle streams. */
  seedSalt: 0x2545f491,
});
