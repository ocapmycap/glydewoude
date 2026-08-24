/**
 * Deterministic unit tests on the pure glide math.
 *
 * Per the product doc §7.4, feel is validated by playtesting and these cover
 * only the maths underneath: glide ratio, upgrade effects, and the invariants
 * the rest of the game relies on.
 */

import { describe, expect, it } from 'vitest';

import { GLIDE_TUNING, BASE_GLIDE_STATS } from '../src/constants.js';
import {
  deriveGlideProfile,
  effectiveGlideRatio,
  headingVector,
  launchMotion,
  maxGlideRange,
  sinkRateAt,
  stepGlide,
} from '../src/glide.js';

const DT = 1 / 60;

function glideStraight(profile, { from = 46, steer = 0, pitch = 0, maxSeconds = 120 } = {}) {
  let motion = launchMotion({ x: 0, y: from, z: 0, heading: 0 }, profile);
  let seconds = 0;
  while (motion.y > 0 && seconds < maxSeconds) {
    motion = stepGlide(motion, { steer, pitch }, profile, DT);
    seconds += DT;
  }
  return { motion, seconds, distance: Math.hypot(motion.x, motion.z) };
}

describe('deriveGlideProfile', () => {
  it('produces the base profile from base stats', () => {
    const profile = deriveGlideProfile();
    expect(profile.glideRatio).toBe(GLIDE_TUNING.baseGlideRatio);
    expect(profile.cruiseSpeed).toBe(GLIDE_TUNING.baseCruiseSpeed);
    expect(profile.turnRate).toBe(GLIDE_TUNING.baseTurnRate);
  });

  it('makes every upgrade tier a strict improvement', () => {
    const base = deriveGlideProfile();
    expect(deriveGlideProfile({ distance: 3 }).glideRatio).toBeGreaterThan(base.glideRatio);
    expect(deriveGlideProfile({ agility: 3 }).turnRate).toBeGreaterThan(base.turnRate);
    expect(deriveGlideProfile({ fallControl: 3 }).stallSpeed).toBeLessThan(base.stallSpeed);
  });

  it('never lets stall speed reach zero, however many tiers are stacked', () => {
    expect(deriveGlideProfile({ fallControl: 99 }).stallSpeed).toBeGreaterThan(0);
  });
});

describe('effectiveGlideRatio', () => {
  it('peaks at cruise speed', () => {
    const profile = deriveGlideProfile();
    const atCruise = effectiveGlideRatio(profile.cruiseSpeed, profile);
    expect(atCruise).toBe(profile.glideRatio);
    expect(effectiveGlideRatio(profile.cruiseSpeed + 8, profile)).toBeLessThan(atCruise);
    expect(effectiveGlideRatio(profile.cruiseSpeed - 8, profile)).toBeLessThan(atCruise);
  });

  it('never collapses below the efficiency floor', () => {
    const profile = deriveGlideProfile();
    const floor = profile.glideRatio * GLIDE_TUNING.minGlideEfficiency;
    expect(effectiveGlideRatio(0, profile)).toBeGreaterThanOrEqual(floor);
    expect(effectiveGlideRatio(500, profile)).toBeGreaterThanOrEqual(floor);
  });

  it('flaring lowers the sink rate, which is what makes a soft arrival possible', () => {
    const profile = deriveGlideProfile();
    expect(sinkRateAt(profile.cruiseSpeed * 0.5, profile))
      .toBeLessThan(sinkRateAt(profile.cruiseSpeed, profile));
  });
});

