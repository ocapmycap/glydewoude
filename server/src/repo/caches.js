/** Which caches a player has already banked. */

export function createCacheRepo(db) {
  return {
    async collectedIds(playerId, runner = db) {
      const { rows } = await runner.query(
        'SELECT cache_id FROM collected_caches WHERE player_id = $1',
        [playerId],
      );
      return new Set(rows.map((row) => row.cache_id));
    },

    /**
     * Claim a cache for a player.
     *
     * `ON CONFLICT DO NOTHING` plus the (player_id, cache_id) primary key is
     * the real double-spend guard: two identical requests racing each other
     * both reach here, and exactly one inserts a row. The other gets false and
     * its transaction rolls back without paying out.
     *
     * @returns {Promise<boolean>} whether this call was the one that claimed it
     */
    async claim({ playerId, cacheId, material, amount }, runner = db) {
      const result = await runner.query(
        `INSERT INTO collected_caches (player_id, cache_id, material, amount)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (player_id, cache_id) DO NOTHING`,
        [playerId, cacheId, material, amount],
      );
      return result.rowCount === 1;
    },
  };
}
