/**
 * Shared low-vision legibility constants and the WCAG contrast check used to
 * pick them (LAN-578).
 *
 * Every overlay text element that needs to read from a glide away — tree
 * labels and the off-screen puzzle pointer — draws from this one constant
 * rather than each picking its own size and colours, so "legible" means the
 * same thing everywhere in the game and a future tweak only happens once.
 * Colour alone never carries meaning here either: callers are expected to
 * pair this with a distinct shape (a modifier class, a different plate
 * border) rather than relying on hue to tell two things apart.
 */

/**
 * @typedef {object} LegibleText
 * @property {number} minFontPx   floor for any legible label, in CSS pixels
 * @property {number} maxFontPx   ceiling a label grows to up close
 * @property {number} fontWeight  bold enough to read at a glance mid-glide
 * @property {string} plateColour opaque dark background, close to --ink
 * @property {string} textColour  warm near-white text on that plate
 * @property {number} minContrast WCAG AAA floor for normal text (7:1)
 */

/** @type {LegibleText} */
export const LEGIBLE_TEXT = Object.freeze({
  minFontPx: 28,
  maxFontPx: 44,
  fontWeight: 700,
  // Matches --ink in style.css: the plate is the same ink colour the rest of
  // the chrome uses for text, just inverted to sit behind light letters.
  plateColour: '#22301f',
  textColour: '#fff8ec',
  minContrast: 7,
});

/** Linearises one sRGB channel (0-255) for the WCAG relative-luminance sum. */
function linearise(channel) {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a `#rrggbb` colour. */
function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = linearise((n >> 16) & 0xff);
  const g = linearise((n >> 8) & 0xff);
  const b = linearise(n & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2 contrast ratio between two `#rrggbb` colours, from 1 (identical) to
 * 21 (black on white). Order of the arguments does not matter.
 */
export function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
