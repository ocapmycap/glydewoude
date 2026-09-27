/**
 * Faint signs of wind near the camera: thin curling streaks and the odd leaf
 * tumbling past (LAN-552).
 *
 * Purely visual. Nothing here reaches the simulation, so wind never changes
 * glide feel (D-61). The whole forest shares one prevailing direction, picked
 * from the world seed, so it reads as weather rather than noise.
 *
 * Every streak is a run of segments in one LineSegments buffer and every leaf
 * is an instance of one InstancedMesh, both built once. A mark that fades out,
 * or that the camera has left behind, is respawned in place near the camera,
 * so the cost is two draw calls and no per-frame allocation however large the
 * forest is (D-62).
 *
 * Like the leaf burst, the effect keeps its own clock and steps itself in
 * `onBeforeRender`, which also hands over the camera it is drawn for.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Object3D,
  OctahedronGeometry,
} from 'three';
import { createRng } from '@glidewood/shared';

import { PALETTE, toonMaterial } from './materials.js';

const STREAK_COUNT = 24;
const LEAF_COUNT = 12;
/** Marks spawn inside this horizontal radius of the camera, and are recycled once outside it. */
const SPAWN_RADIUS = 60;
const RECYCLE_RADIUS = SPAWN_RADIUS + 10;
/** Vertical band around the camera, so marks sit where the player is looking. */
const SPAWN_BELOW = 14;
const SPAWN_ABOVE = 10;
/** Keeps marks from spawning inside the ground plane. */
const GROUND_CLEARANCE = 1.5;

const POINTS_PER_STREAK = 8;
const SEGMENTS_PER_STREAK = POINTS_PER_STREAK - 1;
const STREAK_SEGMENT_LENGTH = 0.6;
const STREAK_LIFETIME_RANGE = [1.8, 3.4];
const STREAK_SPEED_RANGE = [6, 10];
const STREAK_CURL = 0.45;
/** Peak opacity of a streak's head. Meant to be noticed on a second look. */
const STREAK_OPACITY = 0.35;

const LEAF_LIFETIME_RANGE = [3, 5.5];
const LEAF_SPEED_RANGE = [3, 6];
const LEAF_SIZE_RANGE = [0.6, 1];
const LEAF_OPACITY = 0.7;
/** Leaves shrink away rather than fade: toon materials cannot fade per instance (D-43). */
const LEAF_GROW_FOR = 0.3;
const LEAF_SHRINK_FROM = 0.7;

/** Longest frame step honoured, so a backgrounded tab does not jump every mark. */
const MAX_STEP = 0.1;

/** XOR'd into the world seed so the wind direction has its own stream. */
const WIND_SEED_SALT = 0x77a1d5e3;

function between([min, max]) {
  return min + Math.random() * (max - min);
}

/**
 * @param {import('three').Scene} scene
 * @param {{seed: number, config: {groundY: number}}} world
 * @param {{now?: () => number}} [options]
 */
