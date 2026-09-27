/**
 * A minimal "steer at the next tree" pilot, for tests only.
 *
 * This is not game code and does not ship — it exists so the smoke test can
 * fly the real simulation the way a player would, instead of asserting on a
 * hardcoded trajectory that any tuning change would invalidate.
 */

const TWO_PI = Math.PI * 2;

function wrapAngle(angle) {
  return ((angle + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

/**
 * Pick a tree we can still arrive at inside its catch band.
 *
 * Note what this does *not* require: that the target be below us. The pilot
 * happily aims at trees whose perch is above its head, gaining altitude by
 * catching the tree at all — it only needs to arrive above the tree's
 * `minCatchY`. It does, though, aim for the *canopy* catch specifically
 * (arriving within `canopyDepth` of the perch) rather than the bare trunk
 * below it: since LAN-571 a trunk catch scampers up over several real
 * simulated seconds before reaching the perch, and the smoke/run-mode tests
 * that fly this pilot assert the hop resolves the instant it stops gliding.
 * `climb.test.js` exercises the trunk-catch climb directly, with its own
 * hand-built world.
 */
export function chooseTarget(simulation) {
  const { motion } = simulation.glider;
  const glideRatio = simulation.profile.glideRatio;
  let best = null;
  let bestScore = -Infinity;

  for (const tree of simulation.world.trees) {
    if (tree.id === simulation.glider.fromTreeId) continue;

    const dx = tree.position.x - motion.x;
    const dz = tree.position.z - motion.z;
    const range = Math.hypot(dx, dz);
    if (range < 10) continue;

    // Altitude we would arrive with, flying straight there at cruise. The
    // margin absorbs the extra sink that turning costs us.
    const arrivalY = motion.y - range / glideRatio;
    const canopyFloor = Math.max(tree.minCatchY + 3, tree.perchY - tree.canopyDepth);
    if (arrivalY < canopyFloor || arrivalY > tree.perchY) continue;

    const bearing = Math.atan2(dx, dz);
    const turn = Math.abs(wrapAngle(bearing - motion.heading));
    if (turn > Math.PI * 0.6) continue;

    // Chain toward height, the way a player learns to: the best hop is the one
    // that leaves you highest, discounted by how hard it is to line up.
    const score = tree.perchY * 3 - turn * 25 - range * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = tree;
    }
  }
  return best;
}

/** Fill `input` with the steering that heads toward `target`. */
export function steerToward(input, simulation, target) {
  if (!target) {
    input.steer = 0;
    input.pitch = 0;
    return;
  }
  const { motion } = simulation.glider;
  const bearing = Math.atan2(target.position.x - motion.x, target.position.z - motion.z);
  const error = wrapAngle(bearing - motion.heading);
  // Heading decreases as the squirrel turns right, hence the negation.
  input.steer = Math.max(-1, Math.min(1, -error * 2));
  input.pitch = 0;
}
