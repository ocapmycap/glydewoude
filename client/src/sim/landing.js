/**
 * Where a glide ends.
 *
 * Landing is deliberately generous. The product doc's pillar is "floaty and
 * forgiving rather than twitchy", so there is no descent-rate gate, no crash
 * state and no failure: the squirrel catches bark at any speed, and hitting
 * the ground just means scampering up the nearest trunk. Phase 1's job is to
 * find out whether the glide feels good, and punishing landings would only
 * add noise to that answer.
 *
 * Pure — takes state, returns a description of what happened.
 */

import { distance2D, nearestTree } from '@glidewood/shared';

/**
 * A tree catches the squirrel if the new position is inside either of its two
 * catch volumes, which are shaped like what the player can actually see:
 *
 *   - the canopy: a wide blob just below the perch, for dropping in from above
 *   - the trunk: a narrow cylinder from `minCatchY` up to the canopy, for
 *     flying into the side of the tree
 *
 * Either way the squirrel ends up on the perch at the top — squirrels climb,
 * so catching bark anywhere on the upper trunk means scampering up to the
 * launch branch. A canopy catch drops the squirrel there directly; a bare
 * trunk catch scampers up first, in view, before it's perched (LAN-571).
 *
 * That one rule is what makes the loop sustainable. A glide only ever loses
 * altitude, so something has to give it back, and a tall trunk is it: aim low
 * at a big tree, catch it at 12 metres, climb to 34, and glide again. Height
 * is a place, not a resource — which is also why Phase 1 needs no flap move to
 * keep the loop going.
 */
export function treeCatches(tree, position) {
  // Towering trees have no perch to climb to. perchY is null on them, so
  // this has to be explicit rather than relying on `position.y > null`
  // coercing null to 0. Flying into the trunk instead of past it is
  // `clingPoint` below, checked separately by `resolveLanding`.
  if (tree.towering) return false;
  if (position.y > tree.perchY || position.y < tree.minCatchY) return false;
  const horizontal = distance2D(tree.position, position);
  const inCanopy = position.y >= tree.perchY - tree.canopyDepth;
  return horizontal <= (inCanopy ? tree.perchRadius : tree.catchRadius);
}

/**
 * Project a catch onto the trunk's bark, on the side the squirrel is coming
 * from: straight out from the centre along the direction to `next`, falling
 * back to the direction to `previous` and then +Z so a hit dead-centre on
 * the trunk's axis never divides by zero. Shared by the towering cling catch
 * and the ordinary-tree trunk catch (LAN-571) — both put the squirrel on the
 * bark at the height it was actually caught, not the tree's centre line.
 */
function trunkSurfacePoint(tree, previous, next) {
  let dx = next.x - tree.position.x;
  let dz = next.z - tree.position.z;
  if (dx === 0 && dz === 0) {
    dx = previous.x - tree.position.x;
    dz = previous.z - tree.position.z;
  }
  if (dx === 0 && dz === 0) {
    dz = 1;
  }
  const length = Math.hypot(dx, dz);
  return {
    x: tree.position.x + (dx / length) * tree.trunkRadius,
    y: next.y,
    z: tree.position.z + (dz / length) * tree.trunkRadius,
  };
}

/**
 * Where a towering trunk catches the squirrel, or null if this step missed
 * it (LAN-554).
 *
 * A towering tree has no perch and so no climbable canopy volume — the whole
 * trunk, from the ground up to its top, is bark a squirrel can grab, with no
 * `minCatchY` floor the way an ordinary tree's side-catch has.
 */
function clingPoint(tree, previous, next) {
  if (distance2D(tree.position, next) > tree.catchRadius) return null;
  if (next.y > tree.position.y + tree.trunkHeight) return null;
  return trunkSurfacePoint(tree, previous, next);
}

/**
 * Resolve a single simulation step's movement against the world.
 *
 * At 60 Hz a step moves well under a metre, and the narrowest catch volume is
 * several metres across, so a point test on the new position is sufficient —
 * there is nothing thin enough to tunnel through.
 *
 * @returns {{tree: object, reason: 'perch'|'ground', climbFrom?: {x: number, y: number, z: number}}|{tree: object, reason: 'cling', point: {x: number, y: number, z: number}}|null}
 */
export function resolveLanding(world, previous, next, fromTreeId = null) {
  if (next.y <= world.config.groundY) {
    // Ground contact is a soft reset: climb whatever is closest. Towering
    // trees cannot be climbed, so they are excluded from the search.
    const climbable = world.trees.filter((candidate) => !candidate.towering);
    const tree = nearestTree(climbable, next) ?? climbable[0] ?? world.trees[0];
    return { tree, reason: 'ground' };
  }

  for (const tree of world.trees) {
    if (tree.towering) {
      // Towering trunks are always skipped while they are the tree just
      // launched from — unlike the ordinary-tree guard below there is no
      // perch to put distance from, so there is nothing to measure.
      if (tree.id === fromTreeId) continue;
      const point = clingPoint(tree, previous, next);
      if (point) return { tree, reason: 'cling', point };
      continue;
    }

    // Don't immediately re-catch the tree we just launched from.
    if (tree.id === fromTreeId && previous.y >= tree.minCatchY) {
      const horizontal = distance2D(tree.position, next);
      if (horizontal <= tree.perchRadius + 0.5) continue;
    }
    if (treeCatches(tree, next)) {
      // Below the canopy band is bare trunk, not the canopy blob — a climb up
      // to the perch, not a drop straight onto it (LAN-571).
      if (next.y < tree.perchY - tree.canopyDepth) {
        return { tree, reason: 'perch', climbFrom: trunkSurfacePoint(tree, previous, next) };
      }
      return { tree, reason: 'perch' };
    }
  }
  return null;
}
