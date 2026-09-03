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
 * launch branch.
 *
 * That one rule is what makes the loop sustainable. A glide only ever loses
 * altitude, so something has to give it back, and a tall trunk is it: aim low
 * at a big tree, catch it at 12 metres, climb to 34, and glide again. Height
 * is a place, not a resource — which is also why Phase 1 needs no flap move to
 * keep the loop going.
 */
export function treeCatches(tree, position) {
  if (position.y > tree.perchY || position.y < tree.minCatchY) return false;
  const horizontal = distance2D(tree.position, position);
  const inCanopy = position.y >= tree.perchY - tree.canopyDepth;
  return horizontal <= (inCanopy ? tree.perchRadius : tree.catchRadius);
}

/**
 * Resolve a single simulation step's movement against the world.
 *
 * At 60 Hz a step moves well under a metre, and the narrowest catch volume is
 * several metres across, so a point test on the new position is sufficient —
 * there is nothing thin enough to tunnel through.
 *
 * @returns {{tree: object, reason: 'perch'|'ground'}|null}
 */
export function resolveLanding(world, previous, next, fromTreeId = null) {
  if (next.y <= world.config.groundY) {
    // Ground contact is a soft reset: climb whatever is closest.
    const tree = nearestTree(world.trees, next) ?? world.trees[0];
    return { tree, reason: 'ground' };
  }

  for (const tree of world.trees) {
    // Don't immediately re-catch the tree we just launched from.
    if (tree.id === fromTreeId && previous.y >= tree.minCatchY) {
      const horizontal = distance2D(tree.position, next);
      if (horizontal <= tree.perchRadius + 0.5) continue;
    }
    if (treeCatches(tree, next)) {
      return { tree, reason: 'perch' };
    }
  }
  return null;
}
