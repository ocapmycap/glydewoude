/**
 * Drey and platform meshes for tree structures (LAN-524).
 *
 * `tree.structures` is worldgen data (shared/src/worldgen.js, D-40): an
 * offset and yaw for each drey or platform, relative to the trunk base.
 * Scenery trees have `structures: []` and draw nothing.
 *
 * Like the forest itself (trees.js), every structure kind is a fixed set of
 * InstancedMeshes plus their inverted-hull outlines, so a tree with a drey
 * costs the same handful of draw calls whether the forest has ten
 * destination trees or a hundred.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
} from 'three';
import { createRng, hashSeed, randRange, STRUCTURE_KINDS } from '@glidewood/shared';

import { PALETTE, mixColor, outlineMaterial, toonMaterial } from './materials.js';
import { CANOPY_BLOBS, CANOPY_DROP, CANOPY_VERTICAL_SQUASH } from './trees.js';

/** How much bigger the inverted hull is than the mesh it outlines (matches trees.js). */
const OUTLINE_SCALE = 1.035;

// Drey sizing, metres — a squirrel is about 0.5 m, so ~1.1 m across reads as
// a real nest without dwarfing the canopy that hides it.
const DREY_RADIUS = 0.55;
const DREY_JITTER = 0.32;
const DREY_TUFTS = 3;
const DREY_TUFT_RADIUS = 0.16;

// Platform sizing, metres. A square deck of side-by-side planks, laid across
// local X, each spanning the full local-Z depth, reads as built far better
// than a solid disc.
const PLATFORM_SIZE = 1.8;
const PLATFORM_PLANK_COUNT = 5;
const PLATFORM_PLANK_GAP = 0.035;
const PLATFORM_THICKNESS = 0.12;
/** Per-plank thickness jitter, so the deck doesn't look machine-milled. */
const PLATFORM_PLANK_HEIGHT_JITTER = 0.015;
const PLATFORM_PLANK_WIDTH =
  (PLATFORM_SIZE - (PLATFORM_PLANK_COUNT - 1) * PLATFORM_PLANK_GAP) / PLATFORM_PLANK_COUNT;

const PLATFORM_POST_COUNT = 4;
/** 3 of the 4 edges get a rail bar; the fourth stays open as the landing edge. */
const PLATFORM_RAIL_BAR_COUNT = 3;
const PLATFORM_POST_HEIGHT = 0.35;
const PLATFORM_POST_RADIUS = 0.045;
const PLATFORM_RAIL_THICKNESS = 0.05;
/** Posts and rail sit just inside the plank edge. */
const PLATFORM_RAIL_FRACTION = 0.88;
const PLATFORM_RAIL_HALF = (PLATFORM_SIZE / 2) * PLATFORM_RAIL_FRACTION;

/**
 * How far out worldgen's own placement band (D-40, 25%-70% of canopyRadius)
 * reaches, versus how far the canopy trees.js actually draws extends at a
 * given height. Measured across the forest, most rolls land a median 2.5 m
 * (up to ~5.5 m) inside the drawn foliage, so a structure placed literally
 * is invisible from the air. This pushes the horizontal distance out to the
 * drawn canopy's rim — never in — keeping the offset's height and bearing,
 * and the yaw, exactly as worldgen rolled them (D-48).
 */
function pushToCanopyRim(tree, offset) {
  const r = tree.canopyRadius;
  // trees.js centres its main canopy blob at perchY + (blobY - CANOPY_DROP) * r
  // and squashes it vertically by CANOPY_VERTICAL_SQUASH; model that same
  // ellipsoid here rather than a second copy of the numbers.
  const mainBlobY = CANOPY_BLOBS[0].y;
  const centreY = tree.perchY + (mainBlobY - CANOPY_DROP) * r;
  const absoluteY = tree.position.y + offset.y;
  const dy = (absoluteY - centreY) / (CANOPY_VERTICAL_SQUASH * r);
  const rim = r * Math.sqrt(Math.max(0, 1 - dy * dy));

  const bearing = Math.atan2(offset.z, offset.x);
  const originalHorizontal = Math.hypot(offset.x, offset.z);
  const horizontal = Math.max(originalHorizontal, rim * 0.95);

  return {
    x: Math.cos(bearing) * horizontal,
    y: offset.y,
    z: Math.sin(bearing) * horizontal,
  };
}

