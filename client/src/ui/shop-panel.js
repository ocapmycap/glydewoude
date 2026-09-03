/**
 * The shop counter, on screen.
 *
 * Everything shown here came from the server. The prices, the tiers, what is
 * affordable — none of it is computed locally, because §6.1 and D-25 put all
 * of it server-side and a client that recomputed a price would only be a
 * second opinion nobody asked for. This module renders `GET /api/shop/catalog`
 * and turns a click into `simulation.requestPurchase(key)`. That is its whole
 * job.
 *
 * The one piece of real interface design in here is the pointer lock. Mouse
 * steering holds the pointer captive, and a captured pointer cannot click a
 * button — so landing on a shop releases it. The player is perched, not
 * flying, and a released pointer is what "you have arrived somewhere" should
 * feel like. Clicking the canvas again takes it back. Digit keys buy the row
 * at that position, for anyone who would rather not reach for the mouse.
 */

const MATERIAL_ORDER = ['acorns', 'bark', 'silk', 'berries'];

/** '12 acorns · 8 bark', in a stable order so the eye can compare two rows. */
function formatPrice(price) {
  if (!price) return 'owned outright';
  return MATERIAL_ORDER.filter((material) => price[material] > 0)
    .map((material) => `${price[material]} ${material}`)
    .join(' · ');
}

/** Reasons the server gives, in words a player would use. */
function refusalText(error, missing) {
  if (error === 'insufficient_materials') {
    const short = missing
      ? MATERIAL_ORDER.filter((material) => missing[material] > 0)
        .map((material) => `${missing[material]} more ${material}`)
        .join(' and ')
      : 'more materials';
    return `Not yet — you need ${short}.`;
  }
  if (error === 'max_tier') return 'That one is already at its best.';
  if (error === 'tier_changed') return 'That price moved. Try again.';
  if (error === 'rate_limited') return 'Slow down a moment.';
  if (error === 'offline') return 'No connection to the forest.';
  return 'The counter turned that down.';
}

export function createShopPanel(root, simulation, sync) {
  const panel = document.createElement('div');
  panel.className = 'shop';

  const heading = document.createElement('h2');
  const list = document.createElement('div');
  list.className = 'shop-list';
  const status = document.createElement('p');
  status.className = 'shop-status';
  panel.append(heading, list, status);
  root.append(panel);

  /** @type {Array<object>} the server's catalogue, empty until it arrives */
  let upgrades = [];
  /** Server-confirmed materials. Never the provisional tally — you cannot
   *  spend materials the server has not yet agreed you have. */
  let materials = {};
  let statusText = '';
  let open = false;

  function affordable(price) {
    if (!price) return false;
    return Object.entries(price).every(([material, cost]) => (materials[material] ?? 0) >= cost);
  }

  function buy(upgrade) {
    if (!upgrade?.nextPrice) return;
    simulation.requestPurchase(upgrade.key);
    statusText = `Asking for ${upgrade.label.toLowerCase()}…`;
    render();
  }

  function render() {
    panel.classList.toggle('shop--visible', open);
    if (!open) return;

    heading.textContent = simulation.shop.openTree?.name ?? 'a quiet counter';
    list.replaceChildren();

    if (upgrades.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'shop-empty';
      empty.textContent = sync?.isOnline === false
        ? 'The shelves are dark — no connection.'
        : 'Looking over the shelves…';
      list.append(empty);
    }

    upgrades.forEach((upgrade, index) => {
      const row = document.createElement('div');
      row.className = 'shop-row';

      const label = document.createElement('span');
      label.className = 'shop-label';
      label.textContent = upgrade.label;

      const tier = document.createElement('span');
      tier.className = 'shop-tier';
      tier.textContent = `${upgrade.currentTier} / ${upgrade.maxTier}`;

      const price = document.createElement('span');
      price.className = 'shop-price';
      price.textContent = formatPrice(upgrade.nextPrice);

      const button = document.createElement('button');
      button.className = 'shop-buy';
      button.type = 'button';
      // The digit is shown because it is also the shortcut, and a shortcut
      // nobody can see is one nobody uses.
      button.textContent = upgrade.nextPrice ? `buy ${index + 1}` : 'maxed';
      button.disabled = !upgrade.nextPrice
        || !affordable(upgrade.nextPrice)
        || simulation.shop.hasUnconfirmed;
      button.addEventListener('click', () => buy(upgrade));

      row.append(label, tier, price, button);
      list.append(row);
    });

    status.textContent = statusText;
  }

  function onKeyDown(event) {
    if (!open || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    const index = Number.parseInt(event.key, 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= upgrades.length) return;
    const upgrade = upgrades[index];
    if (!upgrade.nextPrice || !affordable(upgrade.nextPrice)) return;
    event.preventDefault();
    buy(upgrade);
  }

  simulation.on((event) => {
    if (event.type === 'shop:opened') {
      open = true;
      // Hand the pointer back so the player can actually press something.
      if (document.pointerLockElement) document.exitPointerLock();
      // Prices are per-player and may have moved; sync refetches on open, so
      // clear the old ones rather than showing a stale price to click.
      upgrades = [];
      statusText = '';
      render();
    }
    if (event.type === 'shop:closed' || event.type === 'glide:respawned') {
      open = false;
      render();
    }
  });

  sync?.on((event) => {
    if (event.type === 'net:catalog') {
      upgrades = event.upgrades;
      render();
    }
    if (event.type === 'net:catalog-failed') {
      statusText = 'Could not read the shelves.';
      render();
    }
    if (event.type === 'net:player') {
      materials = event.player.materials ?? {};
      render();
    }
    if (event.type === 'net:purchased') {
      statusText = `Bought — now tier ${event.purchased.tier}.`;
      render();
    }
    if (event.type === 'net:purchase-refused') {
      statusText = refusalText(event.error, event.missing);
      render();
    }
    if (event.type === 'net:offline' || event.type === 'net:online') render();
  });

  window.addEventListener('keydown', onKeyDown);
  render();

  return {
    get isOpen() {
      return open;
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      panel.remove();
    },
  };
}
