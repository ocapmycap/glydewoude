/**
 * Floating name tags above named trees (LAN-567), toggled with the N key.
 *
 * Split into a pure half — the fade curve, which trees qualify, and where a
 * label's world anchor sits — and a `createTreeLabels` factory that owns the
 * DOM. The pure half is what client/test/tree-labels.test.js exercises; it
 * takes no DOM and no Three.js, so it runs headlessly like the rest of sim/
 * even though this file lives in ui/ (D-70).
 *
 * LAN-578 adds low-vision legibility on top: a font size that grows as the
 * camera closes in (`labelFontPx`, floored and ceilinged by LEGIBLE_TEXT) and
 * an exception for puzzle trees, whose tag is worth reading from much further
 * off than an ordinary landmark's, so it skips the distance cutoff entirely.
 */

import { TREE_TYPES } from '@glidewood/shared';

import { LEGIBLE_TEXT } from './legibility.js';

/**
 * Distance fade for labels, in metres from the camera: full opacity out to
 * `fadeStartDistance`, eased to invisible by `cutoffDistance`, so a big open
 * forest doesn't fill the screen with text. Lives here rather than in
 * render/ because this is the only module that reads it — keeping it out of
 * render/ is what lets `labelOpacity` and `treeLabelState` stay covered by a
 * plain Node test.
 *
 * On the default seed, named trees other than the great tree sit 71-119 m
 * out and the puzzle tree (Split Cedar) at 148 m; the fade starts well short
 * of that band and the cutoff sits just past it, so an ordinary landmark's
 * tag only appears once you have actually glided close enough to read it
 * (D-70). Split Cedar is the exception: `treeLabelState` lets a puzzle tree's
 * tag ignore the cutoff below, since knowing where the trial is well before
 * you arrive matters more than keeping the forest calm (LAN-578).
 *
 * `sizeReferenceDistance` is the separate distance band `labelFontPx` uses:
 * at or inside it a label draws at LEGIBLE_TEXT's ceiling, easing down to its
 * floor by `cutoffDistance` so a label is never too small to read even as it
 * fades.
 */
export const TREE_LABEL_VIEW = Object.freeze({
  fadeStartDistance: 60,
  cutoffDistance: 130,
  sizeReferenceDistance: 20,
});

/** Puzzle tree tags read "Puzzle · <name>" so the trial stands out from an ordinary landmark's. */
export const PUZZLE_LABEL_PREFIX = 'Puzzle · ';

/** True only for a puzzle-course tree (shared/src/constants.js TREE_TYPES). */
export function isPuzzleTree(tree) {
  return tree.type === TREE_TYPES.PUZZLE;
}

/** The text a label actually shows: a puzzle tree's name gets prefixed. */
export function labelText(tree) {
  return isPuzzleTree(tree) ? PUZZLE_LABEL_PREFIX + tree.name : tree.name;
}

/**
 * Font size in CSS pixels for a label at `distance` metres from the camera:
 * LEGIBLE_TEXT's ceiling at or inside `sizeReferenceDistance`, easing down to
 * its floor by `cutoffDistance` and never smaller after that — a label that
 * has faded to invisible is hidden outright by `treeLabelState`, not shrunk.
 */
export function labelFontPx(distance) {
  const { sizeReferenceDistance, cutoffDistance } = TREE_LABEL_VIEW;
  const { minFontPx, maxFontPx } = LEGIBLE_TEXT;
  if (distance <= sizeReferenceDistance) return maxFontPx;
  if (distance >= cutoffDistance) return minFontPx;
  const t = (distance - sizeReferenceDistance) / (cutoffDistance - sizeReferenceDistance);
  return maxFontPx - t * (maxFontPx - minFontPx);
}

/**
 * How far a label's world anchor clears the tree's drawn canopy top, in
 * metres and canopy radii. These numbers mirror (but do not import, so this
 * file stays three-free) the canopy placement in render/trees.js and
 * render/towering-trees.js:
 *  - An ordinary perch's canopy top already sits at very close to `perchY`
 *    (canopy hangs below the perch by CANOPY_DROP), so a flat clearance is
 *    enough.
 *  - A towering tree has no perch; its canopy top sits roughly
 *    `towerCanopyFactor * canopyRadius` above the trunk top (its topmost
 *    CANOPY_BLOBS entry, squashed by CANOPY_VERTICAL_SQUASH), which is a lot
 *    more than a flat metre or two on a giant tree.
 */
const LABEL_CLEARANCE = Object.freeze({
  abovePerch: 2.5,
  aboveTowerTrunk: 2.5,
  towerCanopyFactor: 0.65,
});

/** 1 at and below `fadeStartDistance`, 0 at and beyond `cutoffDistance`, linear between. */
export function labelOpacity(distance) {
  const { fadeStartDistance, cutoffDistance } = TREE_LABEL_VIEW;
  if (distance <= fadeStartDistance) return 1;
  if (distance >= cutoffDistance) return 0;
  return 1 - (distance - fadeStartDistance) / (cutoffDistance - fadeStartDistance);
}

