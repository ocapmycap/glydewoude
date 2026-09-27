/**
 * Off-screen pointer to the nearest puzzle tree (LAN-578): a big arrow
 * pinned to the screen edge whenever that tree is off screen or behind the
 * camera, so a puzzle course never gets lost the way an ordinary landmark's
 * label can. It shows whether or not the N-key labels are toggled on, and
 * hides once the tree comes on screen or a trial is armed (main.js decides
 * that last part, since it is the one place that knows the trial state).
 *
 * Split the same way as tree-labels.js: `nearestPuzzleTree`, `pointerText`
 * and `edgePointer` are pure geometry and text, covered by
 * client/test/puzzle-pointer.test.js; `createPuzzlePointer` owns the DOM and
 * is exercised by looking at it.
 */

import { distance2D } from '@glidewood/shared';

import { LEGIBLE_TEXT } from './legibility.js';
import { isPuzzleTree } from './tree-labels.js';

/**
 * @typedef {object} PuzzlePointerDials
 * @property {number} edgeMarginPx   how far the arrow sits inside the screen edge
 * @property {number} arriveDistance metres inside which the pointer hides — you have arrived
 * @property {number} arrowSizePx    the arrow glyph's width/height
 * @property {number} textGapPx      gap between the arrow and its text plate
 * @property {number} textPaddingPx  padding inside the text plate
 */

/** @type {PuzzlePointerDials} */
export const PUZZLE_POINTER = Object.freeze({
  edgeMarginPx: 72,
  arriveDistance: 15,
  arrowSizePx: 64,
  textGapPx: 12,
  textPaddingPx: 14,
});

/**
 * The nearest puzzle tree to `position`, by horizontal distance only — a
 * puzzle tree's canopy can sit well above or below the glider without that
 * making it any less "nearest" to fly toward.
 *
 * @param {Array<object>} trees
 * @param {{x: number, y: number, z: number}} position
 * @returns {?{tree: object, distance: number}}
 */
export function nearestPuzzleTree(trees, position) {
  let best = null;
  for (const tree of trees) {
    if (!isPuzzleTree(tree)) continue;
    const distance = distance2D(position, tree.position);
    if (!best || distance < best.distance) best = { tree, distance };
  }
  return best;
}

/** "<name> · <distance rounded to the metre> m", e.g. "Split Cedar · 148 m". */
export function pointerText(name, distance) {
  return `${name} · ${Math.round(distance)} m`;
}

/**
 * Where the arrow sits and which way it points, given a screen projection
 * and the viewport it is drawn into. Never called for a tree already on
 * screen — `main.js` checks `onScreen` and hides the pointer instead.
 *
 * A point behind the camera projects mirrored through the screen centre (the
 * same maths a rear-view mirror flips), so its raw x is negated to recover
 * which side the target is really on; a behind target only ever pins to the
 * left or right edge; it does not move up or down (dy 0). A point in front
 * but off screen is clamped along the ray from the screen centre through it
 * to wherever that ray crosses the inset rectangle.
 *
 * @param {{x: number, y: number, behind: boolean}} projected
 * @param {{width: number, height: number}} viewport
 * @returns {{onScreen: boolean, x: number, y: number, angle: number}}
 *   `angle` is radians, 0 pointing along +X (screen right), matching the
 *   arrow glyph drawn pointing right at angle 0.
 */
