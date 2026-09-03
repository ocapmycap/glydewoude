/**
 * The upgrade shop.
 *
 * The client is not the authority on price or balance — the server is (§6.1).
 * So this panel does not know what anything costs until it asks: it reads the
 * catalogue from `GET /api/shop/catalog`, sends a purchase *intent* to
 * `POST /api/shop/purchase`, and shows whatever the server says came back. It
 * never debits a balance locally.
 *
 * Press B to show or hide. Offline it says so and offers nothing — there is no
 * authority to buy from.
 */

import { MATERIAL_TYPES } from '@glidewood/shared';

import { applyUpgrade } from '../net/apply-upgrade.js';

const MATERIAL_LABEL = Object.freeze({
  [MATERIAL_TYPES.ACORNS]: 'acorns',
  [MATERIAL_TYPES.BARK]: 'bark',
  [MATERIAL_TYPES.SILK]: 'silk',
  [MATERIAL_TYPES.BERRIES]: 'berries',
});
const MATERIAL_ORDER = Object.freeze(Object.keys(MATERIAL_LABEL));

/** Server reasons turned into something a player can read. */
const PURCHASE_ERRORS = Object.freeze({
  insufficient_materials: 'not enough materials yet',
  max_tier: 'already at the top tier',
  tier_changed: 'prices moved — have another look',
  rate_limited: 'one moment, then try again',
  unauthorized: 'session expired',
  offline: 'the shop is offline',
});

function priceText(price) {
  return Object.entries(price)
    .map(([material, amount]) => `${amount} ${MATERIAL_LABEL[material] ?? material}`)
    .join(' · ');
}

export function createShop(root, { session, simulation }) {
  const panel = document.createElement('div');
  panel.className = 'shop';

  const heading = document.createElement('h2');
  heading.textContent = 'upgrades';
  panel.append(heading);

  const balance = document.createElement('div');
  balance.className = 'shop-balance';
  panel.append(balance);

  const list = document.createElement('div');
  list.className = 'shop-list';
  panel.append(list);

  const message = document.createElement('p');
  message.className = 'shop-message';
  panel.append(message);

  root.append(panel);

  let visible = false;
  let upgrades = [];

  const confirmed = () => simulation.collection.confirmed;

  function setMessage(text, tone = '') {
    message.textContent = text ?? '';
    message.dataset.tone = tone;
  }

  function canAfford(price) {
    const held = confirmed();
    return Object.entries(price).every(([material, amount]) => (held[material] ?? 0) >= amount);
  }

  function renderBalance() {
    const held = confirmed();
    balance.textContent = MATERIAL_ORDER.map(
      (material) => `${held[material] ?? 0} ${MATERIAL_LABEL[material]}`,
    ).join('  ·  ');
  }

  function render() {
    renderBalance();
    list.replaceChildren();

    for (const upgrade of upgrades) {
      const row = document.createElement('div');
      row.className = 'shop-row';

      const info = document.createElement('div');
      info.className = 'shop-info';
      const name = document.createElement('span');
      name.className = 'shop-name';
      name.textContent = upgrade.label;
      const tier = document.createElement('span');
      tier.className = 'shop-tier';
      tier.textContent = `tier ${upgrade.currentTier} / ${upgrade.maxTier}`;
      info.append(name, tier);

      const action = document.createElement('div');
      action.className = 'shop-action';

      if (!upgrade.nextPrice) {
        const maxed = document.createElement('span');
        maxed.className = 'shop-maxed';
        maxed.textContent = 'maxed';
        action.append(maxed);
      } else {
        const price = document.createElement('span');
        price.className = 'shop-price';
        price.textContent = priceText(upgrade.nextPrice);

        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'shop-buy';
        buy.textContent = 'buy';
        buy.disabled = !canAfford(upgrade.nextPrice);
        buy.addEventListener('click', () => purchase(upgrade.key));

        action.append(price, buy);
      }

      row.append(info, action);
      list.append(row);
    }
  }

  async function loadCatalogue() {
    setMessage('loading…');
    const result = await session.request('/api/shop/catalog');
    if (!result.ok) {
      upgrades = [];
      list.replaceChildren();
      setMessage('could not reach the shop', 'error');
      return;
    }
    upgrades = result.data?.upgrades ?? [];
    setMessage('');
    render();
  }

  async function purchase(key) {
    setMessage('');
    const result = await session.request('/api/shop/purchase', {
      method: 'POST',
      body: { upgrade: key },
    });

    if (result.ok) {
      // The server's snapshot is the truth: it moves the tier and the balance.
      applyUpgrade(simulation, result.data.player);
      // Tiers and prices have shifted, so re-read rather than patch by hand.
      await loadCatalogue();
      setMessage('upgraded', 'ok');
      return;
    }

    setMessage(PURCHASE_ERRORS[result.error] ?? 'the purchase did not go through', 'error');
    // A stale catalogue is the likely cause of tier_changed — refresh it.
    if (result.error === 'tier_changed') await loadCatalogue();
  }

  return {
    toggle() {
      visible = !visible;
      panel.classList.toggle('shop--visible', visible);
      if (!visible) return;

      if (!session.online) {
        upgrades = [];
        list.replaceChildren();
        balance.textContent = '';
        setMessage('the shop is only open online', 'error');
        return;
      }
      loadCatalogue();
    },
    get visible() {
      return visible;
    },
  };
}
