/**
 * Small numeric helpers used by the simulation.
 * Pure, dependency-free, safe to import from client, tests, and (later) the server.
 */

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent smoothing factor for an exponential approach.
 *
 * `value += (target - value) * approach(rate, dt)` converges at the same
 * wall-clock rate whatever `dt` is, which keeps the glide identical between a
 * 60 Hz browser, a 144 Hz browser, and the fixed-step headless tests.
 *
 * @param {number} rate 1/seconds — higher is snappier
 * @param {number} dt   seconds
 */
export function approach(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export function distance2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}
