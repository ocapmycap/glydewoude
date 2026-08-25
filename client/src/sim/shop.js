/**
 * The shop counter.
 *
 * A shop tree is where materials turn into glide. What this module must not do
 * is decide the exchange rate: product doc §6.1 and D-25 put the catalogue and
 * every price on the server, so a purchase here is an *intent* — "I would like
 * the next tier of `distance`" — and the server answers with what it cost and
 * what the player now has. A client that knew the price list would be at best
 * redundant and at worst a thing to be edited.
 *
 * It is the same discipline as collection.js, one step further along.
 * Collection intents say "I picked this up"; purchase intents say "I would
 * like to spend". Neither is ever a balance, and nothing in here holds one.
 *
 * Being perched at the shop is part of the claim. D-27 anchors a collection to
 * a position the server can recompute; a purchase carries the tree it was made
 * at for the same reason — buying a tier from mid-air, or from the spawn perch
 * on the other side of the forest, is not something the server should have to
 * take on trust.
 *
 * Pure JS: no DOM, no clock, no transport. Time arrives as the simulation's own
 * elapsed seconds, so a replay produces identical intents.
 */

/**
 * @typedef {object} PurchaseIntent
 * @property {number} seq         per-run ordering, so a server can sequence them
 * @property {string} upgradeKey  a key from the server's catalogue, e.g. 'distance'
 * @property {string} treeId      the shop it was asked for at
 * @property {number} atTime      simulation seconds when it happened
 * @property {{x:number,y:number,z:number}} atPosition  the perch, for anchoring
 */

export function createShopLedger() {
  /** The shop currently underfoot, or null. Set by landing, cleared by leaving. */
  let openTree = null;
  /** @type {PurchaseIntent[]} */
  let pending = [];
  let seq = 0;

  /**
   * The registry handler. Opening a shop is exactly "landing on a shop tree" —
   * there is no separate interact key, because the landing is the thing the
   * player already had to earn.
   */
  const interaction = {
    onLand({ tree, emit }) {
      openTree = tree;
      emit({ type: 'shop:opened', tree, name: tree.name ?? 'A quiet counter' });
    },
    onLeave({ tree, emit }) {
      openTree = null;
      emit({ type: 'shop:closed', tree });
    },
  };

  return {
    interaction,

    /** The shop tree the squirrel is perched on, or null. */
    get openTree() {
      return openTree;
    },

    get isOpen() {
      return openTree !== null;
    },

    /**
     * Ask to buy the next tier of an upgrade.
     *
     * Returns null rather than throwing when there is no shop open: a UI that
     * fires a stale button press after the player has launched should be a
     * no-op, not a crash in the glide loop.
     *
     * @returns {PurchaseIntent|null} the intent raised. Callers should emit it.
     */
    requestPurchase(upgradeKey, { atTime = 0 } = {}) {
      if (!openTree || !upgradeKey) return null;

      seq += 1;
      const intent = {
        seq,
        upgradeKey,
        treeId: openTree.id,
        atTime,
        atPosition: {
          x: openTree.position.x,
          y: openTree.perchY,
          z: openTree.position.z,
        },
      };
      pending.push(intent);
      return intent;
    },

    /** Intents awaiting a verdict. A future transport drains these. */
    get pending() {
      return [...pending];
    },

    /** True while a purchase is unanswered, so the UI can disable the button. */
    get hasUnconfirmed() {
      return pending.length > 0;
    },

    /**
     * Drop intents the server has answered.
     *
     * Accepted or refused, an intent leaves the queue the same way, which is
     * why there is one method here and two in collection.js. Nothing local was
     * spent or granted — the stats and the balance both live on the server —
     * so there is no local state to commit on success or roll back on failure.
     * A refused purchase can simply be asked for again.
     */
    settle(seqs) {
      const answered = new Set(seqs);
      pending = pending.filter((intent) => !answered.has(intent.seq));
    },

    /** Start-of-run state, for respawns that should reset progress. */
    reset() {
      openTree = null;
      pending = [];
      seq = 0;
    },
  };
}
