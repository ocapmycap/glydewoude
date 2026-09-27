/**
 * The squirrel's state machine.
 *
 * Three states — `perched`, `gliding`, and `clinging` (LAN-554: caught the
 * side of a towering trunk mid-glide, rather than reaching its perch, because
 * towering trees don't have one). There is no crash state and no death: see
 * the note in `landing.js`.
 *
 * Pure functions over a plain state object. Nothing here imports Three.js, so
 * the whole machine runs in Node under Vitest.
 */

import { launchMotion, stepGlide } from '@glidewood/shared';

export const GliderPhase = Object.freeze({
  PERCHED: 'perched',
  GLIDING: 'gliding',
  CLINGING: 'clinging',
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

/** Wrap a heading into (-π, π], the range every heading in this module uses. */
function wrapHeading(heading) {
  const turn = Math.PI * 2;
  let wrapped = heading % turn;
  if (wrapped > Math.PI) wrapped -= turn;
  if (wrapped <= -Math.PI) wrapped += turn;
  return wrapped;
}

/**
 * Begin a glide from the current perch or cling. No-op if already airborne.
 *
 * A cling has no forward-facing branch to push off from, so the launch turns
 * the squirrel around first — straight away from the trunk it was clinging
 * to — then hands off to the same `launchMotion` a perch uses, for the same
 * speed and hop.
 */
export function launch(glider, profile, tuning) {
  const fromCling = glider.phase === GliderPhase.CLINGING;
  if (glider.phase !== GliderPhase.PERCHED && !fromCling) return glider;
  const startMotion = fromCling
    ? { ...glider.motion, heading: wrapHeading(glider.motion.heading + Math.PI) }
    : glider.motion;
  return {
    ...glider,
    phase: GliderPhase.GLIDING,
    treeId: null,
    fromTreeId: glider.treeId,
    motion: launchMotion(startMotion, profile, tuning),
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

/**
 * Catch the side of a towering trunk at `point`, facing back at its centre.
 * Unlike a perch this is not a place to stand still and admire the view —
 * there is no launch branch here, just bark — so speed and vertical motion
 * both stop dead until the squirrel pushes off again.
 */
export function clingTo(glider, tree, point) {
  const centre = tree.position;
  return {
    phase: GliderPhase.CLINGING,
    treeId: tree.id,
    motion: {
      x: point.x,
      y: point.y,
      z: point.z,
      heading: Math.atan2(centre.x - point.x, centre.z - point.z),
      yawRate: 0,
      speed: 0,
      vy: 0,
    },
    glide: glider.glide,
  };
}

/** Land on a tree, keeping the finished glide's stats for the HUD. */
export function landOn(glider, tree) {
  return {
    ...perchOn(tree, glider.motion.heading),
    glide: glider.glide,
  };
}
