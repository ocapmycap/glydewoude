/**
 * The rings of a puzzle tree's course, and a marker over its target (LAN-549).
 *
 * Every course's rings are built once, up front, and kept hidden: there are
 * only two or three puzzle trees with three rings each, so building them all
 * costs less than building on demand and never stalls the frame a trial arms.
 *
 * This module only draws. It is told which course is armed and which ring
 * index was just passed; whether a ring *was* passed is decided in `sim/` and
 * arrives here as a plain index, so render never re-checks geometry.
 */

import {
  ConeGeometry,
  Group,
  Mesh,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';

import { PALETTE, outlineMaterial, toonMaterial } from './materials.js';

const TUBE = 0.2;
const OUTLINE_TUBE = TUBE + 0.07;
/** Passed rings stay faintly visible so the player can see the line they flew. */
const PASSED_OPACITY = 0.3;

/** Height of the target marker's tip above the target's perch. */
const MARKER_LIFT = 3.2;

/** A torus's axis is +Z; a ring faces along its `normal`. */
const TORUS_AXIS = new Vector3(0, 0, 1);

/**
 * @param {import('three').Scene} scene
 * @param {{trees: object[]}} world
 */
export function createRings(scene, world) {
  const root = new Group();
  root.name = 'puzzle-rings';

  const materials = {
    ahead: toonMaterial(PALETTE.ring),
    next: toonMaterial(PALETTE.ringNext),
    passed: toonMaterial(PALETTE.ring, { transparent: true, opacity: PASSED_OPACITY }),
  };
  const outline = outlineMaterial();

  const treesById = new Map(world.trees.map((tree) => [tree.id, tree]));
  /** @type {Map<string, {group: Group, rings: Array<{body: Mesh, hull: Mesh}>, target: object}>} */
  const courses = new Map();
  const quaternion = new Quaternion();
  const normal = new Vector3();

  for (const tree of world.trees) {
    if (!tree.course) continue;
    const group = new Group();
    group.visible = false;
    const rings = tree.course.rings.map((ring) => {
      const body = new Mesh(new TorusGeometry(ring.radius, TUBE, 10, 40), materials.ahead);
      const hull = new Mesh(new TorusGeometry(ring.radius, OUTLINE_TUBE, 10, 40), outline);
      quaternion.setFromUnitVectors(TORUS_AXIS, normal.set(ring.normal.x, ring.normal.y, ring.normal.z));
      for (const mesh of [body, hull]) {
        mesh.position.set(ring.center.x, ring.center.y, ring.center.z);
        mesh.quaternion.copy(quaternion);
        group.add(mesh);
      }
      return { body, hull };
    });
    root.add(group);
    courses.set(tree.id, { group, rings, target: treesById.get(tree.course.targetTreeId) });
  }

  // One marker, moved to whichever target is armed: an upside-down cone
  // hanging over the perch, pointing down at where to land (D-55).
  const marker = new Group();
  const markerGeometry = new ConeGeometry(0.7, 1.8, 12);
  markerGeometry.rotateX(Math.PI);
  const markerHull = new Mesh(markerGeometry, outline);
  markerHull.scale.setScalar(1.15);
  marker.add(markerHull, new Mesh(markerGeometry, toonMaterial(PALETTE.ringNext)));
  marker.visible = false;
  root.add(marker);

  scene.add(root);

  /** @type {?{group: Group, rings: Array<{body: Mesh, hull: Mesh}>}} */
  let active = null;

  function paint(nextIndex) {
    active.rings.forEach(({ body, hull }, index) => {
      if (index < nextIndex) {
        body.material = materials.passed;
        hull.visible = false;
      } else {
        body.material = index === nextIndex ? materials.next : materials.ahead;
        hull.visible = true;
      }
    });
  }

  function hide() {
    if (active) active.group.visible = false;
    active = null;
    marker.visible = false;
  }

  return {
    object: root,

    /** Show `puzzleTreeId`'s course with its first ring highlighted. */
    show(puzzleTreeId) {
      hide();
      const course = courses.get(puzzleTreeId);
      if (!course) return;
      active = course;
      active.group.visible = true;
      paint(0);
      if (course.target) {
        marker.position.set(
          course.target.position.x,
          course.target.perchY + MARKER_LIFT,
          course.target.position.z,
        );
        marker.visible = true;
      }
    },

    /** Ring `index` was passed: dim it and highlight the one after. */
    pass(index) {
      if (active) paint(index + 1);
    },

    hide,
  };
}
