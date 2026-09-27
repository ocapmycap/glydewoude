/**
 * Standard-layout gamepad -> the simulation's intent shape.
 *
 * Pure mapping lives here so it can be driven by hand-built pad snapshots in
 * tests; `createGamepadReader` below is the only bit that touches the real
 * browser Gamepad API.
 */

/** Stick deflection below this magnitude reads as zero, then the rest is
 * rescaled so a full push still reaches +-1. */
export const GAMEPAD_DEAD_ZONE = 0.15;

/** Standard-layout button indices this game cares about, named for what they do. */
const GAMEPAD_BUTTONS = Object.freeze({
  LAUNCH: 0,
  TOGGLE_SHOP: 3,
  RESPAWN: 8,
});

function isUsablePad(pad) {
  return Boolean(pad) && pad.connected !== false && Array.isArray(pad.axes) && Array.isArray(pad.buttons);
}

function isPressed(pad, buttonIndex) {
  return Boolean(pad?.buttons?.[buttonIndex]?.pressed);
}

/** Dead-zone an axis reading, then rescale the remainder back onto [-1, 1]. */
function rescaleAxis(value) {
  const magnitude = Math.abs(value);
  if (magnitude <= GAMEPAD_DEAD_ZONE) return 0;
  const scaled = (magnitude - GAMEPAD_DEAD_ZONE) / (1 - GAMEPAD_DEAD_ZONE);
  return Math.sign(value) * scaled;
}

/**
 * Which of the buttons this game cares about are currently held down.
 * A missing pad reports nothing held, which is also the shape `mapGamepad`
 * expects as "previous" on the first poll.
 *
 * @param {Gamepad|null|undefined} pad
 * @returns {{ launch: boolean, respawn: boolean, toggleShop: boolean }}
 */
export function heldButtons(pad) {
  if (!pad) return { launch: false, respawn: false, toggleShop: false };
  return {
    launch: isPressed(pad, GAMEPAD_BUTTONS.LAUNCH),
    respawn: isPressed(pad, GAMEPAD_BUTTONS.RESPAWN),
    toggleShop: isPressed(pad, GAMEPAD_BUTTONS.TOGGLE_SHOP),
  };
}

/**
 * Map a standard-layout Gamepad snapshot to the flight intent it represents.
 *
 * Axis 0 is steer (right is positive, matching the sim's steer sign). Axis 1
 * is pitch: the browser reports pushing the stick forward as a negative
 * value, and forward means dive, which is also negative pitch — so the axis
 * is used as-is, no inversion. Buttons are press-edge only: they fire true
 * for one poll on the frame they transition from up to down, using
 * `previous` (typically last frame's `heldButtons(pad)`) to detect the edge.
 * A disconnected or absent pad reads as fully neutral.
 *
 * @param {Gamepad|null|undefined} pad
 * @param {{ launch: boolean, respawn: boolean, toggleShop: boolean }|undefined} previous
 */
export function mapGamepad(pad, previous) {
  if (!isUsablePad(pad)) {
    return { steer: 0, pitch: 0, launch: false, respawn: false, toggleShop: false };
  }

  const wasHeld = previous ?? { launch: false, respawn: false, toggleShop: false };
  const nowHeld = heldButtons(pad);

  return {
    steer: rescaleAxis(pad.axes[0] ?? 0),
    pitch: rescaleAxis(pad.axes[1] ?? 0),
    launch: nowHeld.launch && !wasHeld.launch,
    respawn: nowHeld.respawn && !wasHeld.respawn,
    toggleShop: nowHeld.toggleShop && !wasHeld.toggleShop,
  };
}

/**
 * Thin stateful wrapper over the browser Gamepad API. Takes the getter
 * injected so it can be built (and tested) without `navigator` existing.
 * Only the first connected pad reporting the 'standard' mapping is read;
 * anything else (a second pad, a non-standard layout) is ignored.
 *
 * @param {() => (Gamepad|null)[]} getGamepads
 */
export function createGamepadReader(getGamepads) {
  let previousHeld = null;

  return {
    /** Poll the tracked pad once and return its mapped intent. */
    poll() {
      // Array.from: older Chromium returns a GamepadList, which has no find().
      const pads = Array.from(getGamepads() ?? []);
      const pad = pads.find((candidate) => candidate?.connected && candidate.mapping === 'standard');

      if (!pad) {
        // The pad disconnected (or none has connected yet) - forget its held
        // buttons so a later reconnect doesn't miss the next fresh press.
        previousHeld = null;
        return mapGamepad(null, undefined);
      }

      const intent = mapGamepad(pad, previousHeld);
      previousHeld = heldButtons(pad);
      return intent;
    },
  };
}
