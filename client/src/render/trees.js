/**
 * Forest geometry.
 *
 * The whole forest is four InstancedMeshes — trunk, canopy, and an inverted
 * hull for each — so a two-hundred-tree world costs a handful of draw calls
 * rather than eight hundred. Viral browser games get opened on whatever device
 * happens to be in someone's hand, and the doc expects traffic spikes (§10).
 */

import {
  CylinderGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Group,
} from 'three';

import { PALETTE, mixColor, outlineMaterial, toonMaterial } from './materials.js';

/** How much bigger the inverted hull is than the mesh it outlines. */
const OUTLINE_SCALE = 1.035;

/**
 * Canopy blobs per tree, as offsets scaled by the canopy radius.
 *
 * `CANOPY_DROP` hangs the foliage below the perch so the launch branch pokes
 * out of the top of the tree. Get this wrong and the camera spawns inside the
 * canopy looking at the inside of the outline hull.
 */
const CANOPY_DROP = 0.86;
const CANOPY_BLOBS = [
  { x: 0, y: 0.05, z: 0, scale: 1 },
  { x: 0.45, y: -0.35, z: 0.25, scale: 0.62 },
  { x: -0.4, y: -0.3, z: -0.3, scale: 0.55 },
];

function buildInstanced(geometry, material, count) {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * @param {{trees: Array<object>}} world
 * @returns {Group} a group holding the whole forest
 */
export function createForest(world) {
  const group = new Group();
  group.name = 'forest';

  const trunkGeometry = new CylinderGeometry(0.75, 1, 1, 7, 1);
  // Detail 0 keeps the canopy a faceted low-poly blob rather than a ball.
  const canopyGeometry = new IcosahedronGeometry(1, 0);

  const trunkCount = world.trees.length;
  const canopyCount = world.trees.length * CANOPY_BLOBS.length;

  const trunks = buildInstanced(trunkGeometry, toonMaterial(0xffffff), trunkCount);
  const canopies = buildInstanced(canopyGeometry, toonMaterial(0xffffff), canopyCount);
  const trunkOutlines = buildInstanced(trunkGeometry, outlineMaterial(), trunkCount);
  const canopyOutlines = buildInstanced(canopyGeometry, outlineMaterial(), canopyCount);

  const dummy = new Object3D();
  const hull = new Matrix4();
  const scaleUp = new Matrix4().makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);

  let canopyIndex = 0;

  world.trees.forEach((tree, treeIndex) => {
    const isGreat = tree.id === world.spawnTreeId;

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
    trunks.setColorAt(
      treeIndex,
      mixColor(PALETTE.bark, PALETTE.barkGreat, isGreat ? 1 : (treeIndex % 5) / 8),
    );

    const canopyColor = tree.isDestination
      ? mixColor(PALETTE.canopyDestination, PALETTE.canopyAlt, 0.15)
      : mixColor(PALETTE.canopy, PALETTE.canopyAlt, ((treeIndex * 7) % 10) / 10);

    for (const blob of CANOPY_BLOBS) {
      const radius = tree.canopyRadius * blob.scale;
      dummy.position.set(
        tree.position.x + blob.x * tree.canopyRadius,
        tree.perchY + (blob.y - CANOPY_DROP) * tree.canopyRadius,
        tree.position.z + blob.z * tree.canopyRadius,
      );
      dummy.rotation.set(treeIndex * 0.3, treeIndex * 0.7, blob.scale);
      // Squash slightly: canopies read better wider than they are tall.
      dummy.scale.set(radius, radius * 0.78, radius);
      dummy.updateMatrix();
      canopies.setMatrixAt(canopyIndex, dummy.matrix);
      canopyOutlines.setMatrixAt(canopyIndex, hull.multiplyMatrices(dummy.matrix, scaleUp));
      canopies.setColorAt(canopyIndex, canopyColor);
      canopyIndex += 1;
    }
  });

  for (const mesh of [trunks, canopies, trunkOutlines, canopyOutlines]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Outlines first so the solid geometry draws over their front faces.
  group.add(trunkOutlines, canopyOutlines, trunks, canopies);
  return group;
}
