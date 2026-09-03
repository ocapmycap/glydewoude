/**
 * Entry point: build the world, wire the simulation to the screen, start the
 * loop.
 *
 * The dependency direction matters and is one way: `main` knows about both the
 * simulation and the renderer, the renderer knows about neither the simulation
 * nor the DOM chrome, and the simulation knows about nothing at all.
 */

import { generateForest } from '@glidewood/shared';

import { createSimulation } from './sim/simulation.js';
import { createInputState } from './sim/input-state.js';
import { createLoop } from './sim/loop.js';
import { createRenderer } from './render/renderer.js';
import { createInputBindings } from './ui/input.js';
import { createHud } from './ui/hud.js';
import { createTuningPanel } from './ui/tuning-panel.js';

import './style.css';

const canvas = document.querySelector('#viewport');
const overlay = document.querySelector('#overlay');
const hint = document.querySelector('#hint');

const world = generateForest();
const simulation = createSimulation({ world });
const renderer = createRenderer(canvas, world);
const input = createInputState();

const hud = createHud(overlay, simulation);
const tuning = createTuningPanel(overlay, simulation);
const bindings = createInputBindings(input, canvas, { onToggleTuning: () => tuning.toggle() });

// The opening hint stays up until the player takes their first launch.
simulation.on((event) => {
  if (event.type === 'glide:launched') hint.classList.add('hint--dismissed');
  if (event.type === 'glide:respawned') renderer.reset();
});

const loop = createLoop({
  // sim/ is runtime-agnostic on purpose, so the browser's clock and frame
  // scheduler are handed in from here rather than reached for down there.
  now: () => performance.now() / 1000,
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),

  update(dt) {
    bindings.sync(dt);
    simulation.step(input, dt);
    hud.update(dt);
  },
  render(alpha) {
    // Alpha is the fraction of a fixed step already elapsed; feeding it back
    // as the camera's delta keeps the chase cam smooth on high-refresh
    // displays without the simulation itself ever running at a variable rate.
    renderer.render(simulation.glider, (1 / 60) * (1 + alpha));
  },
});

loop.start();
