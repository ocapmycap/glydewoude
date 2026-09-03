/**
 * Browser input -> the simulation's intent object.
 *
 * This is the only place in the client that listens to the keyboard or mouse.
 * It writes into the same plain `InputState` struct the headless tests fill in
 * by hand, so the simulation never learns whether a human or a test is flying.
 *
 * Controls (§2.2 asks for mouse-look or arrow keys; both are wired):
 *   A / D / left / right   steer
 *   W / S / up / down      dive / flare
 *   mouse (after clicking) steer and pitch, via pointer lock
 *   space                  launch
 *   R                      return to the great tree
 */

const STEER_KEYS = { KeyA: -1, ArrowLeft: -1, KeyD: 1, ArrowRight: 1 };
const PITCH_KEYS = { KeyW: -1, ArrowUp: -1, KeyS: 1, ArrowDown: 1 };

const MOUSE_SENSITIVITY = 0.0075;
/** How fast mouse steering recentres when the hand stops moving (1/s). */
const MOUSE_DECAY = 3.5;

export function createInputBindings(input, canvas, { onToggleTuning, onToggleShop } = {}) {
  const held = new Set();
  let mouseSteer = 0;
  let mousePitch = 0;
  let pointerLocked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    if (event.code === 'Space') {
      input.launch = true;
      event.preventDefault();
    }
    if (event.code === 'KeyR') input.respawn = true;
    if (event.code === 'KeyT') onToggleTuning?.();
    if (event.code === 'KeyB') onToggleShop?.();
    if (event.code === 'Escape' && pointerLocked) document.exitPointerLock();
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

      if (pointerLocked) {
        const decay = Math.exp(-MOUSE_DECAY * dt);
        mouseSteer *= decay;
        mousePitch *= decay;
        // Keys win when both are active, so the keyboard always feels precise.
        if (steer === 0) steer = mouseSteer;
        if (pitch === 0) pitch = mousePitch;
      }

      input.steer = clamp(steer, -1, 1);
      input.pitch = clamp(pitch, -1, 1);
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
