/**
 * The append-only ledger (§5.3).
 *
 * There is deliberately no update and no delete here. The database enforces
 * the same rule with a trigger on real PostgreSQL; this layer makes it true
 * even where that trigger cannot run.
 */

export function createTransactionRepo(db) {
  return {
    /** @param {'earn'|'spend'} type */
    async record({ playerId, type, item, amount, source, metadata = {} }, runner = db) {
      const { rows } = await runner.query(
        `INSERT INTO transactions (player_id, type, item, amount, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, player_id, type, item, amount, source, metadata, created_at`,
        [playerId, type, item, amount, source, JSON.stringify(metadata)],
      );
      return rows[0];
    },

    async listForPlayer(playerId, { limit = 50 } = {}, runner = db) {
      const { rows } = await runner.query(
        `SELECT id, type, item, amount, source, metadata, created_at
           FROM transactions
          WHERE player_id = $1
          ORDER BY id DESC
          LIMIT $2`,
        [playerId, Math.min(Math.max(limit, 1), 200)],
      );
      return rows;
    },
  };
}
