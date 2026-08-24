import { describe, expect, it, vi } from 'vitest';

import { FIXED_DT, MAX_FRAME_TIME, createLoop, runHeadless } from '../src/sim/loop.js';

/** A hand-cranked frame scheduler, so the loop can be tested without a browser. */
function createHarness() {
  let time = 0;
  const queue = [];
  return {
    now: () => time,
    schedule: (cb) => queue.push(cb),
    cancel: () => queue.length = 0,
    advance(seconds) {
      time += seconds;
      const pending = queue.splice(0, queue.length);
      pending.forEach((cb) => cb());
    },
  };
}

describe('createLoop', () => {
  it('advances the simulation in fixed slices regardless of frame length', () => {
    const harness = createHarness();
    const update = vi.fn();
    const loop = createLoop({ update, render: () => {}, ...harness });

    loop.start();
    harness.advance(0.1);

    expect(update).toHaveBeenCalledTimes(6);
    expect(update.mock.calls.every(([dt]) => dt === FIXED_DT)).toBe(true);
  });

  it('clamps a long stall so a backgrounded tab does not fast-forward the game', () => {
    const harness = createHarness();
    const update = vi.fn();
    const loop = createLoop({ update, render: () => {}, ...harness });

    loop.start();
    harness.advance(30);

    expect(update.mock.calls.length).toBeLessThanOrEqual(Math.ceil(MAX_FRAME_TIME / FIXED_DT));
  });

  it('hands the renderer an interpolation alpha in [0,1)', () => {
    const harness = createHarness();
    const render = vi.fn();
    const loop = createLoop({ update: () => {}, render, ...harness });

    loop.start();
    harness.advance(FIXED_DT * 1.5);

    const [alpha] = render.mock.calls.at(-1);
    expect(alpha).toBeGreaterThanOrEqual(0);
    expect(alpha).toBeLessThan(1);
  });

  it('stops cleanly and ignores a double start', () => {
    const harness = createHarness();
    const update = vi.fn();
    const loop = createLoop({ update, render: () => {}, ...harness });

    loop.start();
    loop.start();
    expect(loop.running).toBe(true);

    loop.stop();
    expect(loop.running).toBe(false);
    harness.advance(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('runHeadless', () => {
  it('steps exactly as many times as asked, at the fixed timestep', () => {
    const step = vi.fn();
    const onTick = vi.fn();
    runHeadless({ step }, { steer: 0 }, 10, onTick);

    expect(step).toHaveBeenCalledTimes(10);
    expect(onTick).toHaveBeenCalledTimes(10);
    expect(step.mock.calls.every(([, dt]) => dt === FIXED_DT)).toBe(true);
  });
});
