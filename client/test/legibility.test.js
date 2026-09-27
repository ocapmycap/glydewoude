/**
 * Pure part of low-vision legibility (LAN-578): the shared text-styling
 * constants and the WCAG contrast-ratio calculation used to pick them.
 * Whether a label actually renders at this size is covered by looking at
 * it, not by a test (product doc §7.4 on feel/rendering).
 */

import { describe, expect, it } from 'vitest';

import { LEGIBLE_TEXT, contrastRatio } from '../src/ui/legibility.js';

describe('LEGIBLE_TEXT', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(LEGIBLE_TEXT)).toBe(true);
  });

  it('sets a minimum font size and weight generous enough for low vision', () => {
    expect(LEGIBLE_TEXT.minFontPx).toBeGreaterThanOrEqual(28);
    expect(LEGIBLE_TEXT.maxFontPx).toBeGreaterThanOrEqual(LEGIBLE_TEXT.minFontPx);
    expect(LEGIBLE_TEXT.fontWeight).toBeGreaterThanOrEqual(700);
  });

  it('requires at least the WCAG AAA contrast threshold', () => {
    expect(LEGIBLE_TEXT.minContrast).toBeGreaterThanOrEqual(7);
  });

  it('picks a plate/text colour pair that actually meets its own minimum contrast', () => {
    const ratio = contrastRatio(LEGIBLE_TEXT.plateColour, LEGIBLE_TEXT.textColour);
    expect(ratio).toBeGreaterThanOrEqual(LEGIBLE_TEXT.minContrast);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black against white, the maximum possible ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 10);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 10);
  });

  it('is symmetric regardless of argument order', () => {
    const a = contrastRatio('#123456', '#abcdef');
    const b = contrastRatio('#abcdef', '#123456');
    expect(a).toBeCloseTo(b, 10);
  });

  it('never returns less than 1', () => {
    const pairs = [
      ['#000000', '#000000'],
      ['#ff0000', '#00ff00'],
      ['#808080', '#7f7f7f'],
    ];
    for (const [a, b] of pairs) {
      expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1);
    }
  });
});
