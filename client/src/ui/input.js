/**
 * Browser input -> the simulation's intent object.
 *
 * This is the only place in the client that listens to the keyboard or mouse.
 * It writes into the same plain `InputState` struct the headless tests fill in
 * by hand, so the simulation never learns whether a human or a test is flying.
 *
 * The full control list — what every key and gamepad button does — lives in
 * `controls.js`, not here, so the help panel and this file can never disagree
 * about it. `ACTION_KEYS` below is this file's half of that contract: every
 * single-press key it handles, and the name of the action it fires. Steering
 * and pitch stay in their own maps since they are held, not pressed.
 */

import { createGamepadReader } from './gamepad.js';

const STEER_KEYS = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 };
const PITCH_KEYS = { KeyW: -1, ArrowUp: -1, KeyS: 1, ArrowDown: 1 };

/** Single-press keys, and the action each one fires on keydown. */
const ACTION_KEYS = Object.freeze({
  Space: 'launch',
  KeyR: 'respawn',
  KeyT: 'toggleTuning',
  KeyB: 'toggleShop',
  KeyN: 'toggleLabels',
  KeyH: 'toggleHelp',
  Escape: 'closeHelp',
});

/**
 * Every `event.code` this file acts on. `controls.test.js` checks each one
 * has a row in `controls.js`'s CONTROLS table, so this list — not a hand-kept
 * duplicate — is what that test reads.
 */
export const HANDLED_KEY_CODES = Object.freeze([
  ...Object.keys(STEER_KEYS),
  ...Object.keys(PITCH_KEYS),
  ...Object.keys(ACTION_KEYS),
]);

const MOUSE_SENSITIVITY = 0.0075;
/** How fast mouse steering recentres when the hand stops moving (1/s). */
const MOUSE_DECAY = 3.5;

export function createInputBindings(
  input,
  canvas,
  { onToggleTuning, onToggleShop, onToggleLabels, onToggleHelp, onCloseHelp } = {},
) {
  const held = new Set();
  let mouseSteer = 0;
  let mousePitch = 0;
  let pointerLocked = false;
  // Guarded because browsers without the Gamepad API have no getGamepads.
  const gamepad = createGamepadReader(() => navigator.getGamepads?.() ?? []);

  function onKeyDown(event) {
    if (event.repeat) return;
    switch (ACTION_KEYS[event.code]) {
      case 'launch':
        input.launch = true;
        event.preventDefault();
        break;
      case 'respawn':
        input.respawn = true;
        break;
      case 'toggleTuning':
        onToggleTuning?.();
        break;
      case 'toggleShop':
        onToggleShop?.();
        break;
      case 'toggleLabels':
        onToggleLabels?.();
        break;
      case 'toggleHelp':
        onToggleHelp?.();
        break;
      case 'closeHelp':
        // Escape both closes the help panel and, while flying with the mouse,
        // releases pointer lock — either or both may apply at once.
        onCloseHelp?.();
        if (pointerLocked) document.exitPointerLock();
        break;
      default:
        break;
    }
    held.add(event.code);
  }

  function onKeyUp(event) {
    held.delete(event.code);
  }

  function onMouseMove(event) {
    if (!pointerLocked) return;
    mouseSteer = clamp(mouseSteer + event.movementX * MOUSE_SENSITIVITY, -1, 1);
    mousePitch = clamp(mousePitch + event.movementY * MOUSE_SENSITIVITY, -1, 1);
  }

  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked) {
      mouseSteer = 0;
      mousePitch = 0;
    }
  }

  function onCanvasClick() {
    if (!pointerLocked) canvas.requestPointerLock?.();
  }

  function onBlur() {
    // Dropping the keys on blur stops the squirrel banking forever after an
    // alt-tab mid-turn.
    held.clear();
    mouseSteer = 0;
    mousePitch = 0;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  window.addEventListener('mousemove', onMouseMove);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('click', onCanvasClick);

  return {
    /** Fold held keys and mouse drift into the intent object. Call per step. */
    sync(dt) {
      let steer = 0;
      let pitch = 0;
      for (const code of held) {
        steer += STEER_KEYS[code] ?? 0;
        pitch += PITCH_KEYS[code] ?? 0;
      }

      // Precedence: keys (digital, most precise) beat the stick (analogue,
      // explicit) beat the mouse (ambient drift while pointer-locked).
      const pad = gamepad.poll();
      if (steer === 0) steer = pad.steer;
      if (pitch === 0) pitch = pad.pitch;

      if (pointerLocked) {
        const decay = Math.exp(-MOUSE_DECAY * dt);
        mouseSteer *= decay;
        mousePitch *= decay;
        if (steer === 0) steer = mouseSteer;
        if (pitch === 0) pitch = mousePitch;
      }

      input.steer = clamp(steer, -1, 1);
      input.pitch = clamp(pitch, -1, 1);

      if (pad.launch) input.launch = true;
      if (pad.respawn) input.respawn = true;
      if (pad.toggleShop) onToggleShop?.();
    },

    get pointerLocked() {
      return pointerLocked;
    },

    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      canvas.removeEventListener('click', onCanvasClick);
    },
  };
}

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