/**
 * Folds a tree's name with its projected screen point into what the DOM
 * needs to draw: a screen position, whether to show the tag at all, and how
 * transparent it is. Points behind the camera or past the cutoff are hidden
 * outright rather than merely faded to 0, so an off-screen tag can never
 * catch a stray click even if pointer-events were ever re-enabled. A puzzle
 * tree is the one exception to the cutoff (LAN-578): it stays fully visible
 * at any distance so long as it is in front of the camera, since the trial
 * is worth knowing about from further off than an ordinary landmark's name.
 *
 * @param {{id: string, name: string}} tree
 * @param {{x: number, y: number, distance: number, behind: boolean}} projected
 */
export function treeLabelState(tree, projected) {
  if (isPuzzleTree(tree)) {
    return {
      id: tree.id,
      name: tree.name,
      x: projected.x,
      y: projected.y,
      visible: !projected.behind,
      opacity: projected.behind ? 0 : 1,
    };
  }
  const visible = !projected.behind && projected.distance < TREE_LABEL_VIEW.cutoffDistance;
  return {
    id: tree.id,
    name: tree.name,
    x: projected.x,
    y: projected.y,
    visible,
    opacity: visible ? labelOpacity(projected.distance) : 0,
  };
}

/** Trees worth a label: anything with a non-empty name. Unnamed scenery gets none. */
export function labelledTrees(trees) {
  return trees.filter((tree) => Boolean(tree.name));
}

/**
 * The world point a label floats above: the tree's trunk position, at a
 * height that clears the drawn canopy (see LABEL_CLEARANCE above). Towering
 * trees carry `perchY: null` (no reachable top, D-63), so they anchor off
 * the trunk height instead.
 *
 * @param {object} tree
 * @returns {{x: number, y: number, z: number}}
 */
export function labelAnchor(tree) {
  if (tree.perchY == null) {
    const trunkTopY = tree.position.y + tree.trunkHeight;
    return {
      x: tree.position.x,
      y: trunkTopY + tree.canopyRadius * LABEL_CLEARANCE.towerCanopyFactor + LABEL_CLEARANCE.aboveTowerTrunk,
      z: tree.position.z,
    };
  }
  return {
    x: tree.position.x,
    y: tree.perchY + LABEL_CLEARANCE.abovePerch,
    z: tree.position.z,
  };
}

/**
 * Owns the label DOM. One `.tree-label` pill per labelled tree, created the
 * first time it is seen and reused after — the update loop never creates or
 * destroys elements per frame, only repositions and re-hides them.
 *
 * @param {HTMLElement} root mounted into, e.g. the `#overlay` container
 */
export function createTreeLabels(root) {
  const container = document.createElement('div');
  container.className = 'tree-labels tree-labels--hidden';
  // LEGIBLE_TEXT is the single source of truth for plate/text colour and
  // weight; style.css reads these custom properties rather than hard-coding
  // its own copy, so the two can never drift apart.
  container.style.setProperty('--legible-plate', LEGIBLE_TEXT.plateColour);
  container.style.setProperty('--legible-text', LEGIBLE_TEXT.textColour);
  container.style.setProperty('--legible-weight', String(LEGIBLE_TEXT.fontWeight));
  root.appendChild(container);

  const elements = new Map();
  let shown = false;

  function elementFor(label) {
    let el = elements.get(label.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tree-label';
      container.appendChild(el);
      elements.set(label.id, el);
    }
    if (el.textContent !== label.text) el.textContent = label.text;
    return el;
  }

  return {
    /** Flip visibility. Off by default so the forest stays calm (product doc §2.1). */
    toggle() {
      shown = !shown;
      container.classList.toggle('tree-labels--hidden', !shown);
    },

    get shown() {
      return shown;
    },

    /**
     * @param {Array<{
     *   id: string, text: string, x: number, y: number, visible: boolean,
     *   opacity: number, fontPx: number, puzzle: boolean,
     * }>} labels  `treeLabelState` plus the display text, font size and
     *   puzzle flag the caller derives from the tree (see main.js)
     */
    update(labels) {
      const seen = new Set();
      for (const label of labels) {
        const el = elementFor(label);
        seen.add(label.id);
        el.style.left = `${label.x}px`;
        el.style.top = `${label.y}px`;
        el.style.opacity = String(label.opacity);
        el.style.fontSize = `${label.fontPx}px`;
        el.classList.toggle('tree-label--hidden', !label.visible);
        // A puzzle label is thicker-bordered rather than differently
        // coloured, so the distinction survives a colour-blind or
        // low-contrast display (shape and size carry meaning too).
        el.classList.toggle('tree-label--puzzle', Boolean(label.puzzle));
      }
      // A label whose tree fell out of this frame's list (never happens with
      // a static forest today, but the caller's contract does not promise
      // it) stays hidden rather than stuck showing a stale position.
      for (const [id, el] of elements) {
        if (!seen.has(id)) el.classList.add('tree-label--hidden');
      }
    },
  };
}
