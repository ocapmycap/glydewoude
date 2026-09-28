/**
 * A tall, soft column of light above each puzzle tree (LAN-578), so a trial
 * pulls the eye from across the forest the way the product doc wants a
 * destination to (§2.3) without the player having to already be close enough
 * to read its ring course or its label.
 *
 * Two nested open-ended cylinders per tree — a narrow bright core and a
 * wider, dimmer shell — drawn `fog: false` so they show at any range, with
 * `AdditiveBlending` so overlapping beacons only ever brighten, never muddy.
 * Each fades to transparent at its top via a 4-component vertex colour
 * (three r180 reads vertex alpha as well as RGB once `transparent` is set),
 * baked once into the shared geometry rather than recomputed per tree. The
 * gentle pulse rides on top as a shared material opacity, driven by the
 * absolute clock rather than an accumulated delta — a sine wave of wall time
 * cannot drift, so there is nothing to reset when a beacon is hidden and
 * shown again.
 *
 * Only two or three puzzle trees exist in a default forest (PUZZLE_CONFIG),
 * so this is a handful of meshes, not an instanced pool like wind.js or
 * leaf-burst.js.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { TREE_TYPES } from '@glidewood/shared';

import { PALETTE } from './materials.js';

/**
 * @typedef {object} BeaconDials
 * @property {number} heightM           column height above the canopy, metres
 * @property {number} coreRadiusM       narrow bright cylinder's radius, metres
 * @property {number} outerRadiusM      wider soft shell's radius, metres
 * @property {number} radialSegments    facets round the cylinder
 * @property {number} heightSegments    vertical rings, for a smoother alpha fade
 * @property {number} baseClearanceM    clearance above the canopy top before the column starts
 * @property {number} pulsePeriodS      seconds per pulse cycle
 * @property {[number, number]} coreOpacityRange   never 0 or 1 — a glow, not a flash
 * @property {[number, number]} outerOpacityRange
 */

/** @type {BeaconDials} */
const BEACON = Object.freeze({
  heightM: 60,
  coreRadiusM: 3,
  outerRadiusM: 5.5,
  radialSegments: 12,
  heightSegments: 8,
  baseClearanceM: 3,
  pulsePeriodS: 2,
  coreOpacityRange: Object.freeze([0.55, 0.8]),
  outerOpacityRange: Object.freeze([0.25, 0.45]),
});

function lerp(min, max, t) {
  return min + (max - min) * t;
}

/**
 * An open-ended cylinder from local y=0 (base) to y=`height` (top), with a
 * 4-component vertex colour fading alpha from 1 at the base to 0 at the top.
 * Colour channels stay white; the material's own colour supplies the hue, so
 * the vertex data only ever needs to carry the fade.
 */
function beaconGeometry(radius, height, { radialSegments, heightSegments }) {
  const geometry = new CylinderGeometry(radius, radius, height, radialSegments, heightSegments, true);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i += 1) {
    // Cylinder geometry is built centred on the origin, from -height/2 to
    // height/2, before the translate below moves it to base-at-zero.
    const climbFraction = (position.getY(i) + height / 2) / height;
    colors[i * 4] = 1;
    colors[i * 4 + 1] = 1;
    colors[i * 4 + 2] = 1;
    colors[i * 4 + 3] = 1 - climbFraction;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 4));
  geometry.translate(0, height / 2, 0);
  return geometry;
}

function beaconMaterial(opacity) {
  return new MeshBasicMaterial({
    color: PALETTE.beacon,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    opacity,
    // Fog would swallow the whole point of a beacon that should read across
    // the forest.
    fog: false,
  });
}

/**
 * @param {import('three').Scene} scene
 * @param {{trees: Array<object>}} world
 * @param {{now?: () => number}} [options]
 */
export function createBeacons(scene, world, { now = () => performance.now() / 1000 } = {}) {
  const root = new Group();
  root.name = 'puzzle-beacons';

  const coreGeometry = beaconGeometry(BEACON.coreRadiusM, BEACON.heightM, BEACON);
  const outerGeometry = beaconGeometry(BEACON.outerRadiusM, BEACON.heightM, BEACON);
  // Shared materials: every beacon pulses in lockstep, so one opacity write
  // a frame covers all of them rather than one write per tree.
  const coreMaterial = beaconMaterial(BEACON.coreOpacityRange[1]);
  const outerMaterial = beaconMaterial(BEACON.outerOpacityRange[1]);

  function pulse() {
    const t = now();
    const wave = (Math.sin((2 * Math.PI * t) / BEACON.pulsePeriodS) * 0.5) + 0.5;
    coreMaterial.opacity = lerp(...BEACON.coreOpacityRange, wave);
    outerMaterial.opacity = lerp(...BEACON.outerOpacityRange, wave);
  }

  /** @type {Map<string, {group: Group}>} */
  const beacons = new Map();

  for (const tree of world.trees) {
    if (tree.type !== TREE_TYPES.PUZZLE) continue;

    const canopyTopY = tree.perchY == null ? tree.position.y + tree.trunkHeight : tree.perchY;
    const group = new Group();
    group.position.set(tree.position.x, canopyTopY + BEACON.baseClearanceM, tree.position.z);

    const outer = new Mesh(outerGeometry, outerMaterial);
    const core = new Mesh(coreGeometry, coreMaterial);
    // Every mesh's onBeforeRender re-samples the same absolute clock, so the
    // pulse stays correct as long as at least one beacon is visible, however
    // many are individually hidden.
    outer.onBeforeRender = pulse;
    core.onBeforeRender = pulse;
    group.add(outer, core);

    root.add(group);
    beacons.set(tree.id, { group });
  }

  scene.add(root);

  return {
    /** Hide one puzzle tree's beacon — its trial is armed, so the rings take over. */
    hide(treeId) {
      const beacon = beacons.get(treeId);
      if (beacon) beacon.group.visible = false;
    },

    /** Show every beacon again — nothing is currently armed. */
    showAll() {
      for (const beacon of beacons.values()) beacon.group.visible = true;
    },
  };
}
