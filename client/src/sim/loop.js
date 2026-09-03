/**
 * Fixed-timestep game loop.
 *
 * The simulation always advances in identical FIXED_DT slices no matter what
 * the display is doing. A 144 Hz monitor, a 60 Hz monitor and a headless test
 * all produce the same trajectory for the same inputs, which is required both
 * for the glide to feel the same for everyone and for the tests to assert
 * anything at all.
 *
 * Rendering gets an interpolation alpha so it stays smooth between steps.
 *
 * The clock and the frame scheduler are injected rather than reached for.
 * `requestAnimationFrame` and `performance` are browser globals, and nothing
 * under sim/ is allowed to touch those — the ESLint config enforces it — so
 * the browser driver is supplied by main.js and the tests supply a hand-cranked
 * one.
 */

export const FIXED_DT = 1 / 60;
/** Never simulate more than this much wall-clock in one frame (tab-switch guard). */
export const MAX_FRAME_TIME = 0.25;

/**
 * @param {object} options
 * @param {(dt: number) => void} options.update     advance the simulation
 * @param {(alpha: number) => void} options.render  draw, alpha in [0,1)
 * @param {() => number} options.now                current time in seconds
 * @param {(cb: () => void) => unknown} options.schedule   queue the next frame
 * @param {(handle: unknown) => void} options.cancel       cancel a queued frame
 */
export function createLoop({ update, render, now, schedule, cancel }) {
  const clock = now;
  const requestFrame = schedule;
  const cancelFrame = cancel;

  let handle = null;
  let previous = 0;
  let accumulator = 0;
  let running = false;

  function frame() {
    if (!running) return;
    const current = clock();
    accumulator += Math.min(current - previous, MAX_FRAME_TIME);
    previous = current;

    while (accumulator >= FIXED_DT) {
      update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    render(accumulator / FIXED_DT);
    handle = requestFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      previous = clock();
      accumulator = 0;
      handle = requestFrame(frame);
    },
    stop() {
      running = false;
      if (handle !== null) cancelFrame(handle);
      handle = null;
    },
    get running() {
      return running;
    },
  };
}

/**
 * Run the simulation headlessly for a bounded number of fixed steps.
 * Used by the tests, and handy for offline balance sweeps.
 *
 * @param {{step: (input: object, dt: number) => void}} simulation
 * @param {object} input                       mutated in place by `onTick`
 * @param {number} steps
 * @param {(tick: number) => void} [onTick]    fill in the input for this tick
 */
export function runHeadless(simulation, input, steps, onTick) {
  for (let tick = 0; tick < steps; tick += 1) {
    onTick?.(tick);
    simulation.step(input, FIXED_DT);
  }
  return simulation;
}
