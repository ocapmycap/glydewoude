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
  WebGLRenderer,
} from 'three';

import { PALETTE, toonMaterial } from './materials.js';
import { createForest } from './trees.js';
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

  const squirrel = createSquirrel();
  scene.add(squirrel.object);

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

      squirrel.object.position.set(motion.x, motion.y + (gliding ? 0 : 0.55), motion.z);
      squirrel.object.rotation.y = motion.heading;
      // Pitch the nose along the flight path, and bank into the turn.
      squirrel.object.rotation.x = gliding
        ? MathUtils.clamp(Math.atan2(motion.vy, Math.max(motion.speed, 1)), -0.9, 0.6)
        : 0;
      squirrel.update(gliding ? 1 : 0, gliding ? MathUtils.clamp(motion.yawRate * 0.55, -0.8, 0.8) : 0);

      followCamera.update(motion, gliding, dt);
      renderer.render(scene, camera);
    },

    dispose() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