describe('stepGlide', () => {
  it('loses altitude monotonically once the launch hop is spent', () => {
    const profile = deriveGlideProfile();
    let motion = launchMotion({ x: 0, y: 40, z: 0, heading: 0 }, profile);
    for (let i = 0; i < 60; i += 1) motion = stepGlide(motion, {}, profile, DT);

    for (let i = 0; i < 600; i += 1) {
      const next = stepGlide(motion, {}, profile, DT);
      expect(next.y).toBeLessThanOrEqual(motion.y);
      motion = next;
    }
  });

  it('approximates the advertised glide ratio over a full glide', () => {
    const profile = deriveGlideProfile();
    const { distance } = glideStraight(profile, { from: 46 });
    const advertised = maxGlideRange(46, profile);
    // Within 15%: the launch hop adds a little, the initial speed ramp costs a
    // little. The number on the HUD should still mean something.
    expect(distance).toBeGreaterThan(advertised * 0.85);
    expect(distance).toBeLessThan(advertised * 1.15);
  });

  it('flies further with a better distance tier', () => {
    const base = glideStraight(deriveGlideProfile()).distance;
    const upgraded = glideStraight(deriveGlideProfile({ distance: 5 })).distance;
    expect(upgraded).toBeGreaterThan(base);
  });

  it('bounds the turn rate — no instant direction changes', () => {
    const profile = deriveGlideProfile();
    let motion = launchMotion({ x: 0, y: 40, z: 0, heading: 0 }, profile);
    for (let i = 0; i < 240; i += 1) {
      const next = stepGlide(motion, { steer: 1 }, profile, DT);
      const delta = Math.abs(next.heading - motion.heading) / DT;
      expect(delta).toBeLessThanOrEqual(profile.turnRate + 1e-9);
      motion = next;
    }
  });

  it('carries turn momentum: yaw does not stop the instant steering does', () => {
    const profile = deriveGlideProfile();
    let motion = launchMotion({ x: 0, y: 40, z: 0, heading: 0 }, profile);
    for (let i = 0; i < 60; i += 1) motion = stepGlide(motion, { steer: 1 }, profile, DT);
    expect(Math.abs(motion.yawRate)).toBeGreaterThan(0.1);

    const coasting = stepGlide(motion, { steer: 0 }, profile, DT);
    expect(Math.abs(coasting.yawRate)).toBeGreaterThan(0);
    expect(coasting.heading).not.toBe(motion.heading);
  });

  it('falls under gravity when stalled', () => {
    const profile = deriveGlideProfile();
    const stalled = { x: 0, y: 30, z: 0, heading: 0, yawRate: 0, speed: 0, vy: 0 };
    const next = stepGlide(stalled, { pitch: 1 }, profile, DT);
    expect(next.vy).toBeCloseTo(-GLIDE_TUNING.gravity * DT, 6);
  });

  it('caps descent at terminal speed', () => {
    const profile = deriveGlideProfile();
    let motion = { x: 0, y: 1e6, z: 0, heading: 0, yawRate: 0, speed: 0, vy: 0 };
    for (let i = 0; i < 2000; i += 1) motion = stepGlide(motion, { pitch: 1 }, profile, DT);
    expect(motion.vy).toBeGreaterThanOrEqual(-GLIDE_TUNING.terminalFallSpeed);
  });

  it('is frame-rate independent to within a small tolerance', () => {
    const profile = deriveGlideProfile();
    const fly = (dt) => {
      let motion = launchMotion({ x: 0, y: 46, z: 0, heading: 0 }, profile);
      for (let t = 0; t < 6; t += dt) motion = stepGlide(motion, { steer: 0.4 }, profile, dt);
      return motion;
    };
    const at60 = fly(1 / 60);
    const at144 = fly(1 / 144);
    expect(at144.y).toBeCloseTo(at60.y, 0);
    expect(Math.hypot(at144.x, at144.z)).toBeCloseTo(Math.hypot(at60.x, at60.z), 0);
  });

  it('does not mutate the motion it is given', () => {
    const profile = deriveGlideProfile();
    const motion = launchMotion({ x: 0, y: 40, z: 0, heading: 0 }, profile);
    const snapshot = { ...motion };
    stepGlide(motion, { steer: 1, pitch: -1 }, profile, DT);
    expect(motion).toEqual(snapshot);
  });

  it('tolerates missing and out-of-range input', () => {
    const profile = deriveGlideProfile();
    const motion = launchMotion({ x: 0, y: 40, z: 0, heading: 0 }, profile);
    expect(() => stepGlide(motion, undefined, profile, DT)).not.toThrow();
    const wild = stepGlide(motion, { steer: 99, pitch: -99 }, profile, DT);
    const clamped = stepGlide(motion, { steer: 1, pitch: -1 }, profile, DT);
    expect(wild).toEqual(clamped);
  });
});

describe('headingVector', () => {
  it('points along +Z at heading zero', () => {
    const forward = headingVector(0);
    expect(forward.x).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(1, 10);
  });

  it('stays a unit vector', () => {
    for (const heading of [0, 1, -2.5, 7]) {
      const forward = headingVector(heading);
      expect(Math.hypot(forward.x, forward.z)).toBeCloseTo(1, 10);
    }
  });
});

describe('maxGlideRange', () => {
  it('is zero at ground level and never negative', () => {
    const profile = deriveGlideProfile(BASE_GLIDE_STATS);
    expect(maxGlideRange(0, profile)).toBe(0);
    expect(maxGlideRange(-20, profile)).toBe(0);
  });
});