export function edgePointer(projected, viewport) {
  const { width, height } = viewport;
  const margin = PUZZLE_POINTER.edgeMarginPx;
  const cx = width / 2;
  const cy = height / 2;

  if (projected.behind) {
    const offset = projected.x - cx;
    // Negate: a raw offset to the right of centre means the target is really
    // to the left once you turn around. Ties (dead behind) default right.
    const pointingRight = offset <= 0;
    return {
      onScreen: false,
      x: pointingRight ? width - margin : margin,
      y: cy,
      angle: pointingRight ? 0 : Math.PI,
    };
  }

  const onScreen = (
    projected.x >= 0 && projected.x <= width && projected.y >= 0 && projected.y <= height
  );
  if (onScreen) {
    return {
      onScreen: true, x: projected.x, y: projected.y, angle: 0,
    };
  }

  const dx = projected.x - cx;
  const dy = projected.y - cy;
  const angle = Math.atan2(dy, dx);

  // Scale the ray from the centre through the raw point until it first
  // crosses one of the four insets; smaller of the two candidate scales wins,
  // same idea as a ray-box intersection with the box centred on the screen.
  let scale = Infinity;
  if (dx > 0) scale = Math.min(scale, (width - margin - cx) / dx);
  else if (dx < 0) scale = Math.min(scale, (margin - cx) / dx);
  if (dy > 0) scale = Math.min(scale, (height - margin - cy) / dy);
  else if (dy < 0) scale = Math.min(scale, (margin - cy) / dy);
  if (!Number.isFinite(scale)) scale = 0;

  return {
    onScreen: false,
    x: cx + dx * scale,
    y: cy + dy * scale,
    angle,
  };
}

/**
 * Owns the pointer DOM: one arrow glyph and one text plate, created once and
 * only ever repositioned — same no-per-frame-allocation contract as
 * tree-labels.js and the render/ effects.
 *
 * @param {HTMLElement} root mounted into, e.g. the `#overlay` container
 */
export function createPuzzlePointer(root) {
  const container = document.createElement('div');
  container.className = 'puzzle-pointer puzzle-pointer--hidden';

  const arrow = document.createElement('div');
  arrow.className = 'puzzle-pointer-arrow';
  arrow.style.setProperty('--arrow-size', `${PUZZLE_POINTER.arrowSizePx}px`);

  // Set on the container, not the text plate: the arrow's fill and stroke
  // read the same custom properties.
  container.style.setProperty('--legible-plate', LEGIBLE_TEXT.plateColour);
  container.style.setProperty('--legible-text', LEGIBLE_TEXT.textColour);
  container.style.setProperty('--legible-weight', String(LEGIBLE_TEXT.fontWeight));

  const text = document.createElement('div');
  text.className = 'puzzle-pointer-text';
  text.style.fontSize = `${LEGIBLE_TEXT.minFontPx}px`;

  container.append(arrow, text);
  root.appendChild(container);

  return {
    /**
     * @param {{visible: boolean, x: number, y: number, angle: number, text: string}} state
     */
    update({
      visible, x, y, angle, text: label,
    }) {
      if (!visible) {
        container.classList.add('puzzle-pointer--hidden');
        return;
      }
      container.classList.remove('puzzle-pointer--hidden');
      arrow.style.left = `${x}px`;
      arrow.style.top = `${y}px`;
      arrow.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
      if (text.textContent !== label) text.textContent = label;

      // The text plate sits beside the arrow, toward the screen centre —
      // never off toward the edge, where it would run past the viewport —
      // and is then clamped against the root's actual size using its
      // measured box, since its width depends on the label text.
      const pointingRight = Math.cos(angle) >= 0;
      const gap = PUZZLE_POINTER.textGapPx;
      const halfArrow = PUZZLE_POINTER.arrowSizePx / 2;
      const textWidth = text.offsetWidth;
      const textHeight = text.offsetHeight;
      let textX = pointingRight ? x - halfArrow - gap - textWidth : x + halfArrow + gap;
      let textY = y - textHeight / 2;

      const maxX = root.clientWidth - textWidth;
      const maxY = root.clientHeight - textHeight;
      textX = Math.min(Math.max(textX, 0), Math.max(maxX, 0));
      textY = Math.min(Math.max(textY, 0), Math.max(maxY, 0));

      text.style.left = `${textX}px`;
      text.style.top = `${textY}px`;
    },

    hide() {
      container.classList.add('puzzle-pointer--hidden');
    },
  };
}
