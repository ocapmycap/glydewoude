/**
 * The heads-up display.
 *
 * Phase 1's question is "does the glide feel good", and you cannot answer that
 * from vibes alone — you need to see what the glide is doing while you fly it.
 * So the HUD shows the physics honestly: speed, altitude, the glide ratio you
 * are actually achieving right now, and how far the last glide carried you.
 */

import { effectiveGlideRatio } from '@glidewood/shared';

const TOAST_SECONDS = 3.2;

function field(parent, label) {
  const row = document.createElement('div');
  row.className = 'hud-row';
  const name = document.createElement('span');
  name.className = 'hud-label';
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'hud-value';
  value.textContent = '—';
  row.append(name, value);
  parent.append(row);
  return value;
}

export function createHud(root, simulation) {
  const panel = document.createElement('div');
  panel.className = 'hud';
  root.append(panel);

  const perch = field(panel, 'perch');
  const speed = field(panel, 'speed');
  const altitude = field(panel, 'altitude');
  const ratio = field(panel, 'glide ratio');
  const range = field(panel, 'range left');
  const lastGlide = field(panel, 'last glide');

  const toast = document.createElement('div');
  toast.className = 'toast';
  root.append(toast);
  let toastTimer = 0;

  simulation.on((event) => {
    if (event.type === 'landmark:arrived') {
      toast.textContent = event.name;
      toast.classList.add('toast--visible');
      toastTimer = TOAST_SECONDS;
    }
  });

  return {
    update(dt) {
      const { glider, profile, world } = simulation;
      const { motion } = glider;
      const gliding = glider.phase === 'gliding';

      const tree = glider.treeId
        ? world.trees.find((candidate) => candidate.id === glider.treeId)
        : null;
      perch.textContent = gliding ? 'airborne' : (tree?.name ?? 'a quiet branch');

      speed.textContent = `${motion.speed.toFixed(1)} m/s`;
      altitude.textContent = `${Math.max(0, motion.y).toFixed(1)} m`;
      ratio.textContent = gliding
        ? `${effectiveGlideRatio(motion.speed, profile, simulation.tuning).toFixed(2)} : 1`
        : `${profile.glideRatio.toFixed(2)} : 1`;
      range.textContent = `${simulation.remainingRange().toFixed(0)} m`;
      lastGlide.textContent = glider.glide
        ? `${glider.glide.distance.toFixed(0)} m in ${glider.glide.duration.toFixed(1)} s`
        : '—';

      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) toast.classList.remove('toast--visible');
      }
    },
  };
}
