/**
 * Butterflies fluttering about the forest near the camera, in ones, pairs and
 * small groups, scattering when the squirrel flies through them (LAN-574).
 *
 * Purely decorative, like wind: nothing here reaches the simulation, and there
 * is nothing to collect (D-76). The squirrel's position arrives through a
 * getter for the same glider state the renderer draws, so this module never
 * imports `sim/`.
 *
 * The pool is fixed: `GROUP_COUNT` groups of up to `GROUP_SLOTS` butterflies,
 * each butterfly two wing instances of one InstancedMesh, all built once. A
 * group the camera has left behind respawns ahead of or beside it, so the cost
 * is one draw call and no per-frame allocation however large the forest is
 * (D-62, D-77).
 *
 * Like wind, the effect keeps its own clock and steps itself in
 * `onBeforeRender`, which also hands over the camera it is drawn for.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Object3D,
  Vector3,
} from 'three';

import { PALETTE, toonMaterial } from './materials.js';

const GROUP_COUNT = 10;
const GROUP_SLOTS = 4;
const BUTTERFLY_COUNT = GROUP_COUNT * GROUP_SLOTS;
/**
 * A new group's size is drawn from this table. Mostly ones and pairs, so the
 * forest reads as "a pair over there, one here" rather than a swarm. The mean
 * of 2.25 puts about 22 of the 40 slots in the air at once.
 */
const GROUP_SIZES = Object.freeze([1, 1, 2, 2, 2, 3, 3, 4]);
const GROUP_COLOURS = Object.freeze([
  PALETTE.butterflyWhite,
  PALETTE.butterflyYellow,
  PALETTE.butterflyOrange,
  PALETTE.butterflyBlue,
]);

/**
 * Groups respawn this far from the camera, within `SPAWN_SPREAD` either side
 * of where it is looking, and are recycled once further than
 * `RECYCLE_RADIUS`. Spawning mostly ahead means a gliding player flies
 * towards butterflies instead of leaving them all behind; the numbers keep
 * roughly 3–8 within 40 m of the camera (D-77).
 */
const SPAWN_DISTANCE_RANGE = [22, 70];
const SPAWN_SPREAD = Math.PI * 0.6;
/** The very first placement fills the whole disc around the camera, clear of it. */
const INITIAL_DISTANCE_RANGE = [8, 70];
/** Measured in 3D, so groups on the floor far below a high glide recycle too. */
const RECYCLE_RADIUS = 85;

/** Where a group lives, picked per spawn: near a perch, around canopy height, or low over the floor. */
const PERCH_SHARE = 0.45;
const FLOOR_SHARE = 0.2;
/** A perch group needs a tree with a perch within this far of its spawn point. */
const TREE_SEARCH_RADIUS = 25;
/** Around a perch: above the launch branch and out towards the canopy's rim, in canopy radii. */
const PERCH_HEIGHT_RANGE = [0.5, 3];
const PERCH_OUT_RANGE = [0.3, 1.1];
/** Canopy-height groups sit in this band around the camera's height. */
const CANOPY_BELOW = 10;
const CANOPY_ABOVE = 4;
const FLOOR_HEIGHT_RANGE = [0.5, 2.2];
/** Nothing flutters lower than this above the ground, except a floor butterfly at rest. */
const GROUND_CLEARANCE = 0.3;
/** A resting floor butterfly settles this far above the ground. */
const FLOOR_REST_HEIGHT = 0.05;

/** How far the group's centre wanders, in m/s. */
const DRIFT_SPEED_RANGE = [0.15, 0.35];
/**
 * Each butterfly traces its own looping path around the group's centre, two
 * sine waves per axis at unrelated frequencies so it never visibly repeats.
 * Radius times frequency comes to about 0.5–1.7 m/s.
 */
const PATH_RADIUS_RANGE = [1.2, 2.5];
const PATH_FREQUENCY_RANGE = [0.25, 0.5];
const PATH_BOB = 0.6;

/**
 * Wingbeats per second in normal flight. Big butterflies beat slowly; much
 * faster and they read as flies or bees (D-84).
 */
const FLAP_RATE_RANGE = [2, 3.5];
/**
 * Normal flight comes in bursts of a few beats, each followed by a glide on
 * wings held partly open. The lazy flap-flap-glide rhythm is most of what
 * says "butterfly" (D-84).
 */
