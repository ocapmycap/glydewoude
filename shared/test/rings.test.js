/**
 * Deterministic unit tests on the pure ring-crossing math used by puzzle
 * courses (shared/src/worldgen.js builds the rings; this checks whether a
 * flight segment passed through one).
 */

import { describe, expect, it } from 'vitest';

import { crossesRing } from '../src/rings.js';
import * as sharedIndex from '../src/index.js';

/** Normalizes a raw vector — worldgen always hands crossesRing a unit normal. */
function unit({ x, y, z }) {
  const length = Math.hypot(x, y, z);
  return { x: x / length, y: y / length, z: z / length };
}

describe('crossesRing', () => {
  it('is re-exported from the shared index', () => {
    expect(sharedIndex.crossesRing).toBe(crossesRing);
  });

  it('counts a straight pass through the centre, along the normal', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 0, z: 4 };
    const to = { x: 0, y: 0, z: 6 };
    expect(crossesRing(from, to, ring)).toBe(true);
  });

  it('counts a pass just inside the radius', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 1.9, z: 4 };
    const to = { x: 0, y: 1.9, z: 6 };
    expect(crossesRing(from, to, ring)).toBe(true);
  });

  it('rejects a pass just outside the radius', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 2.1, z: 4 };
    const to = { x: 0, y: 2.1, z: 6 };
    expect(crossesRing(from, to, ring)).toBe(false);
  });

  it('rejects a pass through the centre made backwards, against the normal', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 0, z: 6 };
    const to = { x: 0, y: 0, z: 4 };
    expect(crossesRing(from, to, ring)).toBe(false);
  });

  it('rejects a segment that stops short of the plane', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 0, z: 4 };
    const to = { x: 0, y: 0, z: 4.5 };
    expect(crossesRing(from, to, ring)).toBe(false);
  });

  it('still counts a fast step whose endpoints are both far from the plane, on opposite sides', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 0, z: -1000 };
    const to = { x: 0, y: 0, z: 1000 };
    expect(crossesRing(from, to, ring)).toBe(true);
  });

  it('rejects a zero-length segment off the plane', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const point = { x: 0, y: 0, z: 4 };
    expect(crossesRing(point, point, ring)).toBe(false);
  });

  it('rejects a zero-length segment sitting exactly on the plane', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const point = { x: 0, y: 0, z: 5 };
    expect(crossesRing(point, point, ring)).toBe(false);
  });

  it('rejects a segment that lies entirely in the plane', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: -10, y: 0, z: 5 };
    const to = { x: 10, y: 0, z: 5 };
    expect(crossesRing(from, to, ring)).toBe(false);
  });

  it('does not divide by zero or throw on degenerate segments', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const point = { x: 0, y: 0, z: 5 };
    expect(() => crossesRing(point, point, ring)).not.toThrow();
    expect(typeof crossesRing(point, point, ring)).toBe('boolean');
  });

  it('does not mutate its inputs', () => {
    const ring = { center: { x: 0, y: 0, z: 5 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 };
    const from = { x: 0, y: 0, z: 4 };
    const to = { x: 0, y: 0, z: 6 };
    const ringSnapshot = structuredClone(ring);
    const fromSnapshot = structuredClone(from);
    const toSnapshot = structuredClone(to);

    crossesRing(from, to, ring);

    expect(ring).toEqual(ringSnapshot);
    expect(from).toEqual(fromSnapshot);
    expect(to).toEqual(toSnapshot);
  });

  it('handles a non-axis-aligned normal', () => {
    const normal = unit({ x: 1, y: 0, z: 1 });
    const ring = { center: { x: 0, y: 0, z: 0 }, normal, radius: 2 };
    // A segment straddling the origin along the normal direction crosses
    // forward through the centre...
    const from = { x: -normal.x * 5, y: 0, z: -normal.z * 5 };
    const to = { x: normal.x * 5, y: 0, z: normal.z * 5 };
    expect(crossesRing(from, to, ring)).toBe(true);
    // ...and the reverse of that segment crosses the same plane backwards.
    expect(crossesRing(to, from, ring)).toBe(false);
  });
});
