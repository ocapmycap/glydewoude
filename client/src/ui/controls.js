/**
 * The one source of truth for what every input does.
 *
 * `input.js` handles keys; `gamepad.js` polls the pad; the help panel
 * (`help-panel.js`) renders this table so the on-screen list can never say
 * something the bindings don't do. `client/test/controls.test.js` checks the
 * two files agree: every code `input.js` actually handles (its exported
 * `HANDLED_KEY_CODES`) has a row here, and every code named here is one
 * `input.js` actually handles. README.md's control table is not checked by
 * that test and must be kept in sync by hand.
 *
 * A row's `codes` are the `event.code` values it covers, for that coverage
 * check — empty where there is no keyboard code at all (mouse click) or the
 * codes are already claimed by another row (turning round while perched
 * reuses the dive/flare keys).
 */

export const CONTROLS = Object.freeze([
  Object.freeze({
    keys: ['Space'],
    codes: ['Space'],
    gamepad: 'A',
    action: 'launch from the branch',
  }),
  Object.freeze({
    keys: ['A', 'D', '←', '→'],
    codes: ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'],
    gamepad: 'left stick',
    action: 'steer (turns on the spot while perched)',
  }),
  Object.freeze({
    keys: ['W', 'S', '↑', '↓'],
    codes: ['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'],
    gamepad: 'left stick forward/back',
    action: 'dive / flare',
  }),
  Object.freeze({
    keys: ['S', '↓'],
    codes: [],
    gamepad: null,
    action: 'turn round, while perched',
  }),
  Object.freeze({
    keys: ['click'],
    codes: [],
    gamepad: null,
    action: 'steer and pitch with the mouse (click the canvas for pointer lock)',
  }),
  Object.freeze({
    keys: ['Esc'],
    codes: ['Escape'],
    gamepad: null,
    action: 'release the mouse, and close this panel',
  }),
  Object.freeze({
    keys: ['R'],
    codes: ['KeyR'],
    gamepad: 'Back / Select',
    action: 'return to the great oak',
  }),
  Object.freeze({
    keys: ['B'],
    codes: ['KeyB'],
    gamepad: 'Y',
    action: 'open or close the upgrade shop',
  }),
  Object.freeze({
    keys: ['T'],
    codes: ['KeyT'],
    gamepad: null,
    action: 'show or hide the glide tuning dials',
  }),
  Object.freeze({
    keys: ['N'],
    codes: ['KeyN'],
    gamepad: null,
    action: 'show or hide the names of named trees',
  }),
  Object.freeze({
    keys: ['H'],
    codes: ['KeyH'],
    gamepad: null,
    action: 'show or hide this list',
  }),
]);
