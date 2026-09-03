/**
 * Toon palette and outline helpers.
 *
 * The product doc's MVP art direction (§5.1) is `MeshToonMaterial` plus
 * inverted-hull outlines for the forest. The custom GLSL squirrel shader
 * (quantized bands, rim light) is explicitly reserved for a later phase, so
 * the squirrel uses the same toon material as everything else here.
 */

import {
  BackSide,
  Color,
  DataTexture,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  UnsignedByteType,
} from 'three';

/** Warm, low-saturation forest palette. */
export const PALETTE = Object.freeze({
  sky: 0xbfe3f2,
  fog: 0xcfe8ef,
  ground: 0x6f9a55,
  groundDeep: 0x4e7a3e,
  bark: 0x6b4a34,
  barkGreat: 0x7d5940,
  canopy: 0x4f8f4a,
  canopyAlt: 0x63a352,
  canopyDestination: 0xd6a03a,
  outline: 0x22301f,
  squirrelBody: 0xb2703c,
  squirrelBelly: 0xf0dcb8,
  squirrelMembrane: 0xd88c4a,
});

/**
 * A tiny stepped gradient map. `MeshToonMaterial` quantizes lighting by
 * sampling this, so three nearest-filtered steps give three flat bands.
 */
function createToonGradient(steps = 3) {
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i += 1) {
    data[i] = Math.round(((i + 1) / steps) * 255);
  }
  const texture = new DataTexture(data, steps, 1, RedFormat, UnsignedByteType);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

let gradient = null;

/** Shared across every toon material — one texture, not one per mesh. */
export function toonGradient() {
  gradient ??= createToonGradient();
  return gradient;
}

/**
 * @param {number|Color} color
 * @param {object} [options]
 * @param {boolean} [options.vertexColors] set for InstancedMesh with per-instance colour
 */
export function toonMaterial(color, options = {}) {
  return new MeshToonMaterial({
    color,
    gradientMap: toonGradient(),
    ...options,
  });
}

/**
 * The inverted-hull outline material: draw backfaces only, in near-black,
 * from a slightly enlarged copy of the mesh.
 *
 * Thickness is applied by scaling the hull, so on a non-uniformly scaled mesh
 * (a tall thin trunk) the outline is proportionally thinner across than along.
 * At this art scale that reads fine, and the alternative — a custom
 * view-space normal-offset shader — is deferred to the Phase 4 art pass.
 */
export function outlineMaterial() {
  return new MeshBasicMaterial({
    color: PALETTE.outline,
    side: BackSide,
    // Outlines never need to write depth for anything in front of them.
    fog: false,
  });
}

/** Blend two palette colours, for cheap per-instance variety. */
export function mixColor(a, b, t) {
  return new Color(a).lerp(new Color(b), t);
}
