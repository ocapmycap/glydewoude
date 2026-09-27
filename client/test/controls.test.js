import { describe, expect, it } from 'vitest';

import { CONTROLS } from '../src/ui/controls.js';
import { HANDLED_KEY_CODES } from '../src/ui/input.js';

describe('HANDLED_KEY_CODES coverage in CONTROLS', () => {
  it('lists a CONTROLS row for every handled key code', () => {
    const covered = new Set(CONTROLS.flatMap((row) => row.codes));
    for (const code of HANDLED_KEY_CODES) {
      expect(covered.has(code), `no CONTROLS row covers handled code ${code}`).toBe(true);
    }
  });

  it('includes the help and tree-label toggle codes', () => {
    expect(HANDLED_KEY_CODES).toContain('KeyH');
    expect(HANDLED_KEY_CODES).toContain('KeyN');
  });
});

describe('CONTROLS rows', () => {
  it('each has a non-empty action and at least one of keys or gamepad', () => {
    for (const row of CONTROLS) {
      expect(typeof row.action).toBe('string');
      expect(row.action.length).toBeGreaterThan(0);
      const hasKeys = Array.isArray(row.keys) && row.keys.length > 0;
      const hasGamepad = row.gamepad !== null && row.gamepad !== undefined;
      expect(hasKeys || hasGamepad, `row "${row.action}" has neither keys nor gamepad`).toBe(true);
    }
  });

  it('is frozen, and so is every row', () => {
    expect(Object.isFrozen(CONTROLS)).toBe(true);
    for (const row of CONTROLS) {
      expect(Object.isFrozen(row)).toBe(true);
    }
  });

  it('names no code that is not actually handled (no stale rows)', () => {
    const handled = new Set(HANDLED_KEY_CODES);
    for (const row of CONTROLS) {
      for (const code of row.codes) {
        expect(handled.has(code), `CONTROLS row "${row.action}" names unhandled code ${code}`).toBe(true);
      }
    }
  });
});
