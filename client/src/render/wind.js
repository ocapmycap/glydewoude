/**
 * Signs of wind near the camera: curling ribbons of air and leaves tumbling
 * past, with the odd gust sweeping a bundle of big ribbons by (LAN-552,
 * LAN-573).
 *
 * Purely visual. Nothing here reaches the simulation, so wind never changes
 * glide feel (D-61). The whole forest shares one prevailing direction, picked
 * from the world seed, so it reads as weather rather than noise.
 *
 * Every streak is a camera-facing ribbon in one indexed buffer and every leaf
 * is an instance of one InstancedMesh, both built once. A mark that fades out,
 * or that the camera has left behind, is respawned in place near the camera,
 * so the cost is two draw calls and no per-frame allocation however large the
 * forest is (D-62). Gusts draw from slots reserved at the end of each pool,
 * which sit idle between gusts (D-75).
 *
 * Like the leaf burst, the effect keeps its own clock and steps itself in
 * `onBeforeRender`, which also hands over the camera it is drawn for.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
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
/**
 * Marks fade out between these distances from the camera, so nothing is ever
 * drawn closer than 3 m and a mark drifting through the lens cannot fill the
 * screen.
 */
const CAMERA_CLEAR_RANGE = [3, 6];

/**
 * Each mark draws a size in [0, 1] as `random ** SIZE_BIAS`; every size
 * range below is interpolated by it. A bias above 1 keeps most marks small so
 * the big ones stay special.
 */
const SIZE_BIAS = 2.2;

const POINTS_PER_STREAK = 10;
const SEGMENTS_PER_STREAK = POINTS_PER_STREAK - 1;
const STREAK_LENGTH_RANGE = [4, 20];
/**
 * Ribbon width at the head. WebGL draws lines one pixel wide whatever
 * `linewidth` says, which no length can make noticeable, so streaks are
 * quads with real width in the world.
 */
const STREAK_WIDTH_RANGE = [0.15, 0.5];
/** Width left at the tail, as a fraction of the head. */
const STREAK_TAIL_WIDTH = 0.15;
/** Points over which the head fades in, so the ribbon has no blunt front end. */
const STREAK_HEAD_SOFTEN = 1.5;
/** Peak opacity, rising with size so the big ribbons read first. */
const STREAK_OPACITY_RANGE = [0.45, 0.75];
const STREAK_CURL_RANGE = [0.45, 1.6];
const STREAK_CURL_RATE_RANGE = [1.5, 3];
const STREAK_LIFETIME_RANGE = [1.8, 3.4];
const STREAK_SPEED_RANGE = [6, 10];

const LEAF_LIFETIME_RANGE = [3, 5.5];
const LEAF_SPEED_RANGE = [3, 6];
const LEAF_SIZE_RANGE = [0.8, 2.5];
const LEAF_OPACITY = 0.7;
/** Leaves shrink away rather than fade: toon materials cannot fade per instance (D-43). */
const LEAF_GROW_FOR = 0.3;
const LEAF_SHRINK_FROM = 0.7;

/** Seconds from the start of one gust to the start of the next. */
const GUST_INTERVAL_RANGE = [6, 12];
/** Slots reserved at the end of each pool; a gust wakes a random number of them. */
const GUST_STREAK_SLOTS = 10;
const GUST_STREAK_COUNT_RANGE = [6, 10];
const GUST_LEAF_SLOTS = 6;
const GUST_LEAF_COUNT_RANGE = [4, 6];
/** Gust marks start up to this long apart, so the burst sweeps rather than blinks. */
const GUST_STAGGER = 0.4;
/** Stagger plus the longest life comes to about 1.5 s for the whole gust. */
const GUST_STREAK_LIFETIME_RANGE = [0.9, 1.1];
const GUST_LEAF_LIFETIME_RANGE = [1, 1.1];
/** Gust marks take the top of every size range. */
const GUST_SIZE_RANGE = [0.8, 1];
const GUST_STREAK_SPEED_RANGE = [16, 22];
const GUST_LEAF_SPEED_RANGE = [10, 14];
/**
 * Gust marks start this far up-wind of the camera and pass it at least this
 * far off to the side (or above and below), so the sweep goes by the squirrel
 * rather than through it.
 */