/**
 * The great tree's canopy is four cones (great-tree.js), not the blob
 * ellipsoid above. Measured, its platform already sits close to a tier's
 * surface, so it is placed literally rather than modelling cones too.
 */
function placementFor(world, tree, structure) {
  const offset = tree.id === world.spawnTreeId ? structure.offset : pushToCanopyRim(tree, structure.offset);
  return {
    x: tree.position.x + offset.x,
    y: tree.position.y + offset.y,
    z: tree.position.z + offset.z,
  };
}

/** Per-structure randomness, seeded from the tree and the structure's index so every load matches. */
function structureRng(tree, index) {
  return createRng(hashSeed(`render:${tree.id}:structure:${index}`));
}

function buildInstanced(geometry, material, count) {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * A faceted icosahedron with its corners pushed in and out — see
 * trees.js's createCanopyGeometry for why offsets are keyed by position
 * rather than by vertex index (Polyhedron geometry is non-indexed).
 */
function createJitteredIcosahedron(radius, detail, jitter, seedLabel) {
  const geometry = new IcosahedronGeometry(radius, detail);
  const position = geometry.getAttribute('position');
  const rng = createRng(hashSeed(seedLabel));
  const offsets = new Map();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (!offsets.has(key)) offsets.set(key, 1 + randRange(rng, -jitter, jitter));
    const scale = offsets.get(key);
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @param {object} world world object from generateForest — trees carry `structures`
 * @returns {Group} a group named 'structures', always holding the full set of
 *   InstancedMeshes (each may have an instance count of 0 if no tree rolled
 *   that kind — never skipped, so the draw call count never changes with the
 *   forest's content, only the world's structure count)
 */
export function createStructures(world) {
  const group = new Group();
  group.name = 'structures';

  const dreyEntries = [];
  const platformEntries = [];
  for (const tree of world.trees) {
    tree.structures.forEach((structure, index) => {
      const entry = { tree, structure, index };
      if (structure.kind === STRUCTURE_KINDS.DREY) dreyEntries.push(entry);
      else if (structure.kind === STRUCTURE_KINDS.PLATFORM) platformEntries.push(entry);
    });
  }

  const dreyBodyGeometry = createJitteredIcosahedron(DREY_RADIUS, 1, DREY_JITTER, 'render:drey');
  const dreyTuftGeometry = new IcosahedronGeometry(DREY_TUFT_RADIUS, 0);
  // Unit box; each plank, post and rail bar instance scales and positions
  // this same geometry via its own matrix.
  const platformPlankGeometry = new BoxGeometry(1, 1, 1);
  const platformPostGeometry = new CylinderGeometry(
    PLATFORM_POST_RADIUS,
    PLATFORM_POST_RADIUS,
    PLATFORM_POST_HEIGHT,
    6,
  );
  const platformRailGeometry = new BoxGeometry(1, 1, 1);

  const dreyBodyCount = dreyEntries.length;
  const dreyTuftCount = dreyEntries.length * DREY_TUFTS;
  const platformPlankCount = platformEntries.length * PLATFORM_PLANK_COUNT;
  const platformPostCount = platformEntries.length * PLATFORM_POST_COUNT;
  const platformRailCount = platformEntries.length * PLATFORM_RAIL_BAR_COUNT;

  const dreyBodyMaterial = toonMaterial(0xffffff);
  const dreyTuftMaterial = toonMaterial(0xffffff);
  const platformPlankMaterial = toonMaterial(0xffffff);
  const platformPostMaterial = toonMaterial(0xffffff);
  const platformRailMaterial = toonMaterial(0xffffff);

  const dreyBodies = buildInstanced(dreyBodyGeometry, dreyBodyMaterial, dreyBodyCount);
  const dreyTufts = buildInstanced(dreyTuftGeometry, dreyTuftMaterial, dreyTuftCount);
  const platformPlanks = buildInstanced(platformPlankGeometry, platformPlankMaterial, platformPlankCount);
  const platformPosts = buildInstanced(platformPostGeometry, platformPostMaterial, platformPostCount);
  const platformRails = buildInstanced(platformRailGeometry, platformRailMaterial, platformRailCount);

  const dreyBodyOutlines = buildInstanced(dreyBodyGeometry, outlineMaterial(), dreyBodyCount);
  const dreyTuftOutlines = buildInstanced(dreyTuftGeometry, outlineMaterial(), dreyTuftCount);
  const platformPlankOutlines = buildInstanced(platformPlankGeometry, outlineMaterial(), platformPlankCount);
  const platformPostOutlines = buildInstanced(platformPostGeometry, outlineMaterial(), platformPostCount);
  const platformRailOutlines = buildInstanced(platformRailGeometry, outlineMaterial(), platformRailCount);

  const dummy = new Object3D();
  const hull = new Matrix4();
  const scaleUp = new Matrix4().makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);

  let tuftIndex = 0;
  dreyEntries.forEach(({ tree, structure, index }, bodyIndex) => {
    const rng = structureRng(tree, index);
    const pos = placementFor(world, tree, structure);
    const scale = randRange(rng, 0.85, 1.15);

    dummy.position.set(pos.x, pos.y, pos.z);
    dummy.rotation.set(0, structure.rotation, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    dreyBodies.setMatrixAt(bodyIndex, dummy.matrix);
    dreyBodyOutlines.setMatrixAt(bodyIndex, hull.multiplyMatrices(dummy.matrix, scaleUp));
    // Darker than the canopy, so a nest reads as woven twigs, not more leaf.
    dreyBodies.setColorAt(bodyIndex, mixColor(PALETTE.bark, PALETTE.outline, randRange(rng, 0.3, 0.4)));

    const tuftColor = mixColor(PALETTE.canopy, PALETTE.canopyAlt, rng());
    for (let t = 0; t < DREY_TUFTS; t += 1) {
      const bearing = rng() * Math.PI * 2;
      const tuftReach = DREY_RADIUS * scale * randRange(rng, 0.95, 1.15);
      dummy.position.set(
        pos.x + Math.cos(bearing) * tuftReach,
        pos.y + randRange(rng, -0.3, 0.5) * DREY_RADIUS * scale,
        pos.z + Math.sin(bearing) * tuftReach,
      );
      dummy.rotation.set(rng() * Math.PI, rng() * Math.PI, 0);
      dummy.scale.setScalar(randRange(rng, 0.8, 1.2));
      dummy.updateMatrix();
      dreyTufts.setMatrixAt(tuftIndex, dummy.matrix);
      dreyTuftOutlines.setMatrixAt(tuftIndex, hull.multiplyMatrices(dummy.matrix, scaleUp));
      dreyTufts.setColorAt(tuftIndex, tuftColor);
      tuftIndex += 1;
    }
  });

  // The platform's own local frame: everything below is built in local space
  // (planks along X, corners at the four square edges) and then carried into
  // world space by this one matrix per platform, so `structure.rotation`
  // only ever has to be applied once, not per plank or rail bar.
  const frame = new Object3D();
  const local = new Matrix4();
  const combined = new Matrix4();
  const scaleM = new Matrix4();
  const rotationM = new Matrix4();

  let plankIndex = 0;
  let postIndex = 0;
  let railIndex = 0;
  platformEntries.forEach(({ tree, structure, index }) => {
    const rng = structureRng(tree, index);
    const pos = placementFor(world, tree, structure);
    const plankColor = mixColor(PALETTE.plank, PALETTE.bark, randRange(rng, 0, 0.3));
    const woodColor = mixColor(PALETTE.plank, PALETTE.outline, 0.15);

    frame.position.set(pos.x, pos.y, pos.z);
    frame.rotation.set(0, structure.rotation, 0);
    frame.updateMatrix();

    // Planks: laid side by side across local X, each spanning the full local
    // Z depth, with small gaps so the deck reads as built, not poured.
    for (let p = 0; p < PLATFORM_PLANK_COUNT; p += 1) {
      const localX =
        -PLATFORM_SIZE / 2 + PLATFORM_PLANK_WIDTH / 2 + p * (PLATFORM_PLANK_WIDTH + PLATFORM_PLANK_GAP);
      const height = PLATFORM_THICKNESS + randRange(rng, -PLATFORM_PLANK_HEIGHT_JITTER, PLATFORM_PLANK_HEIGHT_JITTER);
      scaleM.makeScale(PLATFORM_PLANK_WIDTH, height, PLATFORM_SIZE);
      local.copy(scaleM).setPosition(localX, 0, 0);
      combined.multiplyMatrices(frame.matrix, local);
      platformPlanks.setMatrixAt(plankIndex, combined);
      platformPlankOutlines.setMatrixAt(plankIndex, hull.multiplyMatrices(combined, scaleUp));
      platformPlanks.setColorAt(plankIndex, mixColor(plankColor, PALETTE.bark, randRange(rng, 0, 0.15)));
      plankIndex += 1;
    }

    // 4 corner posts, always, at the square's edges.
    const corners = [
      { x: -PLATFORM_RAIL_HALF, z: -PLATFORM_RAIL_HALF },
      { x: PLATFORM_RAIL_HALF, z: -PLATFORM_RAIL_HALF },
      { x: PLATFORM_RAIL_HALF, z: PLATFORM_RAIL_HALF },
      { x: -PLATFORM_RAIL_HALF, z: PLATFORM_RAIL_HALF },
    ];
    corners.forEach((corner) => {
      local.identity().setPosition(corner.x, PLATFORM_POST_HEIGHT / 2, corner.z);
      combined.multiplyMatrices(frame.matrix, local);
      platformPosts.setMatrixAt(postIndex, combined);
      platformPostOutlines.setMatrixAt(postIndex, hull.multiplyMatrices(combined, scaleUp));
      platformPosts.setColorAt(postIndex, woodColor);
      postIndex += 1;
    });

    // Rail bars along 3 of the 4 edges; the local -Z edge (between the two
    // "back" corners above) is left open as the landing edge.
    const bars = [
      { x: PLATFORM_RAIL_HALF, z: 0, yaw: Math.PI / 2 }, // +X edge
      { x: 0, z: PLATFORM_RAIL_HALF, yaw: 0 }, // +Z edge
      { x: -PLATFORM_RAIL_HALF, z: 0, yaw: Math.PI / 2 }, // -X edge
    ];
    bars.forEach((bar) => {
      scaleM.makeScale(PLATFORM_RAIL_HALF * 2, PLATFORM_RAIL_THICKNESS, PLATFORM_RAIL_THICKNESS);
      rotationM.makeRotationY(bar.yaw);
      local.multiplyMatrices(rotationM, scaleM);
      local.setPosition(bar.x, PLATFORM_POST_HEIGHT, bar.z);
      combined.multiplyMatrices(frame.matrix, local);
      platformRails.setMatrixAt(railIndex, combined);
      platformRailOutlines.setMatrixAt(railIndex, hull.multiplyMatrices(combined, scaleUp));
      platformRails.setColorAt(railIndex, woodColor);
      railIndex += 1;
    });
  });

  const meshes = [
    dreyBodies,
    dreyTufts,
    platformPlanks,
    platformPosts,
    platformRails,
    dreyBodyOutlines,
    dreyTuftOutlines,
    platformPlankOutlines,
    platformPostOutlines,
    platformRailOutlines,
  ];
  for (const mesh of meshes) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // Outlines first so the solid geometry draws over their front faces (matches trees.js).
  group.add(
    dreyBodyOutlines,
    dreyTuftOutlines,
    platformPlankOutlines,
    platformPostOutlines,
    platformRailOutlines,
    dreyBodies,
    dreyTufts,
    platformPlanks,
    platformPosts,
    platformRails,
  );

  return group;
}
