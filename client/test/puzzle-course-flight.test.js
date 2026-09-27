/**
 * The ring-trial puzzle course, flown end to end through the real
 * `createSimulation` (LAN-581).
 *
 * Rings used to sit on the straight line between the puzzle tree's perch and
 * the target's perch. A neutral (pitch 0) glide never follows that line — it
 * arcs — so a course laid out that way cannot actually be rung by a pilot
 * holding pitch neutral with only small steering corrections, whatever
 * heading they aim along. This drives the shipped simulation exactly the way
 * a player would: perch-turn to face the first ring, launch, hold pitch
 * neutral throughout, steer gently toward each ring in turn, then toward the
 * target, and confirm the course rings in order and solves.
 */

import { describe, expect, it } from 'vitest';
import { TREE_TYPES, generateForest } from '@glidewood/shared';

import { createSimulation } from '../src/sim/simulation.js';
import { GliderPhase } from '../src/sim/glider.js';
import { FIXED_DT } from '../src/sim/loop.js';
import { createInputState } from '../src/sim/input-state.js';
import { steerTowardPoint, wrapAngle } from './helpers/autopilot.js';

function puzzleTreesOf(world) {
  return world.trees.filter((tree) => tree.type === TREE_TYPES.PUZZLE);
}

describe('puzzle course flight, end to end through the simulation', () => {
  for (const seed of [undefined, 'a', 'b', 'c']) {
    const seedLabel = seed ?? 'default';

    it(`a scripted neutral-pitch pilot rings every puzzle course in order and solves it (seed ${seedLabel})`, () => {
      const base = seed === undefined ? generateForest() : generateForest({ seed });
      const puzzles = puzzleTreesOf(base);
      expect(puzzles.length, `seed ${seedLabel}: no puzzle trees generated`).toBeGreaterThan(0);

      for (const puzzleTree of puzzles) {
        const label = `seed ${seedLabel}, tree ${puzzleTree.id}`;
        const world = { ...base, spawnTreeId: puzzleTree.id };
        const simulation = createSimulation({ world });
        const input = createInputState();

        const target = base.trees.find((tree) => tree.id === puzzleTree.course.targetTreeId);
        expect(target, label).toBeDefined();

        // Turn on the perch to face the first ring — full authority, not one
        // of the "small correction" steers the flight itself is limited to.
        const firstRing = puzzleTree.course.rings[0];
        const facingHeading = Math.atan2(
          firstRing.center.x - simulation.glider.motion.x,
          firstRing.center.z - simulation.glider.motion.z,
        );
        const maxTurnTicks = Math.ceil(20 / FIXED_DT);
        let turnTicks = 0;
        while (
          Math.abs(wrapAngle(facingHeading - simulation.glider.motion.heading)) > 0.02
          && turnTicks < maxTurnTicks
        ) {
          steerTowardPoint(input, simulation, firstRing.center, 1);
          input.pitch = 0;
          simulation.step(input, FIXED_DT);
          turnTicks += 1;
        }
        expect(turnTicks, `${label}: perch turn to face the first ring never converged`)
          .toBeLessThan(maxTurnTicks);
        input.steer = 0;

        const events = [];
        simulation.on((event) => events.push(event));

        input.launch = true;
        simulation.step(input, FIXED_DT);
        expect(simulation.glider.phase, label).toBe(GliderPhase.GLIDING);

        const { rings } = puzzleTree.course;
        const maxFlightTicks = Math.ceil(60 / FIXED_DT);
        let ticks = 0;
        while (
          (simulation.glider.phase === GliderPhase.GLIDING
            || simulation.glider.phase === GliderPhase.CLIMBING)
          && ticks < maxFlightTicks
        ) {
          const ringed = events.filter((event) => event.type === 'puzzle:ring').length;
          const aimPoint = ringed < rings.length ? rings[ringed].center : target.position;
          // Neutral pitch throughout — only small steering corrections toward
          // whichever ring (or, past the last one, the target) is next.
          steerTowardPoint(input, simulation, aimPoint, 0.35);
          input.pitch = 0;
          simulation.step(input, FIXED_DT);
          ticks += 1;
        }
        expect(ticks, `${label}: flight did not settle inside the tick budget`)
          .toBeLessThan(maxFlightTicks);

        const ringEvents = events.filter((event) => event.type === 'puzzle:ring');
        expect(ringEvents.map((event) => event.index), label)
          .toEqual(rings.map((_, index) => index));

        expect(events.some((event) => event.type === 'puzzle:solved'), label).toBe(true);
      }
    });
  }
});
