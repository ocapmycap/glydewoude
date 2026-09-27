/**
 * The ring-trial prompt: a persistent status line ("Ring 2 of 3") plus a
 * short flash for the trial's outcome ("Trial complete!").
 *
 * `trialPrompt` is the pure half — one puzzle event in, `{ line, flash }`
 * out — so the copy can be tested without a DOM (LAN-549). It deliberately
 * says nothing about reward or material; that is LAN-550's job once the
 * server can validate the claim (product doc §6.1).
 */

// Matches the milestone-burst pattern: one constant so the CSS animation and
// the removal timer can never drift apart.
const FLASH_MS = 2200;

const FAILURE_MESSAGES = {
  ground: 'Trial failed: you touched the ground',
  'missed-ring': 'Trial failed: you skipped a ring',
  'wrong-tree': 'Trial failed: that was the wrong tree',
  respawn: 'Trial abandoned',
};

/**
 * @param {object} event  a `puzzle:*` event from the simulation
 * @param {{targetName:string, ringCount:number}} state
 * @returns {?{line:?string, flash?:string}}
 */
export function trialPrompt(event, { targetName, ringCount }) {
  switch (event.type) {
    case 'puzzle:armed': {
      const n = event.course.rings.length;
      return { line: `Thread the ${n} rings and land on ${targetName}` };
    }
    case 'puzzle:started': {
      const n = event.course.rings.length;
      return { line: `Ring 1 of ${n}` };
    }
    case 'puzzle:ring': {
      const next = event.index + 2;
      if (next > ringCount) {
        return { line: `All rings threaded, now land on ${targetName}` };
      }
      return { line: `Ring ${next} of ${ringCount}` };
    }
    case 'puzzle:solved':
      return { line: null, flash: 'Trial complete!' };
    case 'puzzle:failed':
      return { line: null, flash: FAILURE_MESSAGES[event.reason] };
    default:
      return null;
  }
}

/**
 * @param {HTMLElement} root
 * @param {{on:Function, world:{trees:Array}}} simulation  from createSimulation()
 */
export function createPuzzlePrompt(root, simulation) {
  const container = document.createElement('div');
  container.className = 'puzzle-prompt';
  const line = document.createElement('div');
  line.className = 'puzzle-prompt-line';
  container.append(line);
  root.append(container);

  let currentFlash = null;
  let ringCount = 0;
  let targetName = 'the marked tree';

  function showFlash(text, outcome) {
    // A newer flash replaces the older one rather than stacking, same as
    // milestone-burst.
    currentFlash?.remove();
    const flash = document.createElement('div');
    flash.className = 'puzzle-prompt-flash';
    flash.dataset.outcome = outcome;
    flash.style.setProperty('--flash-ms', `${FLASH_MS}ms`);
    flash.textContent = text;
    container.append(flash);
    currentFlash = flash;
    setTimeout(() => {
      flash.remove();
      if (currentFlash === flash) currentFlash = null;
    }, FLASH_MS);
  }

  function targetNameFor(course) {
    const target = simulation.world.trees.find((tree) => tree.id === course.targetTreeId);
    // Targets are usually unnamed scenery trees; the renderer hangs a marker
    // over the tree instead, so the prompt just points at "the marked tree".
    return target?.name ?? 'the marked tree';
  }

  simulation.on((event) => {
    if (event.type === 'puzzle:armed' || event.type === 'puzzle:started') {
      ringCount = event.course.rings.length;
      targetName = targetNameFor(event.course);
    }

    const result = trialPrompt(event, { targetName, ringCount });
    if (result === null) {
      // A respawn while armed but not launched clears the trial without any
      // puzzle event of its own.
      if (event.type === 'glide:respawned') line.textContent = '';
      return;
    }

    line.textContent = result.line ?? '';
    if (result.flash) {
      const outcome = event.type === 'puzzle:solved' ? 'solved' : 'failed';
      showFlash(result.flash, outcome);
    }
  });
}
