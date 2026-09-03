/**
 * The intent object the simulation consumes.
 *
 * Deliberately a plain, boring struct with no DOM in it: the browser fills it
 * from keyboard and mouse (`ui/input.js`), and the headless tests fill it from
 * a script. The simulation cannot tell the difference, which is the whole
 * reason the smoke test can drive the real game loop.
 */

export function createInputState() {
  return {
    /** -1 left .. 1 right */
    steer: 0,
    /** -1 dive .. 1 flare */
    pitch: 0,
    /** edge-triggered: set true to request a launch, cleared by the sim */
    launch: false,
    /** edge-triggered: set true to request a respawn at the great tree */
    respawn: false,
  };
}

export function resetEdges(input) {
  input.launch = false;
  input.respawn = false;
}
