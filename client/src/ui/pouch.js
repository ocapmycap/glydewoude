/**
 * What is in the pouch, and whether the server agrees.
 *
 * The count shown is `collection.provisionalTotals()` — everything the server
 * has confirmed, plus everything still in flight to it. That is the number a
 * player expects to see the moment they land on a cache, and showing anything
 * else would make the game feel like it had dropped the pickup.
 *
 * But it is explicitly provisional, so it says so: a dot appears while
 * anything is unconfirmed, and the strip dims when the connection is gone.
 * The distinction is not pedantry — the shop spends against the *confirmed*
 * balance only (see shop-panel.js), so a player with a dot showing may find a
 * purchase refused, and the dot is the warning that explains it.
 */

const MATERIALS = [
  { key: 'acorns', label: 'acorns' },
  { key: 'bark', label: 'bark' },
  { key: 'silk', label: 'silk' },
  { key: 'berries', label: 'berries' },
];

export function createPouch(root, simulation, sync) {
  const strip = document.createElement('div');
  strip.className = 'pouch';

  const chips = new Map();
  for (const material of MATERIALS) {
    const chip = document.createElement('span');
    chip.className = 'pouch-chip';

    const count = document.createElement('span');
    count.className = 'pouch-count';
    count.textContent = '0';

    const label = document.createElement('span');
    label.className = 'pouch-label';
    label.textContent = material.label;

    chip.append(count, label);
    strip.append(chip);
    chips.set(material.key, { chip, count });
  }

  const pending = document.createElement('span');
  pending.className = 'pouch-pending';
  pending.title = 'waiting on the server';
  pending.textContent = '•';
  strip.append(pending);

  root.append(strip);

  // Only touch the DOM when a number actually moved: this runs every frame,
  // and four unconditional textContent writes per frame is four layout
  // invalidations the renderer does not need to compete with.
  let lastSignature = '';

  sync?.on((event) => {
    if (event.type === 'net:offline') strip.classList.add('pouch--offline');
    if (event.type === 'net:online') strip.classList.remove('pouch--offline');
  });

  return {
    update() {
      const totals = simulation.collection.provisionalTotals();
      const unconfirmed = simulation.collection.hasUnconfirmed;
      const signature = `${MATERIALS.map((m) => totals[m.key] ?? 0).join(',')}|${unconfirmed}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      for (const material of MATERIALS) {
        const held = totals[material.key] ?? 0;
        const { chip, count } = chips.get(material.key);
        count.textContent = String(held);
        // A material never found reads as absent rather than as a zero to
        // chase — the rare ones are meant to be a surprise (§3.3).
        chip.classList.toggle('pouch-chip--empty', held === 0);
      }
      pending.classList.toggle('pouch-pending--visible', unconfirmed);
    },
  };
}