const BURST_BEATS_RANGE = [2, 5];
const GLIDE_RANGE = [0.4, 1.2];
/** Wing angle held through a glide, in radians, 0 being flat. */
const GLIDE_ANGLE = 0.25;
/** Seconds to ease the wings into or out of a glide, so the beat never snaps. */
const GLIDE_EASE = 0.15;
/** Wingbeats per second at the start of a scatter: livelier, but no buzz, and no glides. */
const SCATTER_FLAP_RATE_RANGE = [4, 6];
/** Share of the scatter spent at the full scatter rate before easing back to normal. */
const SCATTER_FLAP_HOLD = 0.5;
/** Wing angle about the body in flight: centre and swing, in radians, 0 being flat. */
const FLAP_CENTRE = 0.35;
const FLAP_SWING = 0.75;
/** A resting butterfly holds its wings nearly closed above its back, slowly fanning them. */
const REST_ANGLE = 1.25;
const REST_FAN = 0.2;
/** The body lifts a little on each downstroke, which is most of what reads as "flutter". */
const FLAP_BOB = 0.05;

/** Seconds of flight between rests, and of each rest. */
const FLIGHT_RANGE = [4, 10];
const REST_RANGE = [1, 3];
/** Seconds to ease into or out of a rest, so nothing stops dead. */
const SETTLE_FOR = 0.4;

/** The squirrel inside this range of any butterfly scatters its whole group. */
const SCATTER_RADIUS = 4;
const SCATTER_DURATION = 2.5;
/**
 * Starting speeds away from and up from the squirrel, decaying to nothing
 * over the scatter, so the group carries about 6 m off and 4 m up.
 */
const SCATTER_SPEED = 5;
const SCATTER_RISE = 3;

const SIZE_RANGE = [1, 1.4];
/** Toon materials cannot fade per instance (D-43), so groups grow in and shrink by the lens. */
const APPEAR_FOR = 0.8;
const CAMERA_CLEAR_RANGE = [1, 2.5];

/** Longest frame step honoured, so a backgrounded tab does not jump every butterfly. */
const MAX_STEP = 0.1;

function between([min, max]) {
  return min + Math.random() * (max - min);
}

