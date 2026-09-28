/**
 * Chase camera.
 *
 * Steering is camera-relative (§2.2), which here means the camera sits behind
 * the squirrel's heading and the player's "left" is always the squirrel's
 * left. The camera lags deliberately: the drift as you come out of a turn is a
 * large part of why a glide reads as fast.
 */

import { MathUtils, Vector3 } from 'three';

const PERCHED = { distance: 7.5, height: 3.2, lookAhead: 6, stiffness: 6 };
const GLIDING = { distance: 9, height: 2.9, lookAhead: 14, stiffness: 3.4 };

/**
 * Clinging, the squirrel faces the trunk, so "behind it" is inside the bark.
 * Instead the camera swings `side` metres out to the squirrel's side, `out`
 * metres clear of the bark, and looks `lookAhead` metres along the launch
 * line (straight away from the trunk) and down toward the drop. Kept short of
 * a full look down the launch line so the squirrel stays in frame (D-68).
 */
const CLINGING = { side: 8, out: 1, height: 3, lookAhead: 4, lookDrop: 2.5, stiffness: 4 };

/**
 * Swinging round into the cling view uses a softer spring than holding it,
 * so the move reads as a calm settle rather than a jolt (D-71). 2.3/s covers
 * 95% of the swing in about 1.3 s (ln 20 / 2.3); after `seconds` the camera
 * tracks at `CLINGING.stiffness` again so a settled view doesn't drift.
 */
const CLING_ENTRY = Object.freeze({ stiffness: 2.3, seconds: 1.3 });

/**
 * Where the camera aims is eased only across a change into or out of the
 * cling view, where the aim point flips from ahead of the squirrel to behind
 * and below it. It is held as an offset from the squirrel so the aim never
 * lags a moving squirrel, and snaps back to exact once within `settled`
 * metres, leaving perched and gliding framing exactly as before (D-71).
 */
const LOOK_EASE = Object.freeze({ settled: 0.05 });

export function createFollowCamera(camera) {
  const desired = new Vector3();
  const lookTarget = new Vector3();
  const desiredLook = new Vector3();
  // The aim point relative to the squirrel, eased while `lookEasing`.
  const lookOffset = new Vector3();
  let initialised = false;
  let lastPhase = null;
  let clingEntryAge = Infinity;
  let lookEasing = false;

  return {
    /**
     * @param {{x:number,y:number,z:number,heading:number,speed:number}} motion
     * @param {'perched'|'gliding'|'clinging'|'climbing'} phase the glider's phase
     * @param {number} dt
     */
    update(motion, phase, dt) {
      const gliding = phase === 'gliding';
      // A trunk climb (LAN-571) is the same side-on view as a cling — both
      // are the squirrel facing bark, not a branch ahead of it.
      const clinging = phase === 'clinging' || phase === 'climbing';
      const rig = clinging ? CLINGING : gliding ? GLIDING : PERCHED;
      const forwardX = Math.sin(motion.heading);
      const forwardZ = Math.cos(motion.heading);

      if (clinging) {
        // The launch turns the heading by π, so away from the trunk is
        // -forward, and the squirrel's right is (-cos h, sin h) as ever.
        desired.set(
          motion.x - forwardX * rig.out - Math.cos(motion.heading) * rig.side,
          motion.y + rig.height,
          motion.z - forwardZ * rig.out + Math.sin(motion.heading) * rig.side,
        );
      } else {
        // Faster flight pushes the camera back — cheap, effective speed cue.
        const pullback = rig.distance * (1 + motion.speed / 90);
        desired.set(
          motion.x - forwardX * pullback,
          motion.y + rig.height,
          motion.z - forwardZ * pullback,
        );
      }

      const lastWasSideView = lastPhase === 'clinging' || lastPhase === 'climbing';
      if (initialised && phase !== lastPhase) {
        if (clinging) clingEntryAge = 0;
        if (clinging || lastWasSideView) lookEasing = true;
      }
      const entering = clinging && clingEntryAge < CLING_ENTRY.seconds;
      const stiffness = entering ? CLING_ENTRY.stiffness : rig.stiffness;
      const alpha = 1 - Math.exp(-stiffness * dt);
      clingEntryAge += dt;
      lastPhase = phase;

      if (!initialised) {
        camera.position.copy(desired);
      } else {
        camera.position.lerp(desired, alpha);
      }

      // Never let the camera clip through the forest floor.
      camera.position.y = Math.max(camera.position.y, 1.5);

      if (clinging) {
        desiredLook.set(
          -forwardX * rig.lookAhead,
          -rig.lookDrop,
          -forwardZ * rig.lookAhead,
        );
      } else {
        desiredLook.set(
          forwardX * rig.lookAhead,
          MathUtils.lerp(0.5, -1.5, gliding ? 1 : 0),
          forwardZ * rig.lookAhead,
        );
      }

      if (!initialised || !lookEasing) {
        lookOffset.copy(desiredLook);
        lookEasing = false;
      } else {
        lookOffset.lerp(desiredLook, alpha);
        if (lookOffset.distanceTo(desiredLook) < LOOK_EASE.settled) {
          lookOffset.copy(desiredLook);
          lookEasing = false;
        }
      }
      initialised = true;

      lookTarget.set(motion.x, motion.y, motion.z).add(lookOffset);
      camera.lookAt(lookTarget);
    },

    /** Snap on respawn instead of sweeping across the whole forest. */
    reset() {
      initialised = false;
      clingEntryAge = Infinity;
      lookEasing = false;
    },
  };
}
