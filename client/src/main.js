/**
 * Entry point: find out who is playing, build their world, wire it to the
 * screen, start the loop.
 *
 * The dependency direction matters and is one way. `main` knows about the
 * simulation, the renderer, the DOM chrome and — new in Phase 2 — the network.
 * The renderer knows about none of the others, the simulation knows about
 * nothing at all, and `net/` is a fourth peer alongside the other three rather
 * than something `sim/` reaches for (D-29).
 *
 * Bootstrap is asynchronous now, because the world depends on the answer: the
 * forest is generated from the player's own seed, and the physics from the
 * upgrade tiers the server has recorded. Both have to be in hand before
 * `createSimulation` is called.
 *
 * If the server cannot be reached, the game still runs. It runs at tier zero
 * on the default forest and nothing is saved, which is Phase 1's game — but a
 * dead API turning the page into an error screen would be a worse trade than
 * a squirrel that can still glide.
 */

import { generateForest, WORLD_CONFIG } from '@glidewood/shared';

import { createSimulation } from './sim/simulation.js';
import { createInputState } from './sim/input-state.js';
import { createLoop } from './sim/loop.js';
import { createApiClient } from './net/api.js';
import { createSession } from './net/session.js';
import { createSync } from './net/sync.js';
import { createRenderer } from './render/renderer.js';
import { createInputBindings } from './ui/input.js';
import { createHud } from './ui/hud.js';
import { createPouch } from './ui/pouch.js';
import { createShopPanel } from './ui/shop-panel.js';
import { createTuningPanel } from './ui/tuning-panel.js';

import './style.css';

const canvas = document.querySelector('#viewport');
const overlay = document.querySelector('#overlay');
const hint = document.querySelector('#hint');
const tagline = document.querySelector('#hint .hint-tagline');

/**
 * Where the API lives.
 *
 * Empty by default, so requests are same-origin and the Vite dev proxy can
 * forward them without anyone configuring CORS for local work. A build served
 * from somewhere other than its API sets `VITE_API_URL` at build time.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? '';

/**
 * How long a request may go quiet before we call it dead.
 *
 * This is the bootstrap's timeout too. The API client aborts rather than
 * racing a timer, which matters here: a raced timer would let a slow
 * registration succeed after the game had already started offline, leaving a
 * token for a player whose world was built without one.
 */
const REQUEST_TIMEOUT_MS = 6000;

async function boot() {
  const api = createApiClient({ baseUrl: API_BASE, timeoutMs: REQUEST_TIMEOUT_MS });
  const session = createSession({ api, storage: globalThis.localStorage });

  const started = await session.start();
  const player = started.ok ? started.player : null;

  // The seed comes from the player so two accounts could one day explore
  // different forests; today the server hands out the same one it always has.
  const world = generateForest({ seed: player?.worldSeed ?? WORLD_CONFIG.seed });
  const simulation = createSimulation({ world, stats: player?.glideStats });
  const renderer = createRenderer(canvas, world);
  const input = createInputState();

  const sync = createSync({ api, simulation, session });

  const hud = createHud(overlay, simulation);
  const pouch = createPouch(overlay, simulation, sync);
  createShopPanel(overlay, simulation, sync);
  const tuning = createTuningPanel(overlay, simulation);
  const bindings = createInputBindings(input, canvas, { onToggleTuning: () => tuning.toggle() });

  // The server's materials are the ledger's starting point, so a returning
  // player's pouch is not empty. Only the server may write this (§6.1), which
  // is why it goes through settle() with no intents rather than being assigned.
  if (player?.materials) simulation.collection.settle([], player.materials);

  tagline.textContent = describeSession(started, player);

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
      pouch.update();
      // Counts game seconds, not wall-clock ones, so a backgrounded tab does
      // not come back and post a hundred position saves at once.
      sync.tick(dt);
    },
    render(alpha) {
      // Alpha is the fraction of a fixed step already elapsed; feeding it back
      // as the camera's delta keeps the chase cam smooth on high-refresh
      // displays without the simulation itself ever running at a variable rate.
      renderer.render(simulation.glider, (1 / 60) * (1 + alpha));
    },
  });

  loop.start();
}

function describeSession(started, player) {
  if (!started.ok) return 'Playing offline — nothing will be saved.';
  const name = player?.displayName ?? 'squirrel';
  return started.resumed
    ? `Welcome back, ${name}. Your forest remembers you.`
    : `You are ${name}. Everything you collect is saved.`;
}

boot();
