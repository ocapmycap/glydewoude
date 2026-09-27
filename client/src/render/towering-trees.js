/**
 * Towering trees — the few giants that rise far above the forest (LAN-553)
 * and that the squirrel clings to rather than perches on (LAN-554).
 *
 * Split out of trees.js the way great-tree.js was (D-44). They share its bark
 * texture and canopy geometry, but not its placement maths: a towering tree
 * has no perch (`perchY: null`), so its canopy hangs off the top of the trunk
 * instead. There are only a handful, but they are still instanced — four
 * draw calls for all of them — so a bigger `TOWERING_TREE_CONFIG.count`
 * costs nothing extra.
 *
 * The look is ambience, not gameplay (D-67): darker, cooler bark than any
 * ordinary tree, and an upper trunk and canopy tinted toward the fog colour,
 * so the eye reads them as further away and older and the tops fade into the
 * sky rather than stopping at an outline.
 */

import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Object3D,
} from 'three';
import { createRng, hashSeed, randRange } from '@glidewood/shared';

import { PALETTE, mixColor, outlineMaterial, toonMaterial } from './materials.js';

/** How much bigger the inverted hull is than the mesh it outlines. */
const OUTLINE_SCALE = 1.035;

/** Enough sides that the cling point, set on a true circle, sits on the bark. */
const TRUNK_RADIAL_SEGMENTS = 16;
const TRUNK_HEIGHT_SEGMENTS = 10;

/**
 * The trunk keeps its full `trunkRadius` up to this fraction of its height,
 * then tapers to `TRUNK_TOP_RADIUS` at the top.
 *
 * The cling point is always exactly `trunkRadius` out from the centre
 * (landing.js), so tapering the reachable part of the trunk would leave the
 * squirrel hanging in the air. Nothing launches higher than the great tree's
 * 46 m perch, and a towering trunk is at least 85 m tall (D-64), so the
 * bottom 55% is all the bark a squirrel can ever touch.
 */
const TRUNK_STRAIGHT_FRACTION = 0.55;
const TRUNK_TOP_RADIUS = 0.62;

/**
 * Above this fraction of the height, bark and outline blend toward the fog
 * colour, reaching `TRUNK_TOP_HAZE` at the top. Scene fog is by distance, not
 * height, so on its own it barely touches the top of a trunk 150 m away.
 */
const TRUNK_HAZE_START = 0.35;
const TRUNK_TOP_HAZE = 0.72;

/** Canopies are hazier still: they sit above everything else. */
const CANOPY_HAZE = 0.42;
const CANOPY_OUTLINE_HAZE = 0.6;

/**
 * Canopy blobs, as offsets in canopy-radius units from the top of the trunk.
 * Wide and flat, so from the forest floor it reads as a roof far overhead
 * rather than a ball on a stick.
 */
const CANOPY_BLOBS = [
  { x: 0, y: 0.1, z: 0, scale: 1 },
  { x: 0.7, y: -0.15, z: 0.2, scale: 0.7 },
  { x: -0.55, y: -0.1, z: 0.55, scale: 0.66 },
  { x: -0.45, y: -0.2, z: -0.6, scale: 0.72 },
  { x: 0.35, y: 0.05, z: -0.65, scale: 0.6 },
];
const CANOPY_VERTICAL_SQUASH = 0.55;

function treeRng(tree) {
  return createRng(hashSeed(`render:${tree.id}`));
}

/**
 * Radius by height fraction `t`: straight, then a slight taper to the top.
 * @param {number} t 0 at the base, 1 at the top
 */
function trunkRadiusAt(t) {
  if (t <= TRUNK_STRAIGHT_FRACTION) return 1;
  const taper = (t - TRUNK_STRAIGHT_FRACTION) / (1 - TRUNK_STRAIGHT_FRACTION);
  return 1 + (TRUNK_TOP_RADIUS - 1) * taper;
}

/** 0 below the haze line, easing up to 1 at the top of the trunk. */
function hazeAt(t) {
  if (t <= TRUNK_HAZE_START) return 0;
  const s = (t - TRUNK_HAZE_START) / (1 - TRUNK_HAZE_START);
  return s * s * (3 - 2 * s);
}

/**
 * A unit trunk (radius 1, height 1, base at y=0) with the taper baked in and
 * a vertex colour that fades from `base` to `top` up the haze band. Colours
 * live in the geometry rather than the material so every towering tree can
 * share one instanced mesh; instance colours then only nudge the shade.
 */
