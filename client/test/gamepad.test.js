import { describe, expect, it } from 'vitest';

import { GAMEPAD_DEAD_ZONE, heldButtons, mapGamepad } from '../src/ui/gamepad.js';

function padWith(axes, buttonIndexesPressed = []) {
  const buttons = Array.from({ length: 9 }, (_, i) => ({ pressed: buttonIndexesPressed.includes(i) }));
  return { connected: true, axes, buttons };
}

describe('GAMEPAD_DEAD_ZONE', () => {
  it('is 0.15', () => {
    expect(GAMEPAD_DEAD_ZONE).toBe(0.15);
  });
});

describe('mapGamepad axis dead zone and rescaling', () => {
  it('reports zero steer and pitch for stick values inside the dead zone', () => {
    const pad = padWith([0.1, -0.1]);
    const result = mapGamepad(pad, undefined);
    expect(result.steer).toBe(0);
    expect(result.pitch).toBe(0);
  });

  it('reports zero exactly at the dead zone boundary', () => {
    const pad = padWith([0.15, -0.15]);
    const result = mapGamepad(pad, undefined);
    expect(result.steer).toBe(0);
    expect(result.pitch).toBe(0);
  });

  it('rescales full deflection to exactly +-1', () => {
    const right = mapGamepad(padWith([1, 0]), undefined);
    expect(right.steer).toBe(1);

    const left = mapGamepad(padWith([-1, 0]), undefined);
    expect(left.steer).toBe(-1);
  });

  it('is continuous just past the dead zone edge, producing a small output', () => {
    const justInside = mapGamepad(padWith([0.15, 0]), undefined);
    const justOutside = mapGamepad(padWith([0.16, 0]), undefined);
    expect(justInside.steer).toBe(0);
    expect(justOutside.steer).toBeGreaterThan(0);
    expect(justOutside.steer).toBeLessThan(0.05);
  });

  it('rescales a mid-range value to the documented example', () => {
    const result = mapGamepad(padWith([0.575, 0]), undefined);
    expect(result.steer).toBeCloseTo(0.5, 5);
  });

  it('steers right when the stick is pushed right (positive axis 0)', () => {
    const result = mapGamepad(padWith([0.9, 0]), undefined);
    expect(result.steer).toBeGreaterThan(0);
  });

  it('steers left when the stick is pushed left (negative axis 0)', () => {
    const result = mapGamepad(padWith([-0.9, 0]), undefined);
    expect(result.steer).toBeLessThan(0);
  });

  it('produces negative pitch (dive) when the stick is pushed forward, which the browser reports as a negative axis 1', () => {
    const result = mapGamepad(padWith([0, -0.9]), undefined);
    expect(result.pitch).toBeLessThan(0);
  });

  it('produces positive pitch (flare) when the stick is pulled back, a positive axis 1', () => {
    const result = mapGamepad(padWith([0, 0.9]), undefined);
    expect(result.pitch).toBeGreaterThan(0);
  });
});

describe('mapGamepad button press edges', () => {
  it('fires launch/respawn/toggleShop only on the frame the button transitions to pressed', () => {
    // Frame 1: button newly pressed -> edge fires true.
    const frame1Pad = padWith([0, 0], [0, 8, 3]);
    const frame1 = mapGamepad(frame1Pad, undefined);
    expect(frame1.launch).toBe(true);
    expect(frame1.respawn).toBe(true);
    expect(frame1.toggleShop).toBe(true);

    // Frame 2: still held -> no repeat.
    const held1 = heldButtons(frame1Pad);
    const frame2Pad = padWith([0, 0], [0, 8, 3]);
    const frame2 = mapGamepad(frame2Pad, held1);
    expect(frame2.launch).toBe(false);
    expect(frame2.respawn).toBe(false);
    expect(frame2.toggleShop).toBe(false);

    // Frame 3: still held -> still no repeat.
    const held2 = heldButtons(frame2Pad);
    const frame3Pad = padWith([0, 0], [0, 8, 3]);
    const frame3 = mapGamepad(frame3Pad, held2);
    expect(frame3.launch).toBe(false);
    expect(frame3.respawn).toBe(false);
    expect(frame3.toggleShop).toBe(false);
  });

  it('fires again after the button is released and re-pressed', () => {
    const pressedPad = padWith([0, 0], [0]);
    const heldAfterPress = heldButtons(pressedPad);
    expect(heldAfterPress.launch).toBe(true);

    const releasedPad = padWith([0, 0], []);
    const releasedResult = mapGamepad(releasedPad, heldAfterPress);
    expect(releasedResult.launch).toBe(false);
    const heldAfterRelease = heldButtons(releasedPad);

    const rePressedPad = padWith([0, 0], [0]);
    const rePressedResult = mapGamepad(rePressedPad, heldAfterRelease);
    expect(rePressedResult.launch).toBe(true);
  });

  it('treats a missing previous state as nothing held, so an already-pressed pad fires once', () => {
    const pad = padWith([0, 0], [3]);
    const result = mapGamepad(pad, undefined);
    expect(result.toggleShop).toBe(true);
  });
});

describe('heldButtons', () => {
  it('reads button 0 as launch, button 8 as respawn, button 3 as toggleShop', () => {
    const pad = padWith([0, 0], [0, 8, 3]);
    expect(heldButtons(pad)).toEqual({ launch: true, respawn: true, toggleShop: true });
  });

  it('reports all false for a pad with no buttons pressed', () => {
    const pad = padWith([0, 0], []);
    expect(heldButtons(pad)).toEqual({ launch: false, respawn: false, toggleShop: false });
  });

  it('reports all false for a missing pad', () => {
    expect(heldButtons(null)).toEqual({ launch: false, respawn: false, toggleShop: false });
    expect(heldButtons(undefined)).toEqual({ launch: false, respawn: false, toggleShop: false });
  });
});

describe('mapGamepad with a missing or disconnected pad', () => {
  it('returns all-zero/false for a null pad', () => {
    expect(mapGamepad(null, undefined)).toEqual({
      steer: 0,
      pitch: 0,
      launch: false,
      respawn: false,
      toggleShop: false,
    });
  });

  it('returns all-zero/false for an undefined pad', () => {
    expect(mapGamepad(undefined, undefined)).toEqual({
      steer: 0,
      pitch: 0,
      launch: false,
      respawn: false,
      toggleShop: false,
    });
  });

  it('returns all-zero/false for a pad marked disconnected', () => {
    const pad = { connected: false, axes: [1, 1], buttons: [{ pressed: true }] };
    expect(mapGamepad(pad, undefined)).toEqual({
      steer: 0,
      pitch: 0,
      launch: false,
      respawn: false,
      toggleShop: false,
    });
  });

  it('returns all-zero/false for a pad with empty axes and buttons arrays', () => {
    const pad = { connected: true, axes: [], buttons: [] };
    expect(mapGamepad(pad, undefined)).toEqual({
      steer: 0,
      pitch: 0,
      launch: false,
      respawn: false,
      toggleShop: false,
    });
  });
});

describe('mapGamepad purity', () => {
  it('does not mutate the pad snapshot', () => {
    const pad = padWith([0.9, -0.9], [0, 8, 3]);
    const padCopy = JSON.parse(JSON.stringify(pad));
    mapGamepad(pad, undefined);
    expect(pad).toEqual(padCopy);
  });

  it('does not mutate the previous held-buttons object', () => {
    const previous = { launch: true, respawn: false, toggleShop: false };
    const previousCopy = { ...previous };
    mapGamepad(padWith([0, 0], [0]), previous);
    expect(previous).toEqual(previousCopy);
  });
});
