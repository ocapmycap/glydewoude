/**
 * The great tree — the spawn and orientation landmark (product doc §2.3).
 *
 * Every other tree is an instance of the same handful of shared meshes so a
 * two-hundred-tree forest stays cheap (see trees.js). The great tree is drawn
 * once, so it can afford its own geometry: a twisting, root-flared trunk and a
 * pagoda of canopy tiers, sized so its silhouette reads from across the
 * forest and a player can always find home.
 */

import { ConeGeometry, CylinderGeometry, Group, Mesh } from 'three';
import { createRng, hashSeed, randRange } from '@glidewood/shared';

import { PALETTE, mixColor, outlineMaterial, toonMaterial } from './materials.js';
import { applySeeThrough } from './see-through.js';

/** How much bigger the inverted hull is than the mesh it outlines. */
const OUTLINE_SCALE = 1.035;

const TRUNK_RADIAL_SEGMENTS = 10;
const TRUNK_HEIGHT_SEGMENTS = 8;
/** Thicker than an ordinary trunk — this is the landmark, not scenery. */
const TRUNK_RADIUS_SCALE = 1.3;
/** Top radius as a fraction of the (already scaled-up) base radius. */
const TRUNK_TAPER = 0.7;
/** Total twist applied from base to crown, radians. */
const TRUNK_MAX_TWIST = 0.6;
/** Root flare only touches the bottom fifth of the trunk. */
const ROOT_FLARE_HEIGHT_FRACTION = 0.2;
const ROOT_FLARE_MAGNITUDE = 1.2;
const ROOT_FLARE_LOBES = 5;
const ROOT_FLARE_LOBE_MAGNITUDE = 0.35;

/**
 * Canopy tiers, widest at the bottom and narrowing going up, in
 * canopy-radius units. `dropFactor` is how far a tier's centre sits below the
 * perch; `radiusFactor` scales its base radius.
 *
 * The camera spawns on the perch and looks back over it (renderer.js), so the
 * top tier's apex must stay clear of that point — see CANOPY_TIER_HEIGHT_FACTOR.
 */
const CANOPY_TIERS = [
  { dropFactor: 0.25, radiusFactor: 0.55 },
  { dropFactor: 0.6, radiusFactor: 0.8 },
  { dropFactor: 0.95, radiusFactor: 1.0 },
  { dropFactor: 1.3, radiusFactor: 1.15 },
];
/** Flattened cones, not tall spikes — height relative to each tier's radius. */
const CANOPY_TIER_HEIGHT_FACTOR = 0.5;
const CANOPY_RADIAL_SEGMENTS = 8;

/**
 * Twist the trunk around Y with height, taper it, and flare the base into
 * lobed roots. Mutates the geometry passed in (called once per great tree,
 * so there is no shared copy to protect the way the instanced trees do).
 *
 * @param {CylinderGeometry} geometry vertical extent already translated to run 0..height
 * @param {number} height trunk height in metres
 */
function deformTrunk(geometry, height) {
  const position = geometry.getAttribute('position');

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const t = Math.min(Math.max(y / height, 0), 1);
    const angle = Math.atan2(z, x);

    let radiusScale = 1;
    if (t < ROOT_FLARE_HEIGHT_FRACTION) {
      const flare = (1 - t) ** 3;
      radiusScale = 1 + ROOT_FLARE_MAGNITUDE * flare;
      // A few lobes so the flare reads as roots rather than a uniform bell.
      radiusScale *= 1 + ROOT_FLARE_LOBE_MAGNITUDE * Math.max(0, Math.cos(ROOT_FLARE_LOBES * angle));
    }

    const flaredX = x * radiusScale;
    const flaredZ = z * radiusScale;

    const twist = t * TRUNK_MAX_TWIST;
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    position.setXYZ(i, flaredX * cos - flaredZ * sin, y, flaredX * sin + flaredZ * cos);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

/** @param {number} height @param {number} baseRadius */
function createTrunkGeometry(height, baseRadius) {
  const geometry = new CylinderGeometry(
    baseRadius * TRUNK_TAPER,
    baseRadius,
    height,
    TRUNK_RADIAL_SEGMENTS,
    TRUNK_HEIGHT_SEGMENTS,
  );
  // Cylinders are built centred on the origin; shift so the base sits at
  // y=0, matching where the trunk mesh is positioned (the tree's base).
  geometry.translate(0, height / 2, 0);
  deformTrunk(geometry, height);
  return geometry;
}

/** A single pagoda tier: a flattened, wide-based cone. */
function createTierGeometry(radius) {
  return new ConeGeometry(radius, radius * CANOPY_TIER_HEIGHT_FACTOR, CANOPY_RADIAL_SEGMENTS);
}

/**
 * Add a mesh and its inverted-hull outline to a group, outline first so the
 * solid draws over its front faces (matches trees.js).
 */
function addWithOutline(group, geometry, material, { position, rotationY = 0, hullScaleY = OUTLINE_SCALE } = {}) {
  const outline = new Mesh(geometry, applySeeThrough(outlineMaterial()));
  const solid = new Mesh(geometry, applySeeThrough(material));

  for (const mesh of [outline, solid]) {
    if (position) mesh.position.copy(position);
    mesh.rotation.y = rotationY;
  }
  outline.scale.set(OUTLINE_SCALE, hullScaleY, OUTLINE_SCALE);

  group.add(outline, solid);
}

/**
 * @param {object} tree the spawn tree from worldgen (`tree.id === world.spawnTreeId`)
 * @param {{barkTexture?: import('three').Texture}} [options] a bark texture
 *   to share with the instanced forest, so the whole scene draws one canvas.
 * @returns {Group} a group named 'great-tree', positioned at the world origin
 */
export function createGreatTree(tree, { barkTexture } = {}) {
  const group = new Group();
  group.name = 'great-tree';
  group.position.set(tree.position.x, tree.position.y, tree.position.z);

  const rng = createRng(hashSeed('render:great-tree'));

  const baseRadius = tree.trunkRadius * TRUNK_RADIUS_SCALE;
  const trunkGeometry = createTrunkGeometry(tree.trunkHeight, baseRadius);
  const trunkMaterial = toonMaterial(PALETTE.barkGreat, barkTexture ? { map: barkTexture } : {});
  // The trunk's origin is its base, so a uniform hull scale would lift the
  // outline ~1.6 m above the perch: a dark collar round the squirrel's feet at
  // spawn. Thicken it across the trunk only.
  addWithOutline(group, trunkGeometry, trunkMaterial, { hullScaleY: 1 });

  // Local space is relative to the tree's base, so the perch — trunkHeight
  // above the base — is the anchor the canopy tiers hang from.
  const localPerchY = tree.trunkHeight;

  CANOPY_TIERS.forEach((tier, index) => {
    const radius = tree.canopyRadius * tier.radiusFactor;
    const geometry = createTierGeometry(radius);
    const warmth = Math.min(1, Math.max(0, 0.55 - index * 0.12 + randRange(rng, -0.05, 0.05)));
    const color = mixColor(PALETTE.canopy, PALETTE.greatAccent, warmth);
    const material = toonMaterial(color);
    addWithOutline(group, geometry, material, {
      position: { x: 0, y: localPerchY - tier.dropFactor * tree.canopyRadius, z: 0 },
      rotationY: rng() * Math.PI * 2,
    });
  });

  return group;
}