function burstBeats() {
  const [min, max] = BURST_BEATS_RANGE;
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** 0 at the near edge of `CAMERA_CLEAR_RANGE` and closer, 1 beyond its far edge. */
function cameraClearance(dx, dy, dz) {
  const [near, far] = CAMERA_CLEAR_RANGE;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Math.min(1, Math.max(0, (d - near) / (far - near)));
}

/**
 * One wing, flat in the XZ plane with its root along the body on the Z axis,
 * tip towards +X and head towards +Z: a forewing and a smaller hindwing as one
 * low-poly fan. The other wing is the same instance mirrored.
 */
function createWingGeometry() {
  const outline = [
    [0, 0.1], [0.16, 0.24], [0.36, 0.2], [0.34, 0.04],
    [0.28, -0.08], [0.24, -0.22], [0.1, -0.2], [0, -0.1],
  ];
  const positions = new Float32Array((outline.length + 1) * 3);
  outline.forEach(([x, z], i) => positions.set([x, 0, z], (i + 1) * 3));
  const indices = [];
  // Wound so the face points up (+Y) with the wing flat.
  for (let i = 1; i < outline.length; i += 1) indices.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * @param {import('three').Scene} scene
 * @param {{trees: Array<object>, config: {groundY: number}}} world
 * @param {{now?: () => number, glider?: () => ({motion: {x: number, y: number, z: number}} | null)}} [options]
 *   `glider` returns the glider state the renderer is drawing this frame.
 */
export function createButterflies(
  scene,
  world,
  { now = () => performance.now() / 1000, glider = () => null } = {},
) {
  const groundY = world.config.groundY;
  // Towering trees have no perch (D-63), so there is nothing to flutter round.
  const perchTrees = world.trees.filter((tree) => tree.perchY !== null);

  const wings = new InstancedMesh(
    createWingGeometry(),
    toonMaterial(0xffffff, { side: DoubleSide }),
    BUTTERFLY_COUNT * 2,
  );
  // Bounds go stale as the butterflies move; culling them would pop groups out.
  wings.frustumCulled = false;
  const colour = new Color();
  for (let i = 0; i < BUTTERFLY_COUNT * 2; i += 1) wings.setColorAt(i, colour.set(PALETTE.butterflyWhite));

  const groups = Array.from({ length: GROUP_COUNT }, () => ({
    x: 0, y: 0, z: 0, driftX: 0, driftZ: 0,
    size: 0, floor: false, appear: 0,
    scatter: 0, awayX: 0, awayZ: 0,
  }));
  const butterflies = Array.from({ length: BUTTERFLY_COUNT }, () => ({
    t: 0, fx: 0, fy: 0, fz: 0, px: 0, py: 0, pz: 0, radius: 0,
    x: 0, y: 0, z: 0, heading: 0, flap: 0, flapRate: 0, scatterFlapRate: 0,
    beats: 0, glide: 0, glideBlend: 0,
    rest: 0, untilRest: 0, settle: 0, size: 1,
  }));
  const scratch = new Object3D();
  // Heading, then pitch, then the wing's roll about the body.
  scratch.rotation.order = 'YXZ';
  const forward = new Vector3();

  function nearestPerchTree(x, z) {
    let best = null;
    let bestDistance = TREE_SEARCH_RADIUS * TREE_SEARCH_RADIUS;
    for (const tree of perchTrees) {
      const dx = tree.position.x - x;
      const dz = tree.position.z - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        best = tree;
        bestDistance = distance;
      }
    }
    return best;
  }

  function withinRecycle(x, y, z, camera) {
    const dx = x - camera.position.x;
    const dy = y - camera.position.y;
    const dz = z - camera.position.z;
    return dx * dx + dy * dy + dz * dz <= RECYCLE_RADIUS * RECYCLE_RADIUS;
  }

  /** Set the group's centre height for its kind, falling back to canopy height if that would be out of range. */
  function placeHeight(group, camera) {
    const roll = Math.random();
    group.floor = false;
    if (roll < PERCH_SHARE) {
      const tree = nearestPerchTree(group.x, group.z);
      if (tree) {
        const angle = Math.random() * Math.PI * 2;
        const out = between(PERCH_OUT_RANGE) * tree.canopyRadius;
        const x = tree.position.x + Math.sin(angle) * out;
        const z = tree.position.z + Math.cos(angle) * out;
        const y = tree.perchY + between(PERCH_HEIGHT_RANGE);
        if (withinRecycle(x, y, z, camera)) {
          group.x = x;
          group.y = y;
          group.z = z;
          return;
        }
      }
    } else if (roll < PERCH_SHARE + FLOOR_SHARE) {
      const y = groundY + between(FLOOR_HEIGHT_RANGE);
      if (withinRecycle(group.x, y, group.z, camera)) {
        group.y = y;
        group.floor = true;
        return;
      }
    }
    group.y = Math.max(
      groundY + FLOOR_HEIGHT_RANGE[1],
      camera.position.y + between([-CANOPY_BELOW, CANOPY_ABOVE]),
    );
  }

  function spawnGroup(g, camera, initial) {
    const group = groups[g];
    let angle;
    let distance;
    if (initial) {
      angle = Math.random() * Math.PI * 2;
      // sqrt spreads groups evenly over the ring instead of bunching inside it.
      const [near, far] = INITIAL_DISTANCE_RANGE;
      distance = Math.sqrt(near * near + Math.random() * (far * far - near * near));
    } else {
      camera.getWorldDirection(forward);
      angle = Math.atan2(forward.x, forward.z) + between([-SPAWN_SPREAD, SPAWN_SPREAD]);
      distance = between(SPAWN_DISTANCE_RANGE);
    }
    group.x = camera.position.x + Math.sin(angle) * distance;
    group.z = camera.position.z + Math.cos(angle) * distance;
    placeHeight(group, camera);

    const drift = Math.random() * Math.PI * 2;
    const driftSpeed = between(DRIFT_SPEED_RANGE);
    group.driftX = Math.sin(drift) * driftSpeed;
    group.driftZ = Math.cos(drift) * driftSpeed;
    group.size = GROUP_SIZES[Math.floor(Math.random() * GROUP_SIZES.length)];
    group.appear = 0;
    group.scatter = 0;

    colour.set(GROUP_COLOURS[Math.floor(Math.random() * GROUP_COLOURS.length)]);
    for (let k = 0; k < GROUP_SLOTS; k += 1) {
      const i = g * GROUP_SLOTS + k;
      const b = butterflies[i];
      b.t = Math.random() * 100;
      b.fx = between(PATH_FREQUENCY_RANGE);
      b.fy = between(PATH_FREQUENCY_RANGE);
      b.fz = between(PATH_FREQUENCY_RANGE);
      b.px = Math.random() * Math.PI * 2;
      b.py = Math.random() * Math.PI * 2;
      b.pz = Math.random() * Math.PI * 2;
      b.radius = between(PATH_RADIUS_RANGE);
      b.flap = Math.random() * Math.PI * 2;
      b.flapRate = between(FLAP_RATE_RANGE) * Math.PI * 2;
      b.scatterFlapRate = between(SCATTER_FLAP_RATE_RANGE) * Math.PI * 2;
      b.beats = burstBeats();
      b.glide = 0;
      b.glideBlend = 0;
      b.rest = 0;
      b.untilRest = between(FLIGHT_RANGE);
      b.settle = 0;
      b.size = between(SIZE_RANGE);
      wings.setColorAt(i * 2, colour);
      wings.setColorAt(i * 2 + 1, colour);
    }
    wings.instanceColor.needsUpdate = true;
  }

  function hideWings(i) {
    scratch.scale.setScalar(0);
    scratch.updateMatrix();
    wings.setMatrixAt(i * 2, scratch.matrix);
    wings.setMatrixAt(i * 2 + 1, scratch.matrix);
  }

  function writeWings(i, b, angle, scale) {
    scratch.position.set(b.x, b.y, b.z);
    scratch.rotation.set(0, b.heading, angle);
    scratch.scale.setScalar(scale);
    scratch.updateMatrix();
    wings.setMatrixAt(i * 2, scratch.matrix);
    // Mirroring across the body flips which way a roll lifts the tip, so the
    // twin wing rolls the other way to rise with it.
    scratch.rotation.set(0, b.heading, -angle);
    scratch.scale.set(-scale, scale, scale);
    scratch.updateMatrix();
    wings.setMatrixAt(i * 2 + 1, scratch.matrix);
  }

  /** Scatter the group if the squirrel is inside `SCATTER_RADIUS` of any of its butterflies. */
  function checkScatter(g, sx, sy, sz) {
    const group = groups[g];
    for (let k = 0; k < group.size; k += 1) {
      const b = butterflies[g * GROUP_SLOTS + k];
      const dx = b.x - sx;
      const dy = b.y - sy;
      const dz = b.z - sz;
      if (dx * dx + dy * dy + dz * dz > SCATTER_RADIUS * SCATTER_RADIUS) continue;
      const ax = group.x - sx;
      const az = group.z - sz;
      const length = Math.sqrt(ax * ax + az * az);
      if (length > 1e-3) {
        group.awayX = ax / length;
        group.awayZ = az / length;
      } else {
        const angle = Math.random() * Math.PI * 2;
        group.awayX = Math.sin(angle);
        group.awayZ = Math.cos(angle);
      }
      group.scatter = SCATTER_DURATION;
      return;
    }
  }

  let lastTime = null;
  let clock = 0;

  function step(dt, camera) {
    const first = lastTime === null;
    clock += dt;
    const state = glider();
    const squirrel = state?.motion ?? null;

    for (let g = 0; g < GROUP_COUNT; g += 1) {
      const group = groups[g];
      if (first) spawnGroup(g, camera, true);
      else if (!withinRecycle(group.x, group.y, group.z, camera)) spawnGroup(g, camera, false);

      if (squirrel) checkScatter(g, squirrel.x, squirrel.y, squirrel.z);
      // 1 at the start of a scatter, easing to 0 as the group settles again.
      const fright = group.scatter / SCATTER_DURATION;
      group.scatter = Math.max(0, group.scatter - dt);
      group.x += (group.driftX + group.awayX * SCATTER_SPEED * fright) * dt;
      group.z += (group.driftZ + group.awayZ * SCATTER_SPEED * fright) * dt;
      group.y += SCATTER_RISE * fright * dt;
      group.appear = Math.min(1, group.appear + dt / APPEAR_FOR);

      for (let k = 0; k < GROUP_SLOTS; k += 1) {
        const i = g * GROUP_SLOTS + k;
        if (k >= group.size) {
          hideWings(i);
          continue;
        }
        const b = butterflies[i];

        if (fright > 0) {
          b.rest = 0;
        } else if (b.rest > 0) {
          b.rest -= dt;
        } else {
          b.untilRest -= dt;
          if (b.untilRest <= 0) {
            b.rest = between(REST_RANGE);
            b.untilRest = between(FLIGHT_RANGE);
          }
        }
        const settleStep = dt / SETTLE_FOR;
        b.settle = b.rest > 0 ? Math.min(1, b.settle + settleStep) : Math.max(0, b.settle - settleStep);

        // The path clock slows to a stop into a rest and races in a scatter.
        b.t += dt * (1 - b.settle) * (1 + 2 * fright);
        // A scatter cuts any glide short and holds the scatter rate for a
        // while, easing back to the normal beat as the group calms.
        const alarm = Math.min(1, fright / (1 - SCATTER_FLAP_HOLD));
        if (fright > 0) b.glide = 0;
        else if (b.glide > 0) b.glide -= dt;
        const glideStep = dt / GLIDE_EASE;
        b.glideBlend = b.glide > 0 ? Math.min(1, b.glideBlend + glideStep) : Math.max(0, b.glideBlend - glideStep);
        if (b.glide <= 0) {
          const rate = b.flapRate + (b.scatterFlapRate - b.flapRate) * alarm;
          const before = Math.floor(b.flap / (Math.PI * 2));
          b.flap += dt * rate * (1 - b.settle);
          const beaten = Math.floor(b.flap / (Math.PI * 2)) - before;
          if (beaten > 0 && fright === 0) {
            b.beats -= beaten;
            if (b.beats <= 0) {
              // The phase stops where a beat begins, wings mid-swing and near
              // the glide angle, so easing into the glide barely moves them.
              b.glide = between(GLIDE_RANGE);
              b.beats = burstBeats();
            }
          }
        }
        const wx = Math.sin(b.fx * b.t + b.px) + 0.4 * Math.sin(2.3 * b.fx * b.t + b.pz);
        const wz = Math.cos(b.fz * b.t + b.pz) + 0.4 * Math.sin(1.7 * b.fz * b.t + b.px);
        const x = group.x + wx * b.radius;
        const z = group.z + wz * b.radius;
        const dx = x - b.x;
        const dz = z - b.z;
        if (dx * dx + dz * dz > 1e-8) b.heading = Math.atan2(dx, dz);
        b.x = x;
        b.z = z;

        const flying = group.y + Math.sin(b.fy * b.t + b.py) * PATH_BOB
          + Math.sin(b.flap) * FLAP_BOB * (1 - b.glideBlend);
        const floorY = groundY + GROUND_CLEARANCE;
        const resting = group.floor ? groundY + FLOOR_REST_HEIGHT : Math.max(floorY, flying);
        b.y = Math.max(floorY, flying) * (1 - b.settle) + resting * b.settle;

        const beatAngle = FLAP_CENTRE + Math.sin(b.flap) * FLAP_SWING;
        const flyAngle = beatAngle * (1 - b.glideBlend) + GLIDE_ANGLE * b.glideBlend;
        const restAngle = REST_ANGLE + Math.sin(clock * 1.5 + b.px) * REST_FAN;
        const angle = flyAngle * (1 - b.settle) + restAngle * b.settle;
        const clear = cameraClearance(
          b.x - camera.position.x,
          b.y - camera.position.y,
          b.z - camera.position.z,
        );
        writeWings(i, b, angle, b.size * group.appear * clear);
      }
    }
    wings.instanceMatrix.needsUpdate = true;
  }

  wings.onBeforeRender = (_renderer, _scene, camera) => {
    const time = now();
    const dt = lastTime === null ? 0 : Math.min(time - lastTime, MAX_STEP);
    step(dt, camera);
    lastTime = time;
  };

  scene.add(wings);
}
