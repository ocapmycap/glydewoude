/**
 * Applying a server player snapshot to the running simulation.
 *
 * A purchase (and the initial restore) comes back from the server as the whole
 * player: its glide tiers and its material balance. This folds that snapshot
 * into the live game — the tiers change the glide immediately, and the balance
 * replaces the ledger's confirmed total, which is the only number a player is
 * ever allowed to spend against (§6.1).
 *
 * DOM-free on purpose, so it is exercised by the headless tests rather than
 * only through the shop panel. The world seed is deliberately not touched: it
 * is fixed for the run at boot, and only the tiers and balance move.
 */

/**
 * @param {object} simulation  a createSimulation() instance
 * @param {object|null} player  a public player snapshot from the server
 */
export function applyUpgrade(simulation, player) {
  if (!player) return;

  if (player.glideStats) {
    // stats is the mutable object the profile is derived from; mutate it in
    // place and re-derive, exactly as the tuning panel does for its dials.
    Object.assign(simulation.stats, player.glideStats);
    simulation.refreshProfile();
  }

  if (player.materials) {
    // An empty seq list settles nothing in flight — it just writes the
    // server's authoritative balance in, replacing whatever we had.
    simulation.collection.settle([], player.materials);
  }
}
