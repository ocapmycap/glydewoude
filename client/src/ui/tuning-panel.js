/**
 * Live glide tuning.
 *
 * Phase 1 is a go/no-go gate on feel, and the doc calls the glide loop the
 * most iterated-on system in the game (§7.3). Reloading the page to try a
 * slightly higher glide ratio wastes the tightest feedback loop available, so
 * the dials are editable while flying. Press T to show or hide.
 *
 * These are development controls, not a game feature — they mutate the local
 * tuning copy only, and nothing here persists or leaves the browser.
 */

const DIALS = [
  { key: 'baseGlideRatio', label: 'glide ratio', min: 2, max: 12, step: 0.1 },
  { key: 'baseCruiseSpeed', label: 'cruise speed', min: 6, max: 32, step: 0.5 },
  { key: 'baseTurnRate', label: 'turn rate', min: 0.4, max: 3.5, step: 0.05 },
  { key: 'turnSmoothing', label: 'turn snap', min: 1, max: 14, step: 0.25 },
  { key: 'speedResponse', label: 'speed response', min: 0.3, max: 6, step: 0.1 },
  { key: 'pitchSpeedTrade', label: 'dive/flare power', min: 0, max: 16, step: 0.5 },
  { key: 'baseSinkResponse', label: 'sink response', min: 0.5, max: 8, step: 0.1 },
  { key: 'glideEfficiencyFalloff', label: 'off-cruise penalty', min: 0, max: 1.5, step: 0.05 },
  { key: 'gravity', label: 'gravity', min: 6, max: 40, step: 0.5 },
  { key: 'launchHop', label: 'launch hop', min: 0, max: 8, step: 0.2 },
];

export function createTuningPanel(root, simulation) {
  const panel = document.createElement('div');
  panel.className = 'tuning';

  const heading = document.createElement('h2');
  heading.textContent = 'glide tuning';
  panel.append(heading);

  const defaults = { ...simulation.tuning };
  const readouts = new Map();

  for (const dial of DIALS) {
    const row = document.createElement('label');
    row.className = 'tuning-row';

    const name = document.createElement('span');
    name.className = 'tuning-label';
    name.textContent = dial.label;

    const value = document.createElement('span');
    value.className = 'tuning-value';
    value.textContent = simulation.tuning[dial.key].toFixed(2);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(dial.min);
    slider.max = String(dial.max);
    slider.step = String(dial.step);
    slider.value = String(simulation.tuning[dial.key]);
    slider.addEventListener('input', () => {
      simulation.tuning[dial.key] = Number(slider.value);
      value.textContent = Number(slider.value).toFixed(2);
      simulation.refreshProfile();
    });

    row.append(name, value, slider);
    panel.append(row);
    readouts.set(dial.key, { slider, value });
  }

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'tuning-reset';
  reset.textContent = 'reset to defaults';
  reset.addEventListener('click', () => {
    for (const dial of DIALS) {
      simulation.tuning[dial.key] = defaults[dial.key];
      const readout = readouts.get(dial.key);
      readout.slider.value = String(defaults[dial.key]);
      readout.value.textContent = defaults[dial.key].toFixed(2);
    }
    simulation.refreshProfile();
  });
  panel.append(reset);

  root.append(panel);

  let visible = false;
  return {
    toggle() {
      visible = !visible;
      panel.classList.toggle('tuning--visible', visible);
    },
    get visible() {
      return visible;
    },
  };
}
