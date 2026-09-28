/**
 * The squirrel's state machine.
 *
 * Four states — `perched`, `gliding`, `clinging` (LAN-554: caught the side of
 * a towering trunk mid-glide, rather than reaching its perch, because
 * towering trees don't have one), and `climbing` (LAN-571: caught the bare
 * trunk of an ordinary tree below its canopy band, and scampers up to the
 * perch rather than teleporting there). There is no crash state and no
 * death: see the note in `landing.js`.
 *
 * Pure functions over a plain state object. Nothing here imports Three.js, so
 * the whole machine runs in Node under Vitest.
 */

import { launchMotion, stepGlide } from '@glidewood/shared';

export const GliderPhase = Object.freeze({
  PERCHED: 'perched',
  GLIDING: 'gliding',
  CLINGING: 'clinging',
  CLIMBING: 'climbing',
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
  // Strip any in-progress about-face (LAN-577): a fresh perch later must not
  // resume a stale turn left over from before this glide.
  const rest = { ...glider };
  delete rest.perchTurn;
  return {
    ...rest,
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

/**
 * Where a climb heads, decided once from the catch point and then fixed for
 * the rest of the climb (`climbFrom` stores the result as `climbTarget`,
 * since recomputing it from the *current* position every tick can't tell "was
 * always this close" apart from "has been climbing in for a while").
 *
 * A catch already on the bark — horizontal distance `tree.trunkRadius` from
 * the centre, which is exactly where a trunk catch (LAN-571) lands, and where
 * every tree in the unit tests below sits when they omit `trunkRadius`
 * entirely — has nowhere to climb in *to*: the target is the catch point's
 * own x/z, unchanged, so the climb is a plain vertical rise, bit-for-bit what
 * shipped before canopy catches could land off the bark (LAN-579).
 *
 * A catch farther out — out in the foliage, off the bark — heads straight for
 * the perch itself (dead centre) rather than stopping partway at the bark.
 * That is what keeps the final hand-off to `perchOn` a continuation of the
 * same straight line instead of a separate jump: stopping at the bark first
 * would still leave a `trunkRadius`-sized snap to the centre at the very top,
 * which for a squirrel that started metres out in the canopy would badly
 * overshoot `profile.climbSpeed` on that last tick.
 */
function trunkClimbTarget(tree, point) {
  const dx = point.x - tree.position.x;
  const dz = point.z - tree.position.z;
  const radius = Math.hypot(dx, dz);
  const trunkRadius = tree.trunkRadius ?? radius;
  if (radius <= trunkRadius) return { x: point.x, z: point.z };
  return { x: tree.position.x, z: tree.position.z };
}

/**
 * Catch a tree below its perch, at `point`, facing back at its centre like a
 * cling. Unlike a cling this is not the end of the line — there is a perch
 * above to scamper up to (LAN-571) — so the flight heading is kept as
 * `perchHeading`, for `stepClimb` to hand the squirrel once the climb tops
 * out, the same heading `landOn` would have used for a direct catch.
 *
 * `point` may be on the bare trunk (a LAN-571 side catch, already at
 * `tree.trunkRadius`) or out in the foliage (a LAN-579 canopy catch, still
 * some distance from the bark) — `stepClimb` closes the gap either way.
 *
 * With a `profile` (LAN-579), the climb also gets a fixed `climbRate`: no
 * faster than `profile.climbSpeed`, but capped so the climb takes at least
 * `profile.minClimbDuration` even when the catch point is right on top of the
 * target — otherwise a catch a few centimetres short would finish in a
 * single tick, reading as a teleport rather than a climb. Omitting `profile`
 * (the pre-LAN-579 call shape) leaves `climbRate` unset, so `stepClimb` falls
 * back to `profile.climbSpeed` every step, as before.
 */
export function climbFrom(glider, tree, point, profile) {
  const centre = tree.position;
  const climbTarget = trunkClimbTarget(tree, point);
  const base = {
    phase: GliderPhase.CLIMBING,
    treeId: tree.id,
    perchHeading: glider.motion.heading,
    climbTarget,
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
  if (!profile) return base;

  const pathLength = Math.hypot(climbTarget.x - point.x, tree.perchY - point.y, climbTarget.z - point.z);
  const climbRate = Math.min(profile.climbSpeed, pathLength / profile.minClimbDuration);
  return { ...base, climbRate };
}

/**
 * Advance a climb by `dt`. Moves in a straight line toward `glider.climbTarget`
 * (the fixed x/z `climbFrom` chose) and up to the perch, at `glider.climbRate`
 * if `climbFrom` set one, else `profile.climbSpeed`; once it reaches the
 * target it hands off to `perchOn` directly rather than overshooting, using
 * the heading the squirrel was flying when it was caught (LAN-571). Heading is
 * kept facing the trunk centre throughout, recomputed as x/z moves in (guarded
 * against the dead-centre case where that direction is undefined). Pure —
 * does not mutate `glider`.
 */
export function stepClimb(glider, tree, profile, dt) {
  const rate = glider.climbRate ?? profile.climbSpeed;
  const target = glider.climbTarget ?? trunkClimbTarget(tree, glider.motion);
  const dx = target.x - glider.motion.x;
  const dy = tree.perchY - glider.motion.y;
  const dz = target.z - glider.motion.z;
  const distance = Math.hypot(dx, dy, dz);

  const step = rate * dt;
  if (distance === 0 || step >= distance) {
    return { ...perchOn(tree, glider.perchHeading ?? glider.motion.heading), glide: glider.glide };
  }

  const x = glider.motion.x + (dx / distance) * step;
  const y = glider.motion.y + (dy / distance) * step;
  const z = glider.motion.z + (dz / distance) * step;

  const centre = tree.position;
  const hdx = centre.x - x;
  const hdz = centre.z - z;
  const heading = hdx === 0 && hdz === 0 ? glider.motion.heading : Math.atan2(hdx, hdz);

  return {
    ...glider,
    motion: {
      ...glider.motion,
      x,
      y,
      z,
      heading,
      vy: (dy / distance) * rate,
    },
  };
}

/**
 * Turn the squirrel in place while perched (LAN-577).
 *
 * No-op off the perch — clinging and climbing still ignore steer and pitch
 * entirely. While perched, `input.steer` spins the squirrel at
 * `profile.perchTurnRate`, right decreasing heading like every other turn in
 * this game. A back-tap (`input.aboutFace`, the rising edge of pitch >= 0.5,
 * detected by the caller) instead plays a scripted half-turn of exactly π
 * toward increasing heading over `profile.aboutFaceDuration`, ignoring steer
 * for as long as it is in progress. The remaining about-face angle is kept on
 * the glider as `perchTurn` (read as `glider.perchTurn ?? 0`, so `perchOn` and
 * `landOn` need no change to start every perch with none in progress) —
 * `input.aboutFace` only matters to *start* a new one; once `perchTurn > 0`
 * the turn already in progress keeps going regardless of what the input says
 * this step, so holding the key down does not restart it every tick.
 */
export function stepPerch(glider, input, profile, dt) {
  if (glider.phase !== GliderPhase.PERCHED) return glider;

  let remaining = glider.perchTurn ?? 0;
  if (remaining <= 0 && input.aboutFace) remaining = Math.PI;

  if (remaining > 0) {
    const step = Math.min(remaining, (Math.PI / profile.aboutFaceDuration) * dt);
    return {
      ...glider,
      perchTurn: remaining - step,
      motion: { ...glider.motion, heading: wrapHeading(glider.motion.heading + step) },
    };
  }

  const steer = Math.max(-1, Math.min(1, input.steer ?? 0));
  return {
    ...glider,
    perchTurn: 0,
    motion: {
      ...glider.motion,
      heading: wrapHeading(glider.motion.heading - steer * profile.perchTurnRate * dt),
    },
  };
}

/** Land on a tree, keeping the finished glide's stats for the HUD. */
export function landOn(glider, tree) {
  return {
    ...perchOn(tree, glider.motion.heading),
    glide: glider.glide,
  };
}
