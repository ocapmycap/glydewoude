/**
 * A puff of leaves thrown out of the canopy when the squirrel lands.
 *
 * Every leaf in every burst is one instance of a single InstancedMesh (plus
 * its outline hull), allocated once. A landing claims the oldest burst slot
 * and rewrites its leaves, so ten landings in a row cost the same two draw
 * calls and zero allocations as one (D-42).
 *
 * The effect keeps its own clock rather than being stepped by the renderer:
 * it advances in the mesh's `onBeforeRender`, so wiring it up takes nothing
 * beyond adding it to the scene. When no leaf is live every instance sits at
 * zero scale and the step returns early.
 */

import { Color, InstancedMesh, Object3D, OctahedronGeometry } from 'three';
import { createRng, randRange } from '@glidewood/shared';

import { PALETTE, outlineMaterial, toonMaterial } from './materials.js';

const LEAVES_PER_BURST = 16;
/** Bursts that can overlap. A fifth landing inside a second recycles the oldest. */
const MAX_BURSTS = 4;
const LEAF_COUNT = LEAVES_PER_BURST * MAX_BURSTS;

const LIFETIME_RANGE = [0.8, 1.15];
/** The last part of a leaf's life shrinks it away — toon materials do not fade by opacity per instance (D-43). */
const SHRINK_FROM = 0.55;
const GRAVITY = 5;
/** Leaves are mostly air resistance: they pop out, then settle into a slow drift. */
const DRAG = 3.2;
const FLUTTER = 1.4;

const OUTLINE_SCALE = 1.25;

/** Longest frame step honoured, so a backgrounded tab does not fling leaves. */
const MAX_STEP = 0.1;

export function createLeafBurst(scene, { now = () => performance.now() / 1000 } = {}) {
  // A flattened diamond reads as a leaf at a glance and is eight triangles.
  const geometry = new OctahedronGeometry(0.28, 0);
  geometry.scale(1, 0.22, 0.6);

  const leaves = new InstancedMesh(geometry, toonMaterial(0xffffff), LEAF_COUNT);
  const outlines = new InstancedMesh(geometry, outlineMaterial(), LEAF_COUNT);
  // Bounds are stale the moment a leaf moves; culling them would pop leaves out.
  leaves.frustumCulled = false;
  outlines.frustumCulled = false;
  // Step the leaves before their outlines draw, so the two never disagree by a frame.
  leaves.renderOrder = -1;

  const color = new Color();
  const altColor = new Color(PALETTE.canopyAlt);
  // Colour every instance up front and keep the meshes visible while idle:
  // creating the colour buffer, or compiling a hidden mesh's shader, on the
  // first landing would stall that frame.
  for (let i = 0; i < LEAF_COUNT; i += 1) leaves.setColorAt(i, color.set(PALETTE.canopy));

  // Visual variety only; it never needs to match anything across loads.
  const rng = createRng(0x1eaf);
  const particles = Array.from({ length: LEAF_COUNT }, () => ({
    alive: false,
    age: 0,
    life: 1,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    spinX: 0, spinY: 0, rotX: 0, rotY: 0,
    phase: 0,
    size: 1,
  }));
  const scratch = new Object3D();
  let nextBurst = 0;
  let live = 0;
  let lastTime = null;
  let idle = false;

  /** @param {{position: {x: number, y: number, z: number}, perchY: number, canopyRadius: number, isDestination: boolean}} tree */
  function burst(tree) {
    const first = nextBurst * LEAVES_PER_BURST;
    nextBurst = (nextBurst + 1) % MAX_BURSTS;

    const radius = tree.canopyRadius;
    const base = tree.isDestination ? PALETTE.canopyDestination : PALETTE.canopy;
    for (let i = first; i < first + LEAVES_PER_BURST; i += 1) {
      const p = particles[i];
      if (!p.alive) live += 1;
      const angle = rng() * Math.PI * 2;
      const out = randRange(rng, 0.2, 0.55) * radius;
      // Start just under the perch, where the canopy top is, and throw outward
      // and up so the puff clears the foliage before it starts to fall.
      p.x = tree.position.x + Math.sin(angle) * out;
      p.y = tree.perchY - randRange(rng, 0.1, 0.35) * radius;
      p.z = tree.position.z + Math.cos(angle) * out;
      const speed = randRange(rng, 3, 6.5);
      p.vx = Math.sin(angle) * speed;
      p.vy = randRange(rng, 3, 6);
      p.vz = Math.cos(angle) * speed;
      p.rotX = rng() * Math.PI * 2;
      p.rotY = rng() * Math.PI * 2;
      p.spinX = randRange(rng, -6, 6);
      p.spinY = randRange(rng, -4, 4);
      p.phase = rng() * Math.PI * 2;
      p.size = randRange(rng, 0.7, 1.2);
      p.age = 0;
      p.life = randRange(rng, ...LIFETIME_RANGE);
      p.alive = true;
      leaves.setColorAt(i, color.set(base).lerp(altColor, randRange(rng, 0, 0.6)));
    }
    leaves.instanceColor.needsUpdate = true;
    idle = false;
  }

  function step(dt) {
    if (idle) return;
    for (let i = 0; i < LEAF_COUNT; i += 1) {
      const p = particles[i];
      if (!p.alive) {
        scratch.scale.setScalar(0);
      } else {
        p.age += dt;
        if (p.age >= p.life) {
          p.alive = false;
          live -= 1;
          scratch.scale.setScalar(0);
        } else {
          const damping = Math.exp(-DRAG * dt);
          p.vx *= damping;
          p.vz *= damping;
          p.vy = p.vy * damping - GRAVITY * dt;
          // Sway sideways as they fall, like a leaf rocking on the air.
          const sway = Math.sin(p.age * 7 + p.phase) * FLUTTER;
          p.x += (p.vx + sway * Math.cos(p.phase)) * dt;
          p.y += p.vy * dt;
          p.z += (p.vz + sway * Math.sin(p.phase)) * dt;
          p.rotX += p.spinX * dt;
          p.rotY += p.spinY * dt;

          const t = p.age / p.life;
          const shrink = t < SHRINK_FROM ? 1 : 1 - (t - SHRINK_FROM) / (1 - SHRINK_FROM);
          // Pop in over the first few frames rather than appearing full size.
          const grow = Math.min(1, p.age / 0.08);
          scratch.position.set(p.x, p.y, p.z);
          scratch.rotation.set(p.rotX, p.rotY, 0);
          scratch.scale.setScalar(p.size * shrink * grow);
        }
      }
      scratch.updateMatrix();
      leaves.setMatrixAt(i, scratch.matrix);
      scratch.scale.multiplyScalar(OUTLINE_SCALE);
      scratch.updateMatrix();
      outlines.setMatrixAt(i, scratch.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    outlines.instanceMatrix.needsUpdate = true;
    // One more pass after the last leaf dies has zeroed every matrix.
    if (live === 0) idle = true;
  }

  leaves.onBeforeRender = () => {
    const time = now();
    const dt = lastTime === null ? 0 : Math.min(time - lastTime, MAX_STEP);
    lastTime = time;
    step(dt);
  };

  scene.add(outlines);
  scene.add(leaves);

  return {
    burst,
  };
}
