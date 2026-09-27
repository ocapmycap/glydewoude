/**
 * See-through trees (LAN-572): a dithered screen-door cutout on trunk, canopy
 * and outline-hull materials, so a tree standing between the camera and the
 * squirrel does not block the view of it.
 *
 * The forest is drawn with a handful of InstancedMeshes (trees.js) sharing a
 * handful of materials, so per-tree transparency is not an option — there is
 * no single material to fade for "the one tree in the way". Instead every
 * patched material samples the same screen-space capsule test and discards a
 * dithered share of the fragments that fall inside it, wherever on screen
 * that happens to land. Because trunk, canopy and their outline hulls all use
 * the same pattern, the holes line up pixel-for-pixel and read as one cut
 * through the tree rather than a mismatched trunk and silhouette.
 */

import { Raycaster, Vector3 } from 'three';

/** Tuning for the cutout. Distances in metres, `easeSeconds` in seconds. */
export const SEE_THROUGH = Object.freeze({
  /** Capsule radius round the camera-to-squirrel segment. */
  capsuleRadius: 1.5,
  /** Nothing this close to the squirrel is cut, so clung bark stays solid. */
  clearRadius: 1.0,
  /** Time for the effect to ramp fully in or out once line of sight changes. */
  easeSeconds: 0.15,
  /** Fraction of fragments discarded at full strength. */
  ditherShare: 0.5,
});

// One set of uniform objects, shared by every patched material the way
// `toonGradient()` shares one texture (materials.js) — so a single `update`
// call moves the cutout for the whole forest at once.
const uniforms = {
  seeThroughCamera: { value: new Vector3() },
  seeThroughTarget: { value: new Vector3() },
  seeThroughStrength: { value: 0 },
};

/**
 * Patch a material with the see-through cutout. Chains any existing
 * `onBeforeCompile` rather than overwriting it, and gives the compiled
 * program its own cache key so patched and unpatched variants of the same
 * base material never share a shader.
 *
 * @template {import('three').Material} T
 * @param {T} material
 * @returns {T} the same material, mutated
 */
export function applySeeThrough(material) {
  const previous = material.onBeforeCompile?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);

    shader.uniforms.seeThroughCamera = uniforms.seeThroughCamera;
    shader.uniforms.seeThroughTarget = uniforms.seeThroughTarget;
    shader.uniforms.seeThroughStrength = uniforms.seeThroughStrength;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSeeThroughWorld;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vSeeThroughWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;
#else
  vSeeThroughWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
#endif`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vSeeThroughWorld;
uniform vec3 seeThroughCamera;
uniform vec3 seeThroughTarget;
uniform float seeThroughStrength;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  // Distance from this fragment's world position to the camera->squirrel
  // segment, clamped to the segment (a capsule, not an infinite cylinder).
  vec3 segment = seeThroughTarget - seeThroughCamera;
  float segmentLengthSq = max(dot(segment, segment), 1e-6);
  float t = clamp(dot(vSeeThroughWorld - seeThroughCamera, segment) / segmentLengthSq, 0.0, 1.0);
  vec3 closest = seeThroughCamera + segment * t;
  float capsuleDistance = length(vSeeThroughWorld - closest);
  float targetDistance = length(vSeeThroughWorld - seeThroughTarget);

  if (capsuleDistance < ${SEE_THROUGH.capsuleRadius.toFixed(3)} && targetDistance > ${SEE_THROUGH.clearRadius.toFixed(3)}) {
    // A 4x4 Bayer matrix, not a plain checker: 16 distinct thresholds let the
    // eased strength ramp the cut share smoothly from 0 to ditherShare
    // instead of the pattern popping in as a single fixed checkerboard.
    const float bayer[16] = float[16](
      0.0, 8.0, 2.0, 10.0,
      12.0, 4.0, 14.0, 6.0,
      3.0, 11.0, 1.0, 9.0,
      15.0, 7.0, 13.0, 5.0
    );
    ivec2 cell = ivec2(mod(gl_FragCoord.xy, 4.0));
    float threshold = (bayer[cell.y * 4 + cell.x] + 0.5) / 16.0;
    if (threshold < seeThroughStrength * ${SEE_THROUGH.ditherShare.toFixed(3)}) discard;
  }
}`,
      );
  };

  // Distinct patched materials must not collide in the program cache with
  // unpatched ones sharing the same base parameters.
  material.customProgramCacheKey = () => 'see-through';

  return material;
}

/**
 * Owns the line-of-sight test that drives the shared uniforms above.
 *
 * The cutout's strength is eased in real time, not per-fragment, because
 * every patched material is shared across many instanced trees — there is no
 * single per-tree "time since this tree started blocking" to key a fragment
 * shader off. Driving the ease from one raycast instead means a tree with a
 * clear line of sight always renders exactly as it did before this feature,
 * and only the forest actually between the camera and the squirrel ever
 * dithers.
 *
 * @param {import('three').Object3D} forest the group to test for blockers
 */
export function createSeeThrough(forest) {
  const raycaster = new Raycaster();
  const direction = new Vector3();
  // Reused across frames so `update` never allocates.
  const intersections = [];
  let strength = 0;

  return {
    /**
     * @param {import('three').Vector3} cameraPosition
     * @param {import('three').Vector3} targetPosition the squirrel's position
     * @param {number} dt seconds since the last call
     */
    update(cameraPosition, targetPosition, dt) {
      uniforms.seeThroughCamera.value.copy(cameraPosition);
      uniforms.seeThroughTarget.value.copy(targetPosition);

      const distance = cameraPosition.distanceTo(targetPosition);
      let blocked = false;
      if (distance > SEE_THROUGH.clearRadius) {
        direction.copy(targetPosition).sub(cameraPosition).normalize();
        raycaster.set(cameraPosition, direction);
        raycaster.near = 0;
        // Stop short of the squirrel's own trunk, so bark it is touching
        // never counts as a blocker.
        raycaster.far = distance - SEE_THROUGH.clearRadius;
        intersections.length = 0;
        raycaster.intersectObject(forest, true, intersections);
        blocked = intersections.length > 0;
      }

      const step = dt / SEE_THROUGH.easeSeconds;
      strength = blocked
        ? Math.min(1, strength + step)
        : Math.max(0, strength - step);
      uniforms.seeThroughStrength.value = strength;
    },
  };
}
