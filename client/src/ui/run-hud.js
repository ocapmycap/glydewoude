/**
 * The run HUD: the current chain, the running score, and your best.
 *
 * Kept apart from `hud.js` on purpose. That panel is flight instruments and
 * changes when the physics does; this is game state and changes when run mode
 * does.
 *
 * It only listens. The score arrives on `run:extended` as `points` and the
 * total on `event.run`, so this module never does run arithmetic and can never
 * disagree with the simulation (D-31). The best comes from the run sync, which
 * holds the server's authoritative copy when there is one (D-32).
 *
 * The moment that matters is the run ending, so the final score holds on
 * screen in a larger card and says plainly whether it beat the best (D-34).
 */

import { isBankable } from '@glidewood/shared';

const END_CARD_MS = 4000;

function stat(parent, label) {
  const cell = document.createElement('div');
  cell.className = 'run-hud-stat';
  const value = document.createElement('span');
  value.className = 'run-hud-value';
  value.textContent = '—';
  const name = document.createElement('span');
  name.className = 'run-hud-label';
  name.textContent = label;
  cell.append(value, name);
  parent.append(cell);
  return value;
}

const whole = (score) => Math.round(score).toLocaleString();

/**
 * @param {HTMLElement} root
 * @param {object} deps
 * @param {{on:Function}} deps.simulation  from createSimulation()
 * @param {{best:?{score:number}, onBest:Function}} deps.runSync  from createRunSync()
 */
export function createRunHud(root, { simulation, runSync }) {
  const panel = document.createElement('div');
  panel.className = 'run-hud';
  const chain = stat(panel, 'chain');
  const score = stat(panel, 'score');
  const best = stat(panel, 'best');
  root.append(panel);

  const card = document.createElement('div');
  card.className = 'run-end';
  const cardTitle = document.createElement('div');
  cardTitle.className = 'run-end-title';
  const cardScore = document.createElement('div');
  cardScore.className = 'run-end-score';
  const cardVerdict = document.createElement('div');
  cardVerdict.className = 'run-end-verdict';
  card.append(cardTitle, cardScore, cardVerdict);
  root.append(card);
  let cardTimer = null;

  // Offline the sync never learns a best, but a session still has one — it
  // just does not survive a reload (run-mode-tasks.md, T5). So the HUD keeps
  // the higher of the two.
  let sessionBest = 0;
  const bestScore = () => Math.max(runSync.best?.score ?? 0, sessionBest);

  function showBest() {
    const value = bestScore();
    best.textContent = value > 0 ? whole(value) : '—';
  }

  function showRun(run) {
    chain.textContent = String(run.chain);
    score.textContent = whole(run.score);
  }

  function showEnd(run, reason, beaten, previous) {
    cardTitle.textContent = reason === 'respawn' ? 'home again' : 'run over';
    cardScore.textContent = `${whole(run.score)} · chain of ${run.chain}`;
    cardVerdict.textContent = beaten
      ? previous > 0 ? `new best! (was ${whole(previous)})` : 'first best!'
      : `best is still ${whole(previous)}`;
    card.dataset.beaten = String(beaten);
    card.classList.add('run-end--visible');
    clearTimeout(cardTimer);
    cardTimer = setTimeout(() => card.classList.remove('run-end--visible'), END_CARD_MS);
  }

  simulation.on((event) => {
    if (event.type === 'run:started') {
      showRun(event.run);
      panel.classList.add('run-hud--live');
    } else if (event.type === 'run:extended') {
      showRun(event.run);
    } else if (event.type === 'run:ended') {
      showRun(event.run);
      panel.classList.remove('run-hud--live');
      // A run below minChainToBank is not a run (RUN_TUNING), so it neither
      // earns the card nor counts as a best — same rule the sync applies.
      if (!isBankable(event.run)) return;
      const previous = bestScore();
      const beaten = event.run.score > previous;
      if (beaten) sessionBest = event.run.score;
      showBest();
      showEnd(event.run, event.reason, beaten, previous);
    }
  });

  // The server's reply lands after `run:ended`; it can only raise the best.
  runSync.onBest(showBest);
  showBest();
}
