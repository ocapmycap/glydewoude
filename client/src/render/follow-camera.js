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

export function createFollowCamera(camera) {
  const desired = new Vector3();
  const lookTarget = new Vector3();
  let initialised = false;

  return {
    /**
     * @param {{x:number,y:number,z:number,heading:number,speed:number}} motion
     * @param {boolean} gliding
     * @param {number} dt
     */
    update(motion, gliding, dt) {
      const rig = gliding ? GLIDING : PERCHED;
      const forwardX = Math.sin(motion.heading);
      const forwardZ = Math.cos(motion.heading);

      // Faster flight pushes the camera back — cheap, effective speed cue.
      const pullback = rig.distance * (1 + motion.speed / 90);

      desired.set(
        motion.x - forwardX * pullback,
        motion.y + rig.height,
        motion.z - forwardZ * pullback,
      );

      if (!initialised) {
        camera.position.copy(desired);
        initialised = true;
      } else {
        const alpha = 1 - Math.exp(-rig.stiffness * dt);
        camera.position.lerp(desired, alpha);
      }

      // Never let the camera clip through the forest floor.
      camera.position.y = Math.max(camera.position.y, 1.5);

      lookTarget.set(
        motion.x + forwardX * rig.lookAhead,
        motion.y + MathUtils.lerp(0.5, -1.5, gliding ? 1 : 0),
        motion.z + forwardZ * rig.lookAhead,
      );
      camera.lookAt(lookTarget);
    },

    /** Snap on respawn instead of sweeping across the whole forest. */
    reset() {
      initialised = false;
    },
  };
}
