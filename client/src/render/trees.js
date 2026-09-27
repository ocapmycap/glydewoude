/**
 * Forest geometry.
 *
 * The forest is four InstancedMeshes — trunk, canopy, and an inverted hull
 * for each — so a two-hundred-tree world costs a handful of draw calls rather
 * than eight hundred. Viral browser games get opened on whatever device
 * happens to be in someone's hand, and the doc expects traffic spikes (§10).
 * The great tree (the spawn landmark) is drawn separately in great-tree.js —
 * it is unique, so it can afford its own mesh instead of an instance slot.
 *
 * Detail is added without adding draw calls: bark grain is one shared canvas
 * texture, leaf tufts are extra instances of the canopy mesh, and per-tree
 * variety lives in instance colours and matrices (D-38).
 */

import {
  CanvasTexture,
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Group,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { createRng, hashSeed, randRange } from '@glidewood/shared';

import { PALETTE, mixColor, outlineMaterial, toonMaterial } from './materials.js';
import { createGreatTree } from './great-tree.js';

/** How much bigger the inverted hull is than the mesh it outlines. */
const OUTLINE_SCALE = 1.035;

/**
 * Canopy blobs per tree, as offsets scaled by the canopy radius.
 *
 * `CANOPY_DROP` hangs the foliage below the perch so the launch branch pokes
 * out of the top of the tree. Get this wrong and the camera spawns inside the
 * canopy looking at the inside of the outline hull.
 */
export const CANOPY_DROP = 0.86;
export const CANOPY_BLOBS = [
  { x: 0, y: 0.05, z: 0, scale: 1 },
  { x: 0.45, y: -0.35, z: 0.25, scale: 0.62 },
  { x: -0.4, y: -0.3, z: -0.3, scale: 0.55 },
];

/**
 * How much the canopy blobs are squashed vertically relative to their
 * horizontal radius. Exported so structures.js can find the drawn canopy's
 * surface instead of guessing at a second copy of this number (D-48).
 */
export const CANOPY_VERTICAL_SQUASH = 0.78;

/**
 * Smaller leaf clusters hung around the rim of each canopy, placed per tree
 * from its id. They break the three-blob outline into something ragged.
 */
const TUFTS_PER_TREE = 4;

/** How far each canopy vertex may be pushed, as a fraction of its radius. */
const CANOPY_JITTER = 0.18;

/**
 * Per-tree randomness, seeded from the tree's id so every load draws the same
 * forest. Rendering-only, so it never touches the world seed's own stream.
 */
function treeRng(tree) {
  return createRng(hashSeed(`render:${tree.id}`));
}

/**
 * A faceted icosahedron with its corners pushed in and out, so a blob stops
 * reading as a perfect gem. Detail 0 is non-indexed — each corner exists once
 * per face — so offsets are keyed by position; jittering copies independently
 * would tear the mesh open and the outline hull with it.
 */
function createCanopyGeometry() {
  const geometry = new IcosahedronGeometry(1, 0);
  const position = geometry.getAttribute('position');
  const rng = createRng(hashSeed('render:canopy'));
  const offsets = new Map();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 + randRange(rng, -CANOPY_JITTER, CANOPY_JITTER));
    const scale = offsets.get(key);
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Vertical bark grain, drawn once at startup. Kept near-white so the
 * per-instance bark colour still decides the hue, and coarse so the toon
 * banding stays the dominant shading rather than turning into noise.
 */
function createBarkTexture() {
  const width = 64;
  const height = 128;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const rng = createRng(hashSeed('render:bark'));

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  // Long grooves: dark stripes that wander a little as they run down the trunk.
  for (let i = 0; i < 9; i += 1) {
    let x = randRange(rng, 0, width);
    const lineWidth = randRange(rng, 1.5, 4);
    const shade = Math.round(randRange(rng, 150, 190));
    context.strokeStyle = `rgb(${shade},${shade},${shade})`;
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(x, 0);
    for (let y = 16; y <= height; y += 16) {
      x += randRange(rng, -2, 2);
      context.lineTo(x, y);
    }
    context.stroke();
  }

  // Short knots and splits so the grain is not perfectly regular.
  for (let i = 0; i < 14; i += 1) {
    const shade = Math.round(randRange(rng, 175, 215));
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.fillRect(
      randRange(rng, 0, width),
      randRange(rng, 0, height),
      randRange(rng, 1, 2.5),
      randRange(rng, 6, 18),
    );
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  // Twice round the trunk; the canvas already runs the full height.
  texture.repeat.set(2, 1);
  return texture;
}

function buildInstanced(geometry, material, count) {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * The fixed canopy blobs plus this tree's tufts, in canopy-radius units.
 * Tufts ring the rim at seeded bearings and sit low enough that the top of
 * the tree — where the camera spawns — stays clear of them.
 */
function blobsFor(rng) {
  const blobs = CANOPY_BLOBS.map((blob) => ({ ...blob, spin: rng() * Math.PI, isTuft: false }));
  const start = rng() * Math.PI * 2;
  for (let i = 0; i < TUFTS_PER_TREE; i += 1) {
    const bearing = start + (i / TUFTS_PER_TREE) * Math.PI * 2 + randRange(rng, -0.4, 0.4);
    const reach = randRange(rng, 0.75, 0.95);
    blobs.push({
      x: Math.cos(bearing) * reach,
      y: randRange(rng, -0.45, -0.1),
      z: Math.sin(bearing) * reach,
      scale: randRange(rng, 0.26, 0.36),
      spin: rng() * Math.PI,
      isTuft: true,
    });
  }
  return blobs;
}

/**
 * @param {{trees: Array<object>}} world
 * @returns {Group} a group holding the whole forest
 */
export function createForest(world) {
  const group = new Group();
  group.name = 'forest';

  // The great tree draws itself; everything else is instanced.
  const trees = world.trees.filter((tree) => tree.id !== world.spawnTreeId);
  const greatTree = world.trees.find((tree) => tree.id === world.spawnTreeId);

  const trunkGeometry = new CylinderGeometry(0.75, 1, 1, 7, 1);
  // Detail 0 keeps the canopy a faceted low-poly blob rather than a ball.
  const canopyGeometry = createCanopyGeometry();

  const trunkCount = trees.length;
  const canopyCount = trees.length * (CANOPY_BLOBS.length + TUFTS_PER_TREE);

  const barkTexture = createBarkTexture();
  const trunkMaterial = toonMaterial(0xffffff, { map: barkTexture });
  const trunks = buildInstanced(trunkGeometry, trunkMaterial, trunkCount);
  const canopies = buildInstanced(canopyGeometry, toonMaterial(0xffffff), canopyCount);
  const trunkOutlines = buildInstanced(trunkGeometry, outlineMaterial(), trunkCount);
  const canopyOutlines = buildInstanced(canopyGeometry, outlineMaterial(), canopyCount);

  const dummy = new Object3D();
  const hull = new Matrix4();
  const scaleUp = new Matrix4().makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);

  let canopyIndex = 0;

  trees.forEach((tree, treeIndex) => {
    const rng = treeRng(tree);

    // Trunk: a unit cylinder scaled to the tree, with its base on the ground.
    dummy.position.set(
      tree.position.x,
      tree.position.y + tree.trunkHeight / 2,
      tree.position.z,
    );
    dummy.rotation.set(0, tree.position.x * 0.7, 0);
    dummy.scale.set(tree.trunkRadius, tree.trunkHeight, tree.trunkRadius);
    dummy.updateMatrix();
    trunks.setMatrixAt(treeIndex, dummy.matrix);
    trunkOutlines.setMatrixAt(treeIndex, hull.multiplyMatrices(dummy.matrix, scaleUp));
    trunks.setColorAt(treeIndex, mixColor(PALETTE.bark, PALETTE.barkGreat, randRange(rng, 0, 0.6)));

    // Destination gold only drifts a little toward green, so it still reads
    // as "worth landing on" from the air.
    const canopyColor = tree.isDestination
      ? mixColor(PALETTE.canopyDestination, PALETTE.canopyAlt, randRange(rng, 0.05, 0.25))
      : mixColor(PALETTE.canopy, PALETTE.canopyAlt, rng());
    const tuftColor = canopyColor.clone().lerp(mixColor(PALETTE.canopyAlt, PALETTE.sky, 0.15), 0.3);

    for (const blob of blobsFor(rng)) {
      const radius = tree.canopyRadius * blob.scale;
      dummy.position.set(
        tree.position.x + blob.x * tree.canopyRadius,
        tree.perchY + (blob.y - CANOPY_DROP) * tree.canopyRadius,
        tree.position.z + blob.z * tree.canopyRadius,
      );
      dummy.rotation.set(blob.spin, treeIndex * 0.7 + blob.spin, blob.scale);
      // Squash slightly: canopies read better wider than they are tall.
      dummy.scale.set(radius, radius * CANOPY_VERTICAL_SQUASH, radius);
      dummy.updateMatrix();
      canopies.setMatrixAt(canopyIndex, dummy.matrix);
      canopyOutlines.setMatrixAt(canopyIndex, hull.multiplyMatrices(dummy.matrix, scaleUp));
      canopies.setColorAt(canopyIndex, blob.isTuft ? tuftColor : canopyColor);
      canopyIndex += 1;
    }
  });

  for (const mesh of [trunks, canopies, trunkOutlines, canopyOutlines]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Outlines first so the solid geometry draws over their front faces.
  group.add(trunkOutlines, canopyOutlines, trunks, canopies);

  if (greatTree) group.add(createGreatTree(greatTree, { barkTexture }));

  return group;
}
