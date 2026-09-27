/**
 * The controls help panel and its permanent corner hint (LAN-575).
 *
 * Styled and wired like the tuning panel (`tuning-panel.js`) — a toggled
 * paper card, hidden until asked for — because a Phase 1 prototype has no
 * other onboarding, and burying the control list in a README nobody sees
 * in-browser would defeat the point. The panel renders straight from
 * `CONTROLS` so it can never list a key the game doesn't actually bind.
 *
 * The hint stays up the whole time, low-contrast and out of the way, so a
 * new player always has a next step without the panel itself competing for
 * attention while they fly.
 */

import { CONTROLS } from './controls.js';

export function createHelpPanel(root) {
  const hint = document.createElement('div');
  hint.className = 'help-hint';
  hint.textContent = 'H — controls';
  root.append(hint);

  const panel = document.createElement('div');
  panel.className = 'help';
  panel.setAttribute('aria-hidden', 'true');

  const heading = document.createElement('h2');
  heading.textContent = 'controls';
  panel.append(heading);

  for (const row of CONTROLS) {
    const line = document.createElement('div');
    line.className = 'help-row';

    const keys = document.createElement('span');
    keys.className = 'help-keys';
    for (const key of row.keys) {
      const kbd = document.createElement('kbd');
      kbd.textContent = key;
      keys.append(kbd);
    }
    if (row.gamepad) {
      const gamepad = document.createElement('span');
      gamepad.className = 'help-gamepad';
      gamepad.textContent = row.gamepad;
      keys.append(gamepad);
    }

    const action = document.createElement('span');
    action.className = 'help-action';
    action.textContent = row.action;

    line.append(keys, action);
    panel.append(line);
  }

  root.append(panel);

  let visible = false;
  function setVisible(next) {
    visible = next;
    panel.classList.toggle('help--visible', visible);
    panel.setAttribute('aria-hidden', String(!visible));
  }

  return {
    toggle() {
      setVisible(!visible);
    },
    close() {
      setVisible(false);
    },
    get visible() {
      return visible;
    },
  };
}
