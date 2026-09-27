/**
 * Floating name tags above named trees (LAN-567), toggled with the N key.
 *
 * Split into a pure half — the fade curve, which trees qualify, and where a
 * label's world anchor sits — and a `createTreeLabels` factory that owns the
 * DOM. The pure half is what client/test/tree-labels.test.js exercises; it
 * takes no DOM and no Three.js, so it runs headlessly like the rest of sim/
 * even though this file lives in ui/ (D-70).
 */

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
 * of that band and the cutoff sits just past it, so Split Cedar's tag only
 * appears once you have actually glided close enough to read it (D-70).
 */
export const TREE_LABEL_VIEW = Object.freeze({
  fadeStartDistance: 60,
  cutoffDistance: 130,
});

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
 * catch a stray click even if pointer-events were ever re-enabled.
 *
 * @param {{id: string, name: string}} tree
 * @param {{x: number, y: number, distance: number, behind: boolean}} projected
 */
export function treeLabelState(tree, projected) {
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
    if (el.textContent !== label.name) el.textContent = label.name;
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
     * @param {Array<{id: string, name: string, x: number, y: number, visible: boolean, opacity: number}>} labels
     */
    update(labels) {
      const seen = new Set();
      for (const label of labels) {
        const el = elementFor(label);
        seen.add(label.id);
        el.style.left = `${label.x}px`;
        el.style.top = `${label.y}px`;
        el.style.opacity = String(label.opacity);
        el.classList.toggle('tree-label--hidden', !label.visible);
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
