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
import { createSession } from './net/session.js';
import { createCollectionSync } from './net/collection-sync.js';
import { createRenderer } from './render/renderer.js';
import { createInputBindings } from './ui/input.js';
import { createHud } from './ui/hud.js';
import { createTuningPanel } from './ui/tuning-panel.js';

import './style.css';

const canvas = document.querySelector('#viewport');
const overlay = document.querySelector('#overlay');
const hint = document.querySelector('#hint');

// Establish the server session before building the world. When it succeeds we
// restore the player's own forest seed and upgrade tiers; when it fails (server
// down, offline) we fall back to a fresh local run, unpersisted — the game must
// still start. The base URL comes from the build's env so a deploy can point at
// a real server without a code change.
const session = createSession({
  baseUrl: import.meta.env.VITE_API_URL || undefined,
});
await session.connect();
const { player } = session;

// The server validates future collection claims against caches derived from the
// player's stored seed, so the client must build the same forest — otherwise
// every claim in item 2 would be rejected as an unknown cache. Offline, any
// seed will do.
const world = player ? generateForest({ seed: player.worldSeed }) : generateForest();
const simulation = createSimulation({ world, stats: player?.glideStats });
const renderer = createRenderer(canvas, world);
const input = createInputState();

// Seed the ledger's confirmed balance with what the server already banked, so a
// returning player's materials are correct on the first frame rather than only
// after their next pickup settles. An empty seq list settles nothing — it just
// writes the authoritative totals in.
if (player) simulation.collection.settle([], player.materials);

// Relay collection intents to the server. Every landing that claims a cache
// raises an intent; this drains the queue and writes back the server's verdict.
// Offline it is a no-op, and the intents wait locally.
const collectionSync = createCollectionSync({ session, collection: simulation.collection });
simulation.on((event) => {
  if (event.type === 'material:collected') collectionSync.flush();
});

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
