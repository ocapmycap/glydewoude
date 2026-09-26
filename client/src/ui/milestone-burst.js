/**
 * A short burst of praise when a chain reaches a milestone: "Chain of 5!".
 *
 * Kept out of `hud.js` (flight instruments) and `run-hud.js` (the running
 * score) because it is neither: it is a one-off beat that pops in, fades, and
 * is gone. It only listens — the chain comes straight off `run:milestone`, and
 * the simulation already guarantees each threshold fires once per run.
 *
 * How loud each milestone is lives in CSS, keyed on the chain in `data-chain`,
 * so this module never ranks milestones itself (D-46).
 */

// One source for the lifetime: the CSS animation reads it as a custom
// property, so the element is removed exactly when its fade ends.
const BURST_MS = 1500;

/**
 * @param {HTMLElement} root
 * @param {{on:Function}} simulation  from createSimulation()
 */
export function createMilestoneBurst(root, simulation) {
  let current = null;

  function show(chain) {
    // Milestones are landings apart, so an overlap is unlikely — but if one
    // does happen the newer beat replaces the older rather than stacking.
    current?.remove();
    const burst = document.createElement('div');
    burst.className = 'milestone-burst';
    burst.dataset.chain = String(chain);
    burst.style.setProperty('--burst-ms', `${BURST_MS}ms`);
    burst.textContent = `Chain of ${chain}!`;
    root.append(burst);
    current = burst;
    setTimeout(() => {
      burst.remove();
      if (current === burst) current = null;
    }, BURST_MS);
  }

  simulation.on((event) => {
    if (event.type === 'run:milestone') show(event.chain);
  });
}
