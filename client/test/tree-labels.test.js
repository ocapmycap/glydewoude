/**
 * Pure part of the floating tree-name labels (LAN-567): the distance → fade
 * curve, the behind-camera cutoff, which trees qualify for a label at all,
 * and where a label's world anchor sits above the canopy. DOM creation and
 * the N-key toggle are UI wiring and are not covered here (product doc §7.4
 * on feel/rendering not being unit-tested).
 */

import { describe, expect, it } from 'vitest';
import { generateForest } from '@glidewood/shared';

import {
  TREE_LABEL_VIEW,
  labelAnchor,
  labelOpacity,
  labelledTrees,
  treeLabelState,
} from '../src/ui/tree-labels.js';

describe('TREE_LABEL_VIEW', () => {
  it('is frozen and starts the fade before the cutoff', () => {
    expect(Object.isFrozen(TREE_LABEL_VIEW)).toBe(true);
    expect(TREE_LABEL_VIEW.fadeStartDistance).toBeLessThan(TREE_LABEL_VIEW.cutoffDistance);
  });
});

describe('labelOpacity', () => {
  it('is fully opaque at and below the fade start distance', () => {
    expect(labelOpacity(0)).toBe(1);
    expect(labelOpacity(TREE_LABEL_VIEW.fadeStartDistance)).toBe(1);
  });

  it('is fully transparent at and beyond the cutoff distance', () => {
    expect(labelOpacity(TREE_LABEL_VIEW.cutoffDistance)).toBe(0);
    expect(labelOpacity(TREE_LABEL_VIEW.cutoffDistance + 500)).toBe(0);
  });

  it('is strictly between 0 and 1 partway through the fade band', () => {
    const midpoint = (TREE_LABEL_VIEW.fadeStartDistance + TREE_LABEL_VIEW.cutoffDistance) / 2;
    const opacity = labelOpacity(midpoint);
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
  });

  it('decreases monotonically across the fade band and stays within [0, 1]', () => {
    const { fadeStartDistance, cutoffDistance } = TREE_LABEL_VIEW;
    const span = cutoffDistance - fadeStartDistance;
    const samples = Array.from({ length: 20 }, (_, i) => (
      labelOpacity(fadeStartDistance + (span * i) / 19)
    ));
    for (const value of samples) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1]);
    }
  });
});

describe('treeLabelState', () => {
  const tree = { id: 'tree-030', name: 'Split Cedar' };

  it('is visible with full opacity for a near point in front of the camera', () => {
    const projected = { x: 400, y: 220, distance: 10, behind: false };
    const state = treeLabelState(tree, projected);
    expect(state).toEqual({
      id: 'tree-030', name: 'Split Cedar', x: 400, y: 220, visible: true, opacity: 1,
    });
  });

  it('hides a point behind the camera even when it is near', () => {
    const projected = { x: 400, y: 220, distance: 1, behind: true };
    const state = treeLabelState(tree, projected);
    expect(state.visible).toBe(false);
  });

  it('hides a point at or beyond the cutoff distance', () => {
    const atCutoff = treeLabelState(tree, {
      x: 0, y: 0, distance: TREE_LABEL_VIEW.cutoffDistance, behind: false,
    });
    const beyondCutoff = treeLabelState(tree, {
      x: 0, y: 0, distance: TREE_LABEL_VIEW.cutoffDistance + 50, behind: false,
    });
    expect(atCutoff.visible).toBe(false);
    expect(beyondCutoff.visible).toBe(false);
  });

  it('passes x and y through unchanged', () => {
    const projected = { x: 123.5, y: -45, distance: 20, behind: false };
    const state = treeLabelState(tree, projected);
    expect(state.x).toBe(123.5);
    expect(state.y).toBe(-45);
  });

  it('does not mutate the tree or the projected point it is given', () => {
    const treeCopy = { ...tree };
    const projected = { x: 1, y: 2, distance: 3, behind: false };
    const projectedCopy = { ...projected };
    treeLabelState(tree, projected);
    expect(tree).toEqual(treeCopy);
    expect(projected).toEqual(projectedCopy);
  });
});

describe('labelledTrees', () => {
  it('keeps only trees with a non-empty name, preserving order', () => {
    const trees = [
      { id: 'a', name: 'Alpha' },
      { id: 'b' },
      { id: 'c', name: '' },
      { id: 'd', name: 'Delta' },
    ];
    expect(labelledTrees(trees)).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'd', name: 'Delta' },
    ]);
  });

  it('excludes unnamed scenery from a real generated forest', () => {
    const { trees } = generateForest();
    const labelled = labelledTrees(trees);
    expect(labelled.length).toBeGreaterThan(0);
    expect(labelled.length).toBeLessThan(trees.length);
    for (const tree of labelled) {
      expect(tree.name).toBeTruthy();
    }
  });
});

describe('labelAnchor', () => {
  it('sits above the canopy top for a named perch tree from the real forest', () => {
    const { trees } = generateForest();
    const splitCedar = trees.find((tree) => tree.name === 'Split Cedar');
    expect(splitCedar).toBeTruthy();

    const anchor = labelAnchor(splitCedar);
    // Canopy blobs hang below perchY (CANOPY_DROP in render/trees.js), so the
    // perch itself is already at or above the drawn canopy's top; the label
    // anchor must clear that, not just match it.
    expect(anchor.y).toBeGreaterThan(splitCedar.perchY);
    expect(anchor.x).toBe(splitCedar.position.x);
    expect(anchor.z).toBe(splitCedar.position.z);
    expect(Number.isFinite(anchor.y)).toBe(true);
  });

  it('sits above the trunk top of a towering tree, which has no perch', () => {
    const { trees } = generateForest();
    const towering = trees.find((tree) => tree.towering);
    expect(towering).toBeTruthy();
    expect(towering.perchY).toBeNull();

    const anchor = labelAnchor(towering);
    expect(Number.isFinite(anchor.y)).toBe(true);
    expect(anchor.y).toBeGreaterThan(towering.position.y + towering.trunkHeight);
    expect(anchor.x).toBe(towering.position.x);
    expect(anchor.z).toBe(towering.position.z);
  });

  it('does not mutate the tree it is given', () => {
    const { trees } = generateForest();
    const splitCedar = trees.find((tree) => tree.name === 'Split Cedar');
    const before = JSON.parse(JSON.stringify(splitCedar));
    labelAnchor(splitCedar);
    expect(splitCedar).toEqual(before);
  });
});
