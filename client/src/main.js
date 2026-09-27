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
import { createPositionSync } from './net/position-sync.js';
import { createRunSync } from './net/run-sync.js';
import { createRenderer } from './render/renderer.js';
import { createInputBindings } from './ui/input.js';
import { createHud } from './ui/hud.js';
import { createTuningPanel } from './ui/tuning-panel.js';
import { createHelpPanel } from './ui/help-panel.js';
import { createShop } from './ui/shop.js';
import { createRunHud } from './ui/run-hud.js';
import { createLeafBurst } from './render/leaf-burst.js';
import { createMilestoneBurst } from './ui/milestone-burst.js';
import { createRings } from './render/rings.js';
import { createWind } from './render/wind.js';
import { createPuzzlePrompt } from './ui/puzzle-prompt.js';
import {
  createTreeLabels, isPuzzleTree, labelAnchor, labelFontPx, labelText, labelledTrees, treeLabelState,
} from './ui/tree-labels.js';
import { createBeacons } from './render/beacons.js';
import {
  PUZZLE_POINTER, createPuzzlePointer, edgePointer, nearestPuzzleTree, pointerText,
} from './ui/puzzle-pointer.js';

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

// Keep the server's position anchor current. Collection already advances it,
// but a landing that claims no cache would leave it stale, so save on every
// arrival — landings and respawns alike.
const positionSync = createPositionSync({ session });

simulation.on((event) => {
  if (event.type === 'material:collected') collectionSync.flush();
  if (event.type === 'glide:landed' || event.type === 'glide:respawned') {
    positionSync.save(simulation.glider.motion);
  }
});

// Bank a finished run against the server's best. It subscribes itself to
// `run:ended`; the run HUD (T4) can read `.best` and `.onBest` once it lands.
const runSync = createRunSync({ session, simulation });

const hud = createHud(overlay, simulation);
const tuning = createTuningPanel(overlay, simulation);
const help = createHelpPanel(overlay);
const shop = createShop(overlay, { session, simulation });
createRunHud(overlay, { simulation, runSync });

// Named trees and their world anchors never change after worldgen, so this
// is computed once rather than every frame the labels are shown.
const treeLabels = createTreeLabels(overlay);
const labelledWorldTrees = labelledTrees(world.trees).map((tree) => (
  { tree, anchor: labelAnchor(tree) }
));

// Puzzle trees never change after worldgen either, so the off-screen pointer
// (LAN-578) filters once here rather than every render frame.
const puzzleTrees = world.trees.filter(isPuzzleTree);
const puzzlePointer = createPuzzlePointer(overlay);
// True between 'puzzle:armed' and the trial's end, so the pointer and the
// beacon agree on when a trial is in play. A trial can already be armed on
// the spawn tree before any listener exists (createPuzzleTrial arms it in
// createSimulation), so this starts from the simulation's own state rather
// than assuming nothing is armed yet.
let trialArmed = simulation.puzzle.trial != null;

const bindings = createInputBindings(input, canvas, {
  onToggleTuning: () => tuning.toggle(),
  onToggleShop: () => shop.toggle(),
  onToggleLabels: () => treeLabels.toggle(),
  onToggleHelp: () => help.toggle(),
  onCloseHelp: () => help.close(),
});

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

    // Skip the projection work entirely while hidden — most frames, since
    // labels are off by default.
    if (treeLabels.shown) {
      treeLabels.update(labelledWorldTrees.map(({ tree, anchor }) => {
        const projected = renderer.projectToScreen(anchor);
        return {
          ...treeLabelState(tree, projected),
          text: labelText(tree),
          fontPx: labelFontPx(projected.distance),
          puzzle: isPuzzleTree(tree),
        };
      }));
    }

    // The off-screen puzzle pointer runs whether or not labels are toggled
    // on (LAN-578) — unlike a label, it only ever appears when there is
    // somewhere off screen worth pointing at.
    const nearest = nearestPuzzleTree(puzzleTrees, simulation.glider.motion);
    if (!nearest || trialArmed || nearest.distance < PUZZLE_POINTER.arriveDistance) {
      puzzlePointer.hide();
    } else {
      const projected = renderer.projectToScreen(labelAnchor(nearest.tree));
      const edge = edgePointer(projected, { width: overlay.clientWidth, height: overlay.clientHeight });
      if (edge.onScreen) {
        puzzlePointer.hide();
      } else {
        puzzlePointer.update({
          visible: true,
          x: edge.x,
          y: edge.y,
          angle: edge.angle,
          text: pointerText(nearest.tree.name, nearest.distance),
        });
      }
    }
  },
});

loop.start();

// A puff of leaves on every caught branch. Ground landings get none: the
// squirrel missed, and the tree it scampers up was not caught.
const leafBurst = createLeafBurst(renderer.scene);
simulation.on((event) => event.type === 'glide:landed' && event.reason === 'perch' && leafBurst.burst(event.tree));

// A brief "Chain of 5!" whenever a run reaches a milestone.
createMilestoneBurst(overlay, simulation);

// Ring trials (LAN-549). The simulation decides every pass and failure; the
// rings are only told which course is armed and which ring index was passed.
// A respawn while armed but not yet launched clears the trial without a
// puzzle event, so it hides the rings too; any re-arm follows it.
const rings = createRings(renderer.scene, world);
// The beacon above a puzzle tree (LAN-578) hides while that tree's own trial
// is armed, so it never sits lit up in the middle of the rings it just
// vacated for. The spawn tree's trial can be armed before this listener
// exists (see `trialArmed` above), so its beacon starts hidden too.
const beacons = createBeacons(renderer.scene, world);
if (simulation.puzzle.trial) beacons.hide(simulation.puzzle.trial.treeId);
simulation.on((event) => {
  if (event.type === 'puzzle:armed') {
    rings.show(event.tree.id);
    beacons.hide(event.tree.id);
    trialArmed = true;
  } else if (event.type === 'puzzle:ring') {
    rings.pass(event.index);
  } else if (['puzzle:solved', 'puzzle:failed', 'glide:respawned'].includes(event.type)) {
    rings.hide();
    beacons.showAll();
    trialArmed = false;
  }
});
createPuzzlePrompt(overlay, simulation);

// Streaks and leaves drifting on the wind near the camera. Visual only: the
// simulation never hears about it (D-61).
createWind(renderer.scene, world);