export function createWind(scene, world, { now = () => performance.now() / 1000 } = {}) {
  const directionRng = createRng((world.seed ^ WIND_SEED_SALT) >>> 0);
  const windHeading = directionRng() * Math.PI * 2;
  // Same heading convention as the glider: forward is (sin h, 0, cos h).
  const windX = Math.sin(windHeading);
  const windZ = Math.cos(windHeading);
  const floorY = world.config.groundY + GROUND_CLEARANCE;

  // --- streaks -------------------------------------------------------------
  const streakVertexCount = STREAK_COUNT * SEGMENTS_PER_STREAK * 2;
  const positions = new Float32Array(streakVertexCount * 3);
  // Four components per colour, so each vertex carries its own alpha: the
  // tail fades into the air and the whole streak fades in and out.
  const colors = new Float32Array(streakVertexCount * 4);
  const streakGeometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 4);
  positionAttribute.setUsage(DynamicDrawUsage);
  colorAttribute.setUsage(DynamicDrawUsage);
  streakGeometry.setAttribute('position', positionAttribute);
  streakGeometry.setAttribute('color', colorAttribute);

  const streaks = new LineSegments(
    streakGeometry,
    new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  // Bounds go stale as the marks move; culling them would pop streaks out.
  streaks.frustumCulled = false;
  // Step before the leaves draw, since this mesh's hook steps both.
  streaks.renderOrder = -1;

  const streakColor = new Color(PALETTE.wind);
  const streakState = Array.from({ length: STREAK_COUNT }, () => ({
    age: 0, life: 1, x: 0, y: 0, z: 0, speed: 0, phase: 0, curlRate: 0,
  }));

  // --- leaves --------------------------------------------------------------
  const leafGeometry = new OctahedronGeometry(0.22, 0);
  leafGeometry.scale(1, 0.22, 0.6);
  const leaves = new InstancedMesh(
    leafGeometry,
    toonMaterial(0xffffff, { transparent: true, opacity: LEAF_OPACITY, depthWrite: false }),
    LEAF_COUNT,
  );
  leaves.frustumCulled = false;
  const leafColor = new Color();
  const leafAltColor = new Color(PALETTE.canopyAlt);
  for (let i = 0; i < LEAF_COUNT; i += 1) leaves.setColorAt(i, leafColor.set(PALETTE.canopy));

  const leafState = Array.from({ length: LEAF_COUNT }, () => ({
    age: 0, life: 1, x: 0, y: 0, z: 0, speed: 0, phase: 0,
    rotX: 0, rotY: 0, spinX: 0, spinY: 0, size: 1,
  }));
  const scratch = new Object3D();

  /** Put a mark somewhere near the camera, part-way through its life so they do not all start together. */
  function place(mark, camera, lifeRange, speedRange, stagger) {
    const angle = Math.random() * Math.PI * 2;
    // sqrt spreads marks evenly over the disc instead of bunching at the centre.
    const out = Math.sqrt(Math.random()) * SPAWN_RADIUS;
    mark.x = camera.position.x + Math.sin(angle) * out;
    mark.z = camera.position.z + Math.cos(angle) * out;
    mark.y = Math.max(floorY, camera.position.y + between([-SPAWN_BELOW, SPAWN_ABOVE]));
    mark.life = between(lifeRange);
    mark.age = stagger ? Math.random() * mark.life : 0;
    mark.speed = between(speedRange);
    mark.phase = Math.random() * Math.PI * 2;
  }

  function placeLeaf(i, camera, stagger) {
    const leaf = leafState[i];
    place(leaf, camera, LEAF_LIFETIME_RANGE, LEAF_SPEED_RANGE, stagger);
    leaf.rotX = Math.random() * Math.PI * 2;
    leaf.rotY = Math.random() * Math.PI * 2;
    leaf.spinX = between([-5, 5]);
    leaf.spinY = between([-3, 3]);
    leaf.size = between(LEAF_SIZE_RANGE);
    leaves.setColorAt(i, leafColor.set(PALETTE.canopy).lerp(leafAltColor, Math.random()));
    leaves.instanceColor.needsUpdate = true;
  }

  function outOfRange(mark, camera) {
    const dx = mark.x - camera.position.x;
    const dz = mark.z - camera.position.z;
    return dx * dx + dz * dz > RECYCLE_RADIUS * RECYCLE_RADIUS;
  }

  function writeStreak(i, mark) {
    const t = mark.age / mark.life;
    // Fade in and out over the life, never popping.
    const fade = Math.sin(Math.PI * t) * STREAK_OPACITY;
    let v = i * SEGMENTS_PER_STREAK * 2;
    let prevX = 0;
    let prevY = 0;
    let prevZ = 0;
    let prevA = 0;
    for (let k = 0; k < POINTS_PER_STREAK; k += 1) {
      // k = 0 is the head; later points trail back up-wind.
      const back = k * STREAK_SEGMENT_LENGTH;
      const wave = mark.phase + mark.age * mark.curlRate - k * 0.7;
      const side = Math.sin(wave) * STREAK_CURL * (k / SEGMENTS_PER_STREAK);
      const x = mark.x - windX * back + windZ * side;
      const y = mark.y + Math.cos(wave) * STREAK_CURL * 0.4;
      const z = mark.z - windZ * back - windX * side;
      const a = fade * (1 - k / SEGMENTS_PER_STREAK);
      if (k > 0) {
        writeVertex(v, prevX, prevY, prevZ, prevA);
        writeVertex(v + 1, x, y, z, a);
        v += 2;
      }
      prevX = x;
      prevY = y;
      prevZ = z;
      prevA = a;
    }
  }

  function writeVertex(v, x, y, z, a) {
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    colors[v * 4] = streakColor.r;
    colors[v * 4 + 1] = streakColor.g;
    colors[v * 4 + 2] = streakColor.b;
    colors[v * 4 + 3] = a;
  }

  let lastTime = null;

  function step(dt, camera) {
    const first = lastTime === null;
    for (let i = 0; i < STREAK_COUNT; i += 1) {
      const mark = streakState[i];
      if (first) {
        place(mark, camera, STREAK_LIFETIME_RANGE, STREAK_SPEED_RANGE, true);
        mark.curlRate = between([1.5, 3]);
      }
      mark.age += dt;
      if (mark.age >= mark.life || outOfRange(mark, camera)) {
        place(mark, camera, STREAK_LIFETIME_RANGE, STREAK_SPEED_RANGE, false);
      }
      mark.x += windX * mark.speed * dt;
      mark.z += windZ * mark.speed * dt;
      writeStreak(i, mark);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;

    for (let i = 0; i < LEAF_COUNT; i += 1) {
      const leaf = leafState[i];
      if (first) placeLeaf(i, camera, true);
      leaf.age += dt;
      if (leaf.age >= leaf.life || outOfRange(leaf, camera)) placeLeaf(i, camera, false);
      // Carried along the wind, rocking side to side and bobbing as it tumbles.
      const sway = Math.sin(leaf.age * 2.3 + leaf.phase) * 0.8;
      leaf.x += (windX * leaf.speed + windZ * sway) * dt;
      leaf.z += (windZ * leaf.speed - windX * sway) * dt;
      leaf.y = Math.max(floorY, leaf.y + Math.sin(leaf.age * 1.7 + leaf.phase) * 0.6 * dt);
      leaf.rotX += leaf.spinX * dt;
      leaf.rotY += leaf.spinY * dt;

      const t = leaf.age / leaf.life;
      const grow = Math.min(1, leaf.age / LEAF_GROW_FOR);
      const shrink = t < LEAF_SHRINK_FROM ? 1 : 1 - (t - LEAF_SHRINK_FROM) / (1 - LEAF_SHRINK_FROM);
      scratch.position.set(leaf.x, leaf.y, leaf.z);
      scratch.rotation.set(leaf.rotX, leaf.rotY, 0);
      scratch.scale.setScalar(leaf.size * grow * shrink);
      scratch.updateMatrix();
      leaves.setMatrixAt(i, scratch.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
  }

  streaks.onBeforeRender = (_renderer, _scene, camera) => {
    const time = now();
    const dt = lastTime === null ? 0 : Math.min(time - lastTime, MAX_STEP);
    step(dt, camera);
    lastTime = time;
  };

  scene.add(streaks);
  scene.add(leaves);

  return {
    /** The prevailing wind, as a heading in the glider's convention. */
    heading: windHeading,
  };
}
