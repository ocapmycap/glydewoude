/**
 * Unit tests for the ring-trial DOM prompt's pure text logic (LAN-549).
 *
 * `trialPrompt` turns one puzzle event into `{ line, flash }` for the HUD to
 * render. It is pure — no DOM, no simulation — so it is tested in isolation
 * here; wiring it into the page is not covered by an automated test (feel).
 */

import { describe, expect, it } from 'vitest';

import { trialPrompt } from '../src/ui/puzzle-prompt.js';

const targetName = 'Hollow Beacon';

function course(ringCount = 3) {
  return {
    targetTreeId: 'tree-target',
    rings: Array.from({ length: ringCount }, (_, i) => (
      { center: { x: 0, y: 10, z: i * 10 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 }
    )),
  };
}

describe('trialPrompt', () => {
  it('armed: mentions the ring count and the target name, no flash', () => {
    const event = { type: 'puzzle:armed', tree: { id: 'tree-puzzle' }, course: course(3) };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.line).toContain('3');
    expect(result.line).toContain(targetName);
    expect(result.flash).toBeUndefined();
  });

  it('started: shows "Ring 1 of N"', () => {
    const event = { type: 'puzzle:started', treeId: 'tree-puzzle', course: course(3) };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.line).toBe('Ring 1 of 3');
  });

  it('ring: advances to the next ring number when more remain', () => {
    const event = { type: 'puzzle:ring', treeId: 'tree-puzzle', index: 0 };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.line).toBe('Ring 2 of 3');
  });

  it('ring: after the last ring, tells the player to land on the target instead of counting', () => {
    const event = { type: 'puzzle:ring', treeId: 'tree-puzzle', index: 2 };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.line).toContain(targetName);
    expect(result.line).not.toMatch(/Ring \d+ of/);
  });

  it('solved: a non-empty flash and no line', () => {
    const event = { type: 'puzzle:solved', treeId: 'tree-puzzle', atTime: 12.5, glide: { distance: 42 } };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.line).toBeNull();
    expect(result.flash).toBeTruthy();
  });

  it('solved: does not mention reward or material words yet', () => {
    const event = { type: 'puzzle:solved', treeId: 'tree-puzzle', atTime: 12.5, glide: { distance: 42 } };
    const result = trialPrompt(event, { targetName, ringCount: 3 });

    expect(result.flash).not.toMatch(/berr|material|reward/i);
  });

  it('failed: a non-empty flash and no line, for each reason', () => {
    const reasons = ['ground', 'missed-ring', 'wrong-tree', 'respawn'];
    for (const reason of reasons) {
      const event = { type: 'puzzle:failed', treeId: 'tree-puzzle', reason };
      const result = trialPrompt(event, { targetName, ringCount: 3 });

      expect(result.line).toBeNull();
      expect(result.flash).toBeTruthy();
    }
  });

  it('failed: each reason produces a distinct flash', () => {
    const reasons = ['ground', 'missed-ring', 'wrong-tree', 'respawn'];
    const flashes = reasons.map((reason) => (
      trialPrompt({ type: 'puzzle:failed', treeId: 'tree-puzzle', reason }, { targetName, ringCount: 3 }).flash
    ));

    expect(new Set(flashes).size).toBe(reasons.length);
  });

  it('any other event type returns null', () => {
    expect(trialPrompt({ type: 'glide:landed' }, { targetName, ringCount: 3 })).toBeNull();
    expect(trialPrompt({ type: 'run:started' }, { targetName, ringCount: 3 })).toBeNull();
  });

  it('does not mutate the event it is given', () => {
    const event = { type: 'puzzle:armed', tree: { id: 'tree-puzzle' }, course: course(3) };
    const snapshot = structuredClone(event);

    trialPrompt(event, { targetName, ringCount: 3 });

    expect(event).toEqual(snapshot);
  });
});
