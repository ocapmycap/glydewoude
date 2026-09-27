/**
 * Pure part of the off-screen puzzle-tree pointer (LAN-578): which puzzle
 * tree is nearest, the label text for it, and the edge-of-screen arrow
 * geometry for a target that is off screen or behind the camera. The DOM
 * arrow element itself (`createPuzzlePointer`) is UI wiring and is not
 * covered here, same as the rest of ui/'s pure-vs-DOM split (see
 * tree-labels.js).
 */

import { describe, expect, it } from 'vitest';
import { TREE_TYPES, generateForest } from '@glidewood/shared';

import {
  PUZZLE_POINTER,
  edgePointer,
  nearestPuzzleTree,
  pointerText,
} from '../src/ui/puzzle-pointer.js';

describe('PUZZLE_POINTER', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(PUZZLE_POINTER)).toBe(true);
  });

  it('has a positive edge margin and arrive distance', () => {
    expect(PUZZLE_POINTER.edgeMarginPx).toBeGreaterThan(0);
    expect(PUZZLE_POINTER.arriveDistance).toBeGreaterThan(0);
  });
});

describe('nearestPuzzleTree', () => {
  const puzzleFar = {
    id: 'p-far', name: 'Far Puzzle', type: TREE_TYPES.PUZZLE, position: { x: 100, y: 0, z: 0 },
  };
  const puzzleNear = {
    id: 'p-near', name: 'Near Puzzle', type: TREE_TYPES.PUZZLE, position: { x: 5, y: 0, z: 0 },
  };
  const sceneryNear = {
    id: 's-near', name: 'Near Scenery', type: TREE_TYPES.SCENERY, position: { x: 1, y: 0, z: 0 },
  };

  it('picks the nearest puzzle tree, ignoring a much nearer scenery tree', () => {
    const result = nearestPuzzleTree([sceneryNear, puzzleFar, puzzleNear], { x: 0, y: 0, z: 0 });
    expect(result.tree.id).toBe('p-near');
    expect(result.distance).toBeCloseTo(5, 6);
  });

  it('ignores height difference, using only horizontal distance', () => {
    const puzzleHighButNear = {
      id: 'p-high', name: 'High Puzzle', type: TREE_TYPES.PUZZLE, position: { x: 2, y: 500, z: 0 },
    };
    const puzzleLowButFar = {
      id: 'p-low', name: 'Low Puzzle', type: TREE_TYPES.PUZZLE, position: { x: 90, y: 0, z: 0 },
    };
    const result = nearestPuzzleTree(
      [puzzleLowButFar, puzzleHighButNear],
      { x: 0, y: 0, z: 0 },
    );
    expect(result.tree.id).toBe('p-high');
  });

  it('returns null when there are no puzzle trees', () => {
    expect(nearestPuzzleTree([sceneryNear], { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('returns null for an empty tree list', () => {
    expect(nearestPuzzleTree([], { x: 0, y: 0, z: 0 })).toBeNull();
  });

  it('finds Rookery Spire as the nearest puzzle tree from the great tree in the default forest', () => {
    const { trees } = generateForest();
    const greatTree = trees.find((tree) => tree.id === 'tree-great');
    expect(greatTree).toBeTruthy();

    const result = nearestPuzzleTree(trees, greatTree.position);
    expect(result).toBeTruthy();
    expect(result.tree.name).toBe('Rookery Spire');
  });
});

describe('pointerText', () => {
  it('formats a name and a rounded distance in metres', () => {
    expect(pointerText('Split Cedar', 147.6)).toBe('Split Cedar · 148 m');
  });

  it('rounds down as well as up', () => {
    expect(pointerText('Oak', 12.2)).toBe('Oak · 12 m');
  });
});

describe('edgePointer', () => {
  const viewport = { width: 1000, height: 600 };
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const margin = PUZZLE_POINTER.edgeMarginPx;

  it('reports onScreen for a point within the viewport and in front of the camera', () => {
    const result = edgePointer({ x: 500, y: 300, behind: false }, viewport);
    expect(result.onScreen).toBe(true);
  });

  it('reports not onScreen for the same coordinates when the point is behind the camera', () => {
    const result = edgePointer({ x: 500, y: 300, behind: true }, viewport);
    expect(result.onScreen).toBe(false);
  });

  it('clamps a point far to the right to the right inset edge, pointing right', () => {
    const result = edgePointer({ x: 2000, y: 300, behind: false }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.x).toBeCloseTo(viewport.width - margin, 6);
    expect(result.y).toBeCloseTo(300, 6);
    expect(result.angle).toBeCloseTo(0, 6);
  });

  it('clamps a point far above to the top inset edge, pointing up', () => {
    const result = edgePointer({ x: 500, y: -900, behind: false }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.y).toBeCloseTo(margin, 6);
    expect(result.x).toBeCloseTo(500, 6);
    expect(result.angle).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('clamps a diagonal down-left point onto the inset rectangle boundary', () => {
    const result = edgePointer({ x: -400, y: 900, behind: false }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.x).toBeGreaterThanOrEqual(margin);
    expect(result.x).toBeLessThanOrEqual(viewport.width - margin);
    expect(result.y).toBeGreaterThanOrEqual(margin);
    expect(result.y).toBeLessThanOrEqual(viewport.height - margin);
    // On the boundary means touching at least one of the four insets.
    const onLeft = Math.abs(result.x - margin) < 1e-6;
    const onRight = Math.abs(result.x - (viewport.width - margin)) < 1e-6;
    const onTop = Math.abs(result.y - margin) < 1e-6;
    const onBottom = Math.abs(result.y - (viewport.height - margin)) < 1e-6;
    expect(onLeft || onRight || onTop || onBottom).toBe(true);
    expect(result.angle).toBeGreaterThan(Math.PI / 2);
    expect(result.angle).toBeLessThan(Math.PI);
  });

  it('pins a behind-camera point whose raw projection is right of centre to the left edge, pointing left', () => {
    // The projection of a point behind the camera is mirrored through the
    // screen centre, so raw x right-of-centre really means "target is to
    // your left" once you turn around.
    const result = edgePointer({ x: cx + 300, y: cy, behind: true }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.x).toBeCloseTo(margin, 6);
    expect(Math.abs(result.angle)).toBeCloseTo(Math.PI, 6);
  });

  it('pins a behind-camera point whose raw projection is left of centre to the right edge, pointing right', () => {
    const result = edgePointer({ x: cx - 300, y: cy, behind: true }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.x).toBeCloseTo(viewport.width - margin, 6);
    expect(result.angle).toBeCloseTo(0, 6);
  });

  it('defaults a behind-camera point exactly at centre x to the right edge', () => {
    const result = edgePointer({ x: cx, y: cy, behind: true }, viewport);
    expect(result.onScreen).toBe(false);
    expect(result.x).toBeCloseTo(viewport.width - margin, 6);
  });

  it('always keeps the pointer inside the inset rectangle for a spread of far-off points', () => {
    const farPoints = [
      { x: 5000, y: 5000, behind: false },
      { x: -5000, y: -5000, behind: false },
      { x: 5000, y: -5000, behind: false },
      { x: -5000, y: 5000, behind: false },
      { x: 10, y: 10000, behind: false },
      { x: 10000, y: 10, behind: false },
      { x: cx + 1, y: cy + 1, behind: true },
      { x: cx - 1, y: cy - 1, behind: true },
    ];
    for (const point of farPoints) {
      const result = edgePointer(point, viewport);
      expect(result.onScreen).toBe(false);
      expect(result.x).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(result.x).toBeLessThanOrEqual(viewport.width - margin + 1e-6);
      expect(result.y).toBeGreaterThanOrEqual(margin - 1e-6);
      expect(result.y).toBeLessThanOrEqual(viewport.height - margin + 1e-6);
    }
  });
});
