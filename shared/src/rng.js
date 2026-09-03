/**
 * Deterministic pseudo-random number generation.
 *
 * The forest layout has to be reproducible: the headless tests assert on
 * specific trees, and (from Phase 2) the server has to agree with the client
 * about where trees are without shipping a tree table over the wire. So world
 * generation never touches `Math.random` — it takes a seed and uses this.
 */

/** mulberry32 — small, fast, good enough distribution for scattering trees. */
export function createRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn a string into a 32-bit seed, so worlds can be named. */
export function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Uniform float in [min, max). */
export function randRange(rng, min, max) {
  return min + rng() * (max - min);
}

/** Uniform integer in [min, max]. */
export function randInt(rng, min, max) {
  return Math.floor(min + rng() * (max - min + 1));
}

/** Pick one element of `items`. */
export function randPick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}