function createTrunkGeometry(base, top) {
  const geometry = new CylinderGeometry(1, 1, 1, TRUNK_RADIAL_SEGMENTS, TRUNK_HEIGHT_SEGMENTS);
  geometry.translate(0, 0.5, 0);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const color = new Color();

  for (let i = 0; i < position.count; i += 1) {
    const t = Math.min(Math.max(position.getY(i), 0), 1);
    const radius = trunkRadiusAt(t);
    position.setX(i, position.getX(i) * radius);
    position.setZ(i, position.getZ(i) * radius);
    color.copy(base).lerp(top, hazeAt(t) * TRUNK_TOP_HAZE);
    color.toArray(colors, i * 3);
  }

  position.needsUpdate = true;
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @param {Array<object>} trees the world's towering trees (`tree.towering`)
 * @param {{barkTexture?: import('three').Texture, canopyGeometry: import('three').BufferGeometry}} options
 *   shared with the instanced forest, so the grain and canopy facets match.
 * @returns {Group} a group named 'towering-trees'
 */
export function createToweringTrees(trees, { barkTexture, canopyGeometry }) {
  const group = new Group();
  group.name = 'towering-trees';
  if (trees.length === 0) return group;

  const fog = new Color(PALETTE.fog);
  const bark = new Color(PALETTE.barkTowering);
  const outline = new Color(PALETTE.outline);

  const trunkGeometry = createTrunkGeometry(bark, fog);
  const hullGeometry = createTrunkGeometry(outline, fog);

  const trunkMaterial = toonMaterial(0xffffff, {
    vertexColors: true,
    ...(barkTexture ? { map: barkTexture } : {}),
  });
  const trunkOutlineMaterial = outlineMaterial();
  trunkOutlineMaterial.color.set(0xffffff);
  trunkOutlineMaterial.vertexColors = true;
  const canopyOutlineMaterial = outlineMaterial();
  canopyOutlineMaterial.color.copy(mixColor(PALETTE.outline, PALETTE.fog, CANOPY_OUTLINE_HAZE));

  const canopyCount = trees.length * CANOPY_BLOBS.length;
  const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, trees.length);
  const trunkOutlines = new InstancedMesh(hullGeometry, trunkOutlineMaterial, trees.length);
  const canopies = new InstancedMesh(canopyGeometry, toonMaterial(0xffffff), canopyCount);
  const canopyOutlines = new InstancedMesh(canopyGeometry, canopyOutlineMaterial, canopyCount);

  const dummy = new Object3D();
  const hull = new Matrix4();
  // The trunk's origin is its base, so a uniform hull scale would push the
  // outline into the ground and past the top. Thicken it across only.
  const trunkHullScale = new Matrix4().makeScale(OUTLINE_SCALE, 1, OUTLINE_SCALE);
  const canopyHullScale = new Matrix4().makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);
  const white = new Color(0xffffff);

  let canopyIndex = 0;

  trees.forEach((tree, treeIndex) => {
    const rng = treeRng(tree);

    dummy.position.set(tree.position.x, tree.position.y, tree.position.z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(tree.trunkRadius, tree.trunkHeight, tree.trunkRadius);
    dummy.updateMatrix();
    trunks.setMatrixAt(treeIndex, dummy.matrix);
    trunkOutlines.setMatrixAt(treeIndex, hull.multiplyMatrices(dummy.matrix, trunkHullScale));
    // Multiplies the vertex colours, so this only shades a tree a touch darker.
    trunks.setColorAt(treeIndex, white.clone().multiplyScalar(randRange(rng, 0.85, 1)));

    const canopyColor = mixColor(PALETTE.canopy, PALETTE.canopyAlt, rng()).lerp(fog, CANOPY_HAZE);
    const topY = tree.position.y + tree.trunkHeight;
    for (const blob of CANOPY_BLOBS) {
      const radius = tree.canopyRadius * blob.scale;
      const spin = rng() * Math.PI;
      dummy.position.set(
        tree.position.x + blob.x * tree.canopyRadius,
        topY + blob.y * tree.canopyRadius,
        tree.position.z + blob.z * tree.canopyRadius,
      );
      dummy.rotation.set(spin * 0.3, spin, 0);
      dummy.scale.set(radius, radius * CANOPY_VERTICAL_SQUASH, radius);
      dummy.updateMatrix();
      canopies.setMatrixAt(canopyIndex, dummy.matrix);
      canopyOutlines.setMatrixAt(canopyIndex, hull.multiplyMatrices(dummy.matrix, canopyHullScale));
      canopies.setColorAt(canopyIndex, canopyColor);
      canopyIndex += 1;
    }
  });

  for (const mesh of [trunks, trunkOutlines, canopies, canopyOutlines]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Outlines first so the solid geometry draws over their front faces.
  group.add(trunkOutlines, canopyOutlines, trunks, canopies);
  return group;
}
