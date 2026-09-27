/**
 * Scene assembly and the draw call.
 *
 * Everything that imports Three.js lives under client/src/render. Nothing in
 * client/src/sim does, which is what lets the tests run the real glide loop in
 * plain Node.
 */

import {
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

import { PALETTE, toonMaterial } from './materials.js';
import { createForest } from './trees.js';
import { createStructures } from './structures.js';
import { createSquirrel } from './squirrel.js';
import { createFollowCamera } from './follow-camera.js';

export function createRenderer(canvas, world) {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setClearColor(PALETTE.sky);
  // Cap DPR: retina at 3x costs nine times the pixels for very little here.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new Scene();
  scene.background = new Color(PALETTE.sky);
  // Fog hides the far rim of the disc, so the forest reads as endless.
  scene.fog = new Fog(PALETTE.fog, world.config.areaRadius * 0.5, world.config.areaRadius * 2.1);

  const camera = new PerspectiveCamera(68, 1, 0.5, world.config.areaRadius * 4);
  const followCamera = createFollowCamera(camera);

  scene.add(new HemisphereLight(0xdff0ff, PALETTE.groundDeep, 1.05));
  const sun = new DirectionalLight(0xfff3d6, 1.4);
  sun.position.set(-120, 200, 90);
  scene.add(sun);

  const ground = new Mesh(
    new CircleGeometry(world.config.areaRadius * 2.4, 48),
    toonMaterial(PALETTE.ground),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = world.config.groundY;
  scene.add(ground);

  scene.add(createForest(world));
  scene.add(createStructures(world));

  const squirrel = createSquirrel();
  scene.add(squirrel.object);

  // Reused across every projectToScreen call (LAN-567) — a per-tree label
  // projection every frame is exactly the kind of allocation that shows up
  // in a profiler if it is not scratch.
  const projectionScratch = new Vector3();
  const viewSpaceScratch = new Vector3();

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  return {
    scene,
    camera,
    resize,

    /** Jump the camera rather than sweeping it across the map. */
    reset() {
      followCamera.reset();
    },

    /**
     * @param {object} glider  current glider state from the simulation
     * @param {number} dt      seconds since the last draw
     */
    render(glider, dt) {
      const { motion } = glider;
      const gliding = glider.phase === 'gliding';
      // A cling's position is a point on the bark, not a branch to stand
      // on, so it skips the perch's lift and lets the pose meet the trunk. A
      // trunk climb (LAN-571) is the same pose scampering up the same bark.
      const clinging = glider.phase === 'clinging';
      const climbing = glider.phase === 'climbing';

      squirrel.object.position.set(
        motion.x,
        motion.y + (gliding || clinging || climbing ? 0 : 0.55),
        motion.z,
      );
      squirrel.object.rotation.y = motion.heading;
      // Pitch the nose along the flight path, and bank into the turn.
      squirrel.object.rotation.x = gliding
        ? MathUtils.clamp(Math.atan2(motion.vy, Math.max(motion.speed, 1)), -0.9, 0.6)
        : 0;
      squirrel.update(
        gliding ? 1 : 0,
        gliding ? MathUtils.clamp(motion.yawRate * 0.55, -0.8, 0.8) : 0,
        clinging || climbing,
      );

      followCamera.update(motion, glider.phase, dt);
      renderer.render(scene, camera);
    },

    /**
     * Turn a world point into a screen point, for DOM overlays like the
     * tree name labels (LAN-567). Only render/ touches the camera's
     * matrices; ui/ hands us a point and gets pixels back. Call this after
     * `render()` in the same frame so the camera's matrices are current.
     *
     * @param {{x: number, y: number, z: number}} point
     * @returns {{x: number, y: number, distance: number, behind: boolean}}
     *   x/y in CSS pixels relative to the canvas; distance in metres from
     *   the camera; behind is true once the point is behind the camera.
     */
    projectToScreen(point) {
      // View space: the camera looks down -Z, so a point in front has a
      // negative z there. Checked separately from the NDC projection below
      // because dividing by a negative w near the camera plane can flip the
      // sign of a purely NDC-based check.
      viewSpaceScratch.set(point.x, point.y, point.z).applyMatrix4(camera.matrixWorldInverse);
      const behind = viewSpaceScratch.z >= 0;

      projectionScratch.set(point.x, point.y, point.z).project(camera);
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      const x = (projectionScratch.x * 0.5 + 0.5) * width;
      const y = (1 - (projectionScratch.y * 0.5 + 0.5)) * height;

      return { x, y, distance: camera.position.distanceTo(point), behind };
    },

    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