const GUST_UPWIND_RANGE = [6, 16];
const GUST_SIDE_RANGE = [6, 20];
const GUST_VERTICAL_RANGE = [-6, 6];

/** Longest frame step honoured, so a backgrounded tab does not jump every mark. */
const MAX_STEP = 0.1;

/** XOR'd into the world seed so the wind direction has its own stream. */
const WIND_SEED_SALT = 0x77a1d5e3;

function between([min, max]) {
  return min + Math.random() * (max - min);
}

function lerp([min, max], t) {
  return min + (max - min) * t;
}

function betweenInt([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 0 at the near edge of `CAMERA_CLEAR_RANGE` and closer, 1 beyond its far edge. */
function cameraClearance(dx, dy, dz) {
  const [near, far] = CAMERA_CLEAR_RANGE;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.min(1, Math.max(0, (d - near) / (far - near)));
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
  const streakTotal = STREAK_COUNT + GUST_STREAK_SLOTS;
  // Each point of the centre line becomes a left and a right vertex.
  const streakVertexCount = streakTotal * POINTS_PER_STREAK * 2;
  const positions = new Float32Array(streakVertexCount * 3);
  // Four components per colour, so each vertex carries its own alpha: the
  // tail fades into the air and the whole streak fades in and out.
  const colors = new Float32Array(streakVertexCount * 4);
  const indices = new Uint16Array(streakTotal * SEGMENTS_PER_STREAK * 6);
  for (let i = 0, n = 0; i < streakTotal; i += 1) {
    for (let k = 0; k < SEGMENTS_PER_STREAK; k += 1) {
      const a = (i * POINTS_PER_STREAK + k) * 2;
      indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], n);
      n += 6;
    }
  }
  const streakGeometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 4);
  positionAttribute.setUsage(DynamicDrawUsage);
  colorAttribute.setUsage(DynamicDrawUsage);
  streakGeometry.setAttribute('position', positionAttribute);
  streakGeometry.setAttribute('color', colorAttribute);
  streakGeometry.setIndex(new BufferAttribute(indices, 1));

  const streaks = new Mesh(
    streakGeometry,
    new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  // Bounds go stale as the marks move; culling them would pop streaks out.
  streaks.frustumCulled = false;
  // Step before the leaves draw, since this mesh's hook steps both.
  streaks.renderOrder = -1;

  const streakColor = new Color(PALETTE.wind);
  const streakState = Array.from({ length: streakTotal }, (_, i) => ({
    age: 0, life: 1, x: 0, y: 0, z: 0, speed: 0, phase: 0, curlRate: 0,
    length: 0, width: 0, opacity: 0, curl: 0,
    gust: i >= STREAK_COUNT, idle: i >= STREAK_COUNT,
  }));
  // The centre line of the streak being written, reused for every streak.
  const centre = new Float32Array(POINTS_PER_STREAK * 3);

  // --- leaves --------------------------------------------------------------
  const leafTotal = LEAF_COUNT + GUST_LEAF_SLOTS;
  const leafGeometry = new OctahedronGeometry(0.22, 0);
  leafGeometry.scale(1, 0.22, 0.6);
  const leaves = new InstancedMesh(
    leafGeometry,
    toonMaterial(0xffffff, { transparent: true, opacity: LEAF_OPACITY, depthWrite: false }),
    leafTotal,
  );
  leaves.frustumCulled = false;
  const leafColor = new Color();
  const leafAltColor = new Color(PALETTE.canopyAlt);
  for (let i = 0; i < leafTotal; i += 1) leaves.setColorAt(i, leafColor.set(PALETTE.canopy));

  const leafState = Array.from({ length: leafTotal }, (_, i) => ({
    age: 0, life: 1, x: 0, y: 0, z: 0, speed: 0, phase: 0,
    rotX: 0, rotY: 0, spinX: 0, spinY: 0, size: 1,
    gust: i >= LEAF_COUNT, idle: i >= LEAF_COUNT,
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
    mark.idle = false;
  }

  /**
   * Put a gust mark up-wind of the camera and off to one side, waiting a
   * random part of `GUST_STAGGER` before it appears (a negative age).
   */
  function placeGust(mark, camera, lifeRange, speedRange) {
    const upwind = between(GUST_UPWIND_RANGE);
    const side = between(GUST_SIDE_RANGE) * (Math.random() < 0.5 ? -1 : 1);
    mark.x = camera.position.x - windX * upwind + windZ * side;
    mark.z = camera.position.z - windZ * upwind - windX * side;
    mark.y = Math.max(floorY, camera.position.y + between(GUST_VERTICAL_RANGE));
    mark.life = between(lifeRange);
    mark.age = -Math.random() * GUST_STAGGER;
    mark.speed = between(speedRange);
    mark.phase = Math.random() * Math.PI * 2;
    mark.idle = false;
  }

  function sizeStreak(mark, size) {
    mark.length = lerp(STREAK_LENGTH_RANGE, size);
    mark.width = lerp(STREAK_WIDTH_RANGE, size);
    mark.opacity = lerp(STREAK_OPACITY_RANGE, size);
    mark.curl = lerp(STREAK_CURL_RANGE, size);
    mark.curlRate = between(STREAK_CURL_RATE_RANGE);
  }

  function placeStreak(mark, camera, stagger) {
    place(mark, camera, STREAK_LIFETIME_RANGE, STREAK_SPEED_RANGE, stagger);
    sizeStreak(mark, Math.random() ** SIZE_BIAS);
  }

  function placeGustStreak(mark, camera) {
    placeGust(mark, camera, GUST_STREAK_LIFETIME_RANGE, GUST_STREAK_SPEED_RANGE);
    sizeStreak(mark, between(GUST_SIZE_RANGE));
  }

  function colourLeaf(i) {
    leaves.setColorAt(i, leafColor.set(PALETTE.canopy).lerp(leafAltColor, Math.random()));
    leaves.instanceColor.needsUpdate = true;
  }

  function spinLeaf(leaf, size) {
    leaf.rotX = Math.random() * Math.PI * 2;
    leaf.rotY = Math.random() * Math.PI * 2;
    leaf.spinX = between([-5, 5]);
    leaf.spinY = between([-3, 3]);
    leaf.size = lerp(LEAF_SIZE_RANGE, size);
  }

  function placeLeaf(i, camera, stagger) {
    const leaf = leafState[i];
    place(leaf, camera, LEAF_LIFETIME_RANGE, LEAF_SPEED_RANGE, stagger);
    spinLeaf(leaf, Math.random() ** SIZE_BIAS);
    colourLeaf(i);
  }

  function placeGustLeaf(i, camera) {
    const leaf = leafState[i];
    placeGust(leaf, camera, GUST_LEAF_LIFETIME_RANGE, GUST_LEAF_SPEED_RANGE);
    spinLeaf(leaf, between(GUST_SIZE_RANGE));
    colourLeaf(i);
  }

  /** Wake a random number of each pool's gust slots, all at once. */
  function startGust(camera) {
    const streakCount = betweenInt(GUST_STREAK_COUNT_RANGE);
    for (let n = 0; n < streakCount; n += 1) {
      placeGustStreak(streakState[STREAK_COUNT + n], camera);
    }
    const leafCount = betweenInt(GUST_LEAF_COUNT_RANGE);
    for (let n = 0; n < leafCount; n += 1) placeGustLeaf(LEAF_COUNT + n, camera);
  }

  function outOfRange(mark, camera) {
    const dx = mark.x - camera.position.x;
    const dz = mark.z - camera.position.z;
    return dx * dx + dz * dz > RECYCLE_RADIUS * RECYCLE_RADIUS;
  }

  function writeStreak(i, mark, camera) {
    const t = mark.age / mark.life;
    // Fade in and out over the life, never popping. Idle and waiting gust
    // marks stay fully transparent.
    const fade = mark.idle || t < 0 ? 0 : Math.sin(Math.PI * Math.min(1, t)) * mark.opacity;
    const segment = mark.length / SEGMENTS_PER_STREAK;
    for (let k = 0; k < POINTS_PER_STREAK; k += 1) {
      // k = 0 is the head; later points trail back up-wind.
      const back = k * segment;
      const wave = mark.phase + mark.age * mark.curlRate - k * 0.7;
      const side = Math.sin(wave) * mark.curl * (k / SEGMENTS_PER_STREAK);
      centre[k * 3] = mark.x - windX * back + windZ * side;
      centre[k * 3 + 1] = mark.y + Math.cos(wave) * mark.curl * 0.4;
      centre[k * 3 + 2] = mark.z - windZ * back - windX * side;
    }

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    let v = i * POINTS_PER_STREAK * 2;
    for (let k = 0; k < POINTS_PER_STREAK; k += 1) {
      const x = centre[k * 3];
      const y = centre[k * 3 + 1];
      const z = centre[k * 3 + 2];
      // Direction along the ribbon, from its neighbours on either side.
      const ahead = Math.max(0, k - 1) * 3;
      const behind = Math.min(SEGMENTS_PER_STREAK, k + 1) * 3;
      const tx = centre[ahead] - centre[behind];
      const ty = centre[ahead + 1] - centre[behind + 1];
      const tz = centre[ahead + 2] - centre[behind + 2];
      // Crossing it with the line of sight turns the ribbon's face to the camera.
      const vx = x - cx;
      const vy = y - cy;
      const vz = z - cz;
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const along = k / SEGMENTS_PER_STREAK;
      const half = (mark.width / 2) * (1 - along * (1 - STREAK_TAIL_WIDTH));
      const norm = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (norm > 1e-6) {
        sx *= half / norm;
        sy *= half / norm;
        sz *= half / norm;
      } else {
        sx = 0;
        sy = half;
        sz = 0;
      }
      const a = fade * Math.min(1, (k + 0.5) / STREAK_HEAD_SOFTEN) * (1 - along) * cameraClearance(vx, vy, vz);
      writeVertex(v, x + sx, y + sy, z + sz, a);
      writeVertex(v + 1, x - sx, y - sy, z - sz, a);
      v += 2;
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
  let untilGust = between(GUST_INTERVAL_RANGE);

  function step(dt, camera) {
    const first = lastTime === null;
    untilGust -= dt;
    if (untilGust <= 0) {
      startGust(camera);
      untilGust = between(GUST_INTERVAL_RANGE);
    }

    for (let i = 0; i < streakTotal; i += 1) {
      const mark = streakState[i];
      if (first && !mark.gust) placeStreak(mark, camera, true);
      if (!mark.idle) {
        mark.age += dt;
        if (mark.age >= mark.life || outOfRange(mark, camera)) {
          // A spent gust mark waits for the next gust instead of respawning.
          if (mark.gust) mark.idle = true;
          else placeStreak(mark, camera, false);
        }
        // Waiting gust marks hold still until their turn.
        if (mark.age >= 0) {
          mark.x += windX * mark.speed * dt;
          mark.z += windZ * mark.speed * dt;
        }
      }
      writeStreak(i, mark, camera);
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;

    for (let i = 0; i < leafTotal; i += 1) {
      const leaf = leafState[i];
      if (first && !leaf.gust) placeLeaf(i, camera, true);
      if (!leaf.idle) {
        leaf.age += dt;
        if (leaf.age >= leaf.life || outOfRange(leaf, camera)) {
          if (leaf.gust) leaf.idle = true;
          else placeLeaf(i, camera, false);
        }
      }
      if (leaf.idle || leaf.age < 0) {
        scratch.scale.setScalar(0);
        scratch.updateMatrix();
        leaves.setMatrixAt(i, scratch.matrix);
        continue;
      }
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
      const clear = cameraClearance(
        leaf.x - camera.position.x,
        leaf.y - camera.position.y,
        leaf.z - camera.position.z,
      );
      scratch.position.set(leaf.x, leaf.y, leaf.z);
      scratch.rotation.set(leaf.rotX, leaf.rotY, 0);
      scratch.scale.setScalar(leaf.size * grow * shrink * clear);
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
