/**
 * The squirrel's state machine.
 *
 * Two states in Phase 1 — `perched` and `gliding`. There is no crash state and
 * no death: see the note in `landing.js`.
 *
 * Pure functions over a plain state object. Nothing here imports Three.js, so
 * the whole machine runs in Node under Vitest.
 */

import { launchMotion, stepGlide } from '@glidewood/shared';

export const GliderPhase = Object.freeze({
  PERCHED: 'perched',
  GLIDING: 'gliding',
});

/** Put the squirrel on a tree's launch branch, facing `heading`. */
export function perchOn(tree, heading = 0) {
  return {
    phase: GliderPhase.PERCHED,
    treeId: tree.id,
    motion: {
      x: tree.position.x,
      y: tree.perchY,
      z: tree.position.z,
      heading,
      yawRate: 0,
      speed: 0,
      vy: 0,
    },
    /** Stats of the glide in progress, or the most recent one. */
    glide: null,
  };
}

/** Begin a glide from the current perch. No-op if already airborne. */
export function launch(glider, profile, tuning) {
  if (glider.phase !== GliderPhase.PERCHED) return glider;
  return {
    ...glider,
    phase: GliderPhase.GLIDING,
    treeId: null,
    fromTreeId: glider.treeId,
    motion: launchMotion(glider.motion, profile, tuning),
    glide: {
      startX: glider.motion.x,
      startZ: glider.motion.z,
      startY: glider.motion.y,
      distance: 0,
      altitudeLost: 0,
      duration: 0,
    },
  };
}

/**
 * Advance the airborne squirrel by `dt`. Returns the new glider state plus the
 * previous motion, so the caller can resolve landings against the movement.
 */
export function stepAirborne(glider, input, profile, dt, tuning) {
  const previous = glider.motion;
  const motion = stepGlide(previous, input, profile, dt, tuning);
  const glide = {
    ...glider.glide,
    distance: Math.hypot(motion.x - glider.glide.startX, motion.z - glider.glide.startZ),
    altitudeLost: Math.max(0, glider.glide.startY - motion.y),
    duration: glider.glide.duration + dt,
  };
  return { glider: { ...glider, motion, glide }, previous };
}

/** Land on a tree, keeping the finished glide's stats for the HUD. */
export function landOn(glider, tree) {
  return {
    ...perchOn(tree, glider.motion.heading),
    glide: glider.glide,
  };
}
