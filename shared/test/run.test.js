/**
 * Unit tests on run scoring.
 *
 * Invariants rather than exact values, for the same reason the glide tests
 * avoid them: RUN_TUNING is meant to be retuned, and a test that pins a
 * specific score turns every tuning tweak into a failure.
 */

import { describe, expect, it } from 'vitest';

import { RUN_TUNING } from '../src/constants.js';
import {
  endRun,
  extendRun,
  isBankable,
  runMultiplier,
  startRun,
} from '../src/run.js';

const tree = (id) => ({ id });
const glide = (distance) => ({ distance });

/** Land on `count` distinct trees, each glide the same length. */
function chainOf(count, distance = 100) {
  let run = startRun(0);
  for (let i = 0; i < count; i += 1) {
    run = extendRun(run, { tree: tree(`tree-${i}`), glide: glide(distance) });
  }
  return run;
}

describe('startRun', () => {
  it('starts empty and unfinished', () => {
    const run = startRun(12);
    expect(run.chain).toBe(0);
    expect(run.score).toBe(0);
    expect(run.distance).toBe(0);
    expect(run.treeIds).toEqual([]);
    expect(run.startedAt).toBe(12);
    expect(run.endedAt).toBeNull();
  });
});

describe('runMultiplier', () => {
  it('rises with the chain already behind the landing', () => {
    expect(runMultiplier(3)).toBeGreaterThan(runMultiplier(0));
  });

  it('never exceeds the ceiling, however long the chain', () => {
    expect(runMultiplier(10_000)).toBe(RUN_TUNING.maxMultiplier);
  });
});

describe('extendRun', () => {
  it('does not mutate the run it is given', () => {
    const before = startRun(0);
    const snapshot = structuredClone(before);
    extendRun(before, { tree: tree('a'), glide: glide(80) });
    expect(before).toEqual(snapshot);
  });

  it('counts the landing and banks the distance flown', () => {
    const run = extendRun(startRun(0), { tree: tree('a'), glide: glide(80) });
    expect(run.chain).toBe(1);
    expect(run.distance).toBe(80);
    expect(run.score).toBeGreaterThan(0);
  });

  it('pays more per metre the longer the chain runs', () => {
    const perMetre = (run) => run.score / run.distance;
    expect(perMetre(chainOf(4))).toBeGreaterThan(perMetre(chainOf(1)));
  });

  it('pays less for a tree the run has already used', () => {
    const opened = extendRun(startRun(0), { tree: tree('a'), glide: glide(100) });

    const revisit = extendRun(opened, { tree: tree('a'), glide: glide(100) });
    const fresh = extendRun(opened, { tree: tree('b'), glide: glide(100) });

    expect(revisit.score).toBeLessThan(fresh.score);
    // A revisit still counts as a link — it just does not pay the bonus twice.
    expect(revisit.chain).toBe(fresh.chain);
    expect(revisit.treeIds).toEqual(opened.treeIds);
  });

  it('keeps the score a whole number', () => {
    const run = chainOf(6, 83.7);
    expect(Number.isInteger(run.score)).toBe(true);
  });

  it('ignores a landing after the run has ended', () => {
    const ended = endRun(chainOf(3), 40);
    expect(extendRun(ended, { tree: tree('z'), glide: glide(500) })).toBe(ended);
  });
});

describe('endRun', () => {
  it('stamps the finish and leaves the score alone', () => {
    const running = chainOf(3);
    const ended = endRun(running, 40);
    expect(ended.endedAt).toBe(40);
    expect(ended.score).toBe(running.score);
  });

  it('keeps the first finish when called twice', () => {
    const ended = endRun(chainOf(3), 40);
    expect(endRun(ended, 99).endedAt).toBe(40);
  });
});

describe('isBankable', () => {
  it('rejects a run shorter than the threshold', () => {
    expect(isBankable(chainOf(RUN_TUNING.minChainToBank - 1))).toBe(false);
  });

  it('accepts one that reaches it', () => {
    expect(isBankable(chainOf(RUN_TUNING.minChainToBank))).toBe(true);
  });

  it('treats a missing run as not bankable', () => {
    expect(isBankable(null)).toBe(false);
  });
});
