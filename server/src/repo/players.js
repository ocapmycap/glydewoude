/**
 * Player persistence.
 *
 * Every query is parameterised. Nothing in here interpolates caller input into
 * SQL, and there is no function that updates or deletes a transaction row —
 * the append-only rule is a property of the code as well as of the trigger.
 */

import { emptyMaterialTotals } from '@glidewood/shared';

const STAT_COLUMNS = Object.freeze({
  distance: 'stat_distance',
  agility: 'stat_agility',
  flapCharges: 'stat_flap_charges',
  fallControl: 'stat_fall_control',
});

const PLAYER_COLUMNS = `
  id, display_name, world_seed, created_at, updated_at,
  stat_distance, stat_agility, stat_flap_charges, stat_fall_control,
  currency_soft, currency_hard, inventory_cosmetics, equipped_cosmetics,
  last_position, last_position_at,
  best_run_score, best_run_chain, best_run_distance, best_run_at
`;

/** The best-run columns as the API presents them. */
function toBestRun(row) {
  return {
    score: row.best_run_score ?? 0,
    chain: row.best_run_chain ?? 0,
    distance: row.best_run_distance ?? 0,
    recordedAt: row.best_run_at ?? null,
  };
}

/** Database row -> the shape the API and the shared physics both expect. */
export function toPlayer(row, materials = emptyMaterialTotals()) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    worldSeed: row.world_seed,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    glideStats: {
      distance: row.stat_distance,
      agility: row.stat_agility,
      flapCharges: row.stat_flap_charges,
      fallControl: row.stat_fall_control,
    },
    materials: { ...emptyMaterialTotals(), ...materials },
    currencySoft: row.currency_soft,
    currencyHard: row.currency_hard,
    inventoryCosmetics: row.inventory_cosmetics ?? [],
    equippedCosmetics: row.equipped_cosmetics ?? {},
    lastPosition: row.last_position ?? null,
    lastPositionAt: row.last_position_at ?? null,
    bestRun: toBestRun(row),
  };
}

export function createPlayerRepo(db) {
  async function materialsFor(playerId, runner = db) {
    const { rows } = await runner.query(
      'SELECT material, amount FROM player_materials WHERE player_id = $1',
      [playerId],
    );
    return Object.fromEntries(rows.map((row) => [row.material, row.amount]));
  }

  return {
    materialsFor,

    async create({ id, displayName, worldSeed }, runner = db) {
      const { rows } = await runner.query(
        `INSERT INTO players (id, display_name, world_seed)
         VALUES ($1, $2, $3)
         RETURNING ${PLAYER_COLUMNS}`,
        [id, displayName, worldSeed],
      );
      return toPlayer(rows[0]);
    },

    async findById(id, runner = db) {
      const { rows } = await runner.query(
        `SELECT ${PLAYER_COLUMNS} FROM players WHERE id = $1`,
        [id],
      );
      if (!rows[0]) return null;
      return toPlayer(rows[0], await materialsFor(id, runner));
    },

    /**
     * Position is client-reported and low stakes (§6.1), but it anchors the
     * plausibility check, so it is only ever written from a validated event or
     * an explicit save — never inferred.
     */
    async savePosition(playerId, position, at, runner = db) {
      await runner.query(
        `UPDATE players
            SET last_position = $2, last_position_at = $3, updated_at = now()
          WHERE id = $1`,
        [playerId, JSON.stringify(position), at],
      );
    },

    /** The player's best run, or null if there is no such player. */
    async bestRunFor(playerId, runner = db) {
      const { rows } = await runner.query(
        `SELECT best_run_score, best_run_chain, best_run_distance, best_run_at
           FROM players WHERE id = $1`,
        [playerId],
      );
      return rows[0] ? toBestRun(rows[0]) : null;
    },

    /**
     * Store a run, but only if it beats the one already there.
     *
     * The `best_run_score < $2` is the same trick as `debitMaterial`'s
     * `amount >= $3`: one conditional statement instead of read-then-write, so
     * two runs finishing at once cannot both win and the lower of the two
     * cannot land second and overwrite the higher. A replayed request is the
     * same case — it ties its own stored score, the WHERE fails, and nothing
     * moves.
     *
     * The score is the only thing compared. Chain and distance travel with it
     * so that the stored best is one run rather than a per-column high score
     * assembled from three different flights.
     *
     * @returns {Promise<boolean>} whether this run became the new best
     */
    async recordBestRun(playerId, { score, chain, distance }, at, runner = db) {
      const result = await runner.query(
        // Cast, for the same reason `debitMaterial` casts: a driver may bind
        // these as text, and a text comparison orders "9" above "10".
        `UPDATE players
            SET best_run_score = $2::int,
                best_run_chain = $3::int,
                best_run_distance = $4::int,
                best_run_at = $5,
                updated_at = now()
          WHERE id = $1 AND best_run_score < $2::int`,
        [playerId, score, chain, distance, at],
      );
      return result.rowCount === 1;
    },

    /** Add to a material balance, creating the row on first sight. */
    async creditMaterial(playerId, material, amount, runner = db) {
      await runner.query(
        `INSERT INTO player_materials (player_id, material, amount)
         VALUES ($1, $2, $3::int)
         ON CONFLICT (player_id, material)
         DO UPDATE SET amount = player_materials.amount + EXCLUDED.amount`,
        [playerId, material, amount],
      );
    },

    /**
     * Subtract from a balance, but only if it covers the cost.
     *
     * The `amount >= $3` in the WHERE clause is what makes this safe without
     * locking: two concurrent purchases cannot both pass, because the second
     * one's UPDATE matches no rows and we roll the whole thing back. A
     * read-then-write would happily let both through.
     *
     * @returns {Promise<boolean>} whether the debit applied
     */
    async debitMaterial(playerId, material, amount, runner = db) {
      const result = await runner.query(
        // The casts are explicit because a driver may bind these as text,
        // and `amount - '12'` is not portable arithmetic.
        `UPDATE player_materials
            SET amount = amount - $3::int
          WHERE player_id = $1 AND material = $2 AND amount >= $3::int`,
        [playerId, material, amount],
      );
      return result.rowCount === 1;
    },

    /** Raise one upgrade tier, guarding against a concurrent double-buy. */
    async bumpStat(playerId, stat, expectedTier, runner = db) {
      const column = STAT_COLUMNS[stat];
      if (!column) throw new Error(`unknown stat: ${stat}`);
      const result = await runner.query(
        `UPDATE players
            SET ${column} = ${column} + 1, updated_at = now()
          WHERE id = $1 AND ${column} = $2::int`,
        [playerId, expectedTier],
      );
      return result.rowCount === 1;
    },
  };
}
