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
  last_position, last_position_at
`;

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
