/**
 * The squirrel.
 *
 * A handful of low-poly boxes and cones with inverted-hull outlines. The doc
 * reserves the custom toon shader with rim light for the Phase 4 art pass
 * (§5.1), so this deliberately stops at "readable silhouette that shows you
 * which way you are pointing and whether your wings are out".
 */

import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MathUtils,
  SphereGeometry,
} from 'three';

import { PALETTE, outlineMaterial, toonMaterial } from './materials.js';

const OUTLINE_SCALE = 1.09;

/** A mesh plus its inverted hull, as one group. */
function outlined(geometry, color) {
  const group = new Group();
  const mesh = new Mesh(geometry, toonMaterial(color));
  const hull = new Mesh(geometry, outlineMaterial());
  hull.scale.setScalar(OUTLINE_SCALE);
  group.add(hull, mesh);
  return group;
}

export function createSquirrel() {
  const root = new Group();
  root.name = 'squirrel';
  // Slightly larger than life: at chase-camera distance a true-to-scale
  // squirrel is a few pixels of brown.
  root.scale.setScalar(1.35);

  // Every part hangs off `pose` rather than `root`, so the cling pose can
  // tip the whole animal up the bark in the squirrel's own frame. The
  // renderer owns root's heading and pitch; this module owns pose.
  const pose = new Group();
  root.add(pose);

  // Body, nose-forward along +Z to match the simulation's heading convention.
  const body = outlined(new BoxGeometry(0.55, 0.5, 1.15), PALETTE.squirrelBody);
  pose.add(body);

  const belly = new Mesh(
    new BoxGeometry(0.4, 0.18, 0.9),
    toonMaterial(PALETTE.squirrelBelly),
  );
  belly.position.set(0, -0.22, 0.05);
  pose.add(belly);

  const head = outlined(new SphereGeometry(0.32, 8, 6), PALETTE.squirrelBody);
  head.position.set(0, 0.16, 0.68);
  pose.add(head);

  for (const side of [-1, 1]) {
    const ear = outlined(new ConeGeometry(0.12, 0.26, 5), PALETTE.squirrelBody);
    ear.position.set(side * 0.16, 0.45, 0.66);
    pose.add(ear);
  }

  // Kept narrow: the chase camera looks straight up the squirrel's back, and
  // a broad tail from that angle hides the whole animal.
  const tail = outlined(new BoxGeometry(0.28, 0.5, 1.05), PALETTE.squirrelBody);
  tail.position.set(0, 0.3, -0.86);
  tail.rotation.x = -0.55;
  pose.add(tail);

  // The patagium — the gliding membrane between the limbs. It is the clearest
  // read on "am I gliding right now", so it animates rather than being static.
  const membranes = [-1, 1].map((side) => {
    const membrane = outlined(new BoxGeometry(0.9, 0.06, 1.1), PALETTE.squirrelMembrane);
    membrane.position.set(side * 0.62, -0.05, 0.02);
    pose.add(membrane);
    return { membrane, side };
  });

  // Legs only show while clinging. In flight they are inside the membrane,
  // and on a perch the tucked membrane already reads as folded limbs.
  const limbs = [];
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      const limb = outlined(new BoxGeometry(0.14, 0.12, 0.42), PALETTE.squirrelBody);
      limb.position.set(side * 0.42, -0.2, end * 0.4);
      // Splayed out diagonally, front paws reaching up and hind paws down
      // once the pose tips the body onto the bark.
      limb.rotation.y = side * end * 0.75;
      limb.visible = false;
      pose.add(limb);
      limbs.push(limb);
    }
  }

  /** 0 = normal, 1 = flat against a trunk. Eased so the grab reads as a motion. */
  let cling = 0;

  return {
    object: root,
    /**
     * @param {number} spread    0 = tucked on a branch, 1 = fully deployed
     * @param {number} bank      radians of roll, from the current turn rate
     * @param {boolean} [clinging] flat against a towering trunk. The root must
     *   face the trunk (the sim's cling heading already does) and sit on its
     *   surface; the pose lifts the belly off the root onto the bark.
     */
    update(spread, bank, clinging = false) {
      root.rotation.z = MathUtils.lerp(root.rotation.z, bank, 0.15);
      cling = MathUtils.lerp(cling, clinging ? 1 : 0, 0.25);

      // Nose up the trunk, belly to the bark (+Z is toward the trunk), and
      // flattened across the back so it hugs the bark rather than perching.
      pose.rotation.x = -Math.PI / 2 * cling;
      pose.scale.y = MathUtils.lerp(1, 0.72, cling);
      pose.position.z = -0.24 * cling;

      const gripping = cling > 0.5;
      for (const limb of limbs) limb.visible = gripping;

      for (const { membrane, side } of membranes) {
        membrane.visible = !gripping;
        const target = MathUtils.lerp(0.18, 1, spread);
        membrane.scale.x = MathUtils.lerp(membrane.scale.x, target, 0.2);
        membrane.position.x = side * MathUtils.lerp(0.28, 0.62, spread);
        membrane.rotation.z = side * MathUtils.lerp(0.6, -0.08, spread);
      }
      // Clinging, the tail lies down the bark rather than angling off it.
      const tailTarget = MathUtils.lerp(-0.5 - spread * 0.35, -0.3, cling);
      tail.rotation.x = MathUtils.lerp(tail.rotation.x, tailTarget, 0.1);
    },
  };
}
