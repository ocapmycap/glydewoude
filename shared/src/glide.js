/**
 * The glide model.
 *
 * Physics-lite per the product doc §2.2: gravity, forward velocity, and a
 * glide-ratio multiplier. Not an aerodynamic simulation — the goal is a
 * readable, tunable, forgiving feel, not realism.
 *
 * Everything in this file is pure. No globals, no `Math.random`, no clock
 * reads. Same inputs always give the same outputs, which is what makes the
 * headless smoke test possible and what will let the Phase 2 server replay a
 * client's claimed trajectory to sanity-check it (§6.1).
 */

import { BASE_GLIDE_STATS, GLIDE_TUNING } from './constants.js';
import { approach, clamp } from './math.js';

/**
 * @typedef {object} GlideMotion
 * @property {number} x
 * @property {number} y      altitude, metres above ground
 * @property {number} z
 * @property {number} heading  yaw in radians; forward is (sin h, 0, cos h)
 * @property {number} yawRate  current yaw rate, carries turn inertia
 * @property {number} speed    horizontal speed, m/s
 * @property {number} vy       vertical speed, m/s (negative = descending)
 */

/**
 * @typedef {object} GlideInput
 * @property {number} steer  -1 (left) .. 1 (right)
 * @property {number} pitch  -1 (dive) .. 1 (flare)
 */

/**
 * Collapse upgrade tiers into the handful of numbers the integrator uses.
 * Phase 2's shop changes the tiers; nothing below this line needs to know.
 */
export function deriveGlideProfile(stats = BASE_GLIDE_STATS, tuning = GLIDE_TUNING) {
  const s = { ...BASE_GLIDE_STATS, ...stats };
  const cruiseSpeed = tuning.baseCruiseSpeed + tuning.cruiseSpeedPerDistanceTier * s.distance;
  return {
    glideRatio: tuning.baseGlideRatio + tuning.glideRatioPerDistanceTier * s.distance,
    cruiseSpeed,
    turnRate: tuning.baseTurnRate + tuning.turnRatePerAgilityTier * s.agility,
    stallSpeed: Math.max(
      1,
      tuning.stallSpeed - tuning.stallSpeedPerFallControlTier * s.fallControl,
    ),
    sinkResponse: tuning.baseSinkResponse + tuning.sinkResponsePerFallControlTier * s.fallControl,
    launchSpeed: cruiseSpeed * tuning.launchSpeedFactor,
  };
}

/**
 * Glide ratio actually achieved at a given speed.
 *
 * Efficiency peaks at cruise and falls off either side, so diving and flaring
 * are real trades rather than free wins: a dive buys ground speed at the cost
 * of ratio, a flare buys a gentle low-sink approach at the cost of ratio.
 */
export function effectiveGlideRatio(speed, profile, tuning = GLIDE_TUNING) {
  const offCruise = Math.abs(speed - profile.cruiseSpeed) / profile.cruiseSpeed;
  const efficiency = Math.max(
    tuning.minGlideEfficiency,
    1 - tuning.glideEfficiencyFalloff * offCruise,
  );
  return profile.glideRatio * efficiency;
}

/** Steady-state descent rate (m/s, positive) for a given speed. */
export function sinkRateAt(speed, profile, tuning = GLIDE_TUNING) {
  return speed / effectiveGlideRatio(speed, profile, tuning);
}

/**
 * How far a glide can carry you from `altitude` metres up, at best efficiency.
 * Used by the HUD, by the test autopilot, and (Phase 2) by server-side
 * plausibility checks on claimed positions.
 */
export function maxGlideRange(altitude, profile) {
  return Math.max(0, altitude) * profile.glideRatio;
}

/** Unit forward vector for a heading. */
export function headingVector(heading) {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}

/** The motion state a launch starts from. */
export function launchMotion({ x, y, z, heading }, profile, tuning = GLIDE_TUNING) {
  return {
    x,
    y,
    z,
    heading,
    yawRate: 0,
    speed: profile.launchSpeed,
    vy: tuning.launchHop,
  };
}

/**
 * Advance one glide step. Returns a new motion object; does not mutate input.
 *
 * @param {GlideMotion} motion
 * @param {GlideInput} input
 * @param {ReturnType<typeof deriveGlideProfile>} profile
 * @param {number} dt seconds
 * @param {typeof GLIDE_TUNING} [tuning]
 * @returns {GlideMotion}
 */
export function stepGlide(motion, input, profile, dt, tuning = GLIDE_TUNING) {
  const steer = clamp(input?.steer ?? 0, -1, 1);
  const pitch = clamp(input?.pitch ?? 0, -1, 1);

  // Yaw: the commanded rate is approached, never snapped to. This is the
  // "momentum matters, no instant direction changes" pillar, and it is the
  // single most important line in the file for how the glide feels.
  const commandedYawRate = steer * profile.turnRate;
  const yawRate = motion.yawRate
    + (commandedYawRate - motion.yawRate) * approach(tuning.turnSmoothing, dt);
  // Screen-right is -X at heading 0, so a right turn decreases heading.
  const heading = motion.heading - yawRate * dt;

  // Speed: pitch trades altitude for speed and back, with lag.
  const targetSpeed = clamp(
    profile.cruiseSpeed - pitch * tuning.pitchSpeedTrade,
    tuning.minSpeed,
    tuning.maxSpeed,
  );
  const speed = motion.speed + (targetSpeed - motion.speed) * approach(tuning.speedResponse, dt);

  // Vertical: gliding converges on the sink rate the glide ratio implies.
  // Below stall speed the wings stop working and it is just gravity.
  let vy;
  if (speed >= profile.stallSpeed) {
    const targetVy = -sinkRateAt(speed, profile, tuning);
    vy = motion.vy + (targetVy - motion.vy) * approach(profile.sinkResponse, dt);
  } else {
    vy = motion.vy - tuning.gravity * dt;
  }
  vy = Math.max(vy, -tuning.terminalFallSpeed);

  const forward = headingVector(heading);
  return {
    x: motion.x + forward.x * speed * dt,
    y: motion.y + vy * dt,
    z: motion.z + forward.z * speed * dt,
    heading,
    yawRate,
    speed,
    vy,
  };
}
