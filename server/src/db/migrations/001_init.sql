-- Glidewood Phase 2 schema.
--
-- Shaped after the product doc's data model (§5.3), with two deliberate
-- departures recorded in docs/decisions.md:
--
--   * There are no Zone or Tree tables. The forest is derived from a seed on
--     both sides (D-3, D-16), so storing it would create a second source of
--     truth that could drift from the one the physics uses.
--   * Materials and glide stats are columns and rows rather than JSON blobs,
--     so the economy can be moved with atomic, constraint-checked SQL instead
--     of read-modify-write.

CREATE TABLE IF NOT EXISTS players (
  id                  UUID PRIMARY KEY,
  display_name        TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  world_seed          TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Upgrade tiers (§3.2). Ceilings are enforced in the domain layer, which
  -- owns the catalogue; the database only guarantees they never go negative.
  stat_distance       INTEGER NOT NULL DEFAULT 0 CHECK (stat_distance >= 0),
  stat_agility        INTEGER NOT NULL DEFAULT 0 CHECK (stat_agility >= 0),
  stat_flap_charges   INTEGER NOT NULL DEFAULT 0 CHECK (stat_flap_charges >= 0),
  stat_fall_control   INTEGER NOT NULL DEFAULT 0 CHECK (stat_fall_control >= 0),

  currency_soft       INTEGER NOT NULL DEFAULT 0 CHECK (currency_soft >= 0),
  currency_hard       INTEGER NOT NULL DEFAULT 0 CHECK (currency_hard >= 0),

  inventory_cosmetics JSONB NOT NULL DEFAULT '[]'::jsonb,
  equipped_cosmetics  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Presence only, client-reported. §6.1 permits this: a spoofed position is
  -- cosmetic. It is still the anchor for the plausibility check, so it is
  -- written by the server from validated events, never blindly from a save.
  last_position       JSONB,
  last_position_at    TIMESTAMPTZ
);

-- Raw tokens are never stored, only their SHA-256 (§6.5).
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   TEXT PRIMARY KEY,
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS sessions_player_id_idx ON sessions (player_id);

-- The primary key is the whole anti-duplicate mechanism for collection: a
-- second claim on the same cache violates it, so a replayed request cannot
-- pay out twice even if two arrive at once.
CREATE TABLE IF NOT EXISTS collected_caches (
  player_id    UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cache_id     TEXT NOT NULL,
  material     TEXT NOT NULL,
  amount       INTEGER NOT NULL CHECK (amount > 0),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, cache_id)
);

CREATE TABLE IF NOT EXISTS player_materials (
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  material  TEXT NOT NULL,
  amount    INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  PRIMARY KEY (player_id, material)
);

-- Append-only audit trail (§5.3, §6.3). Cheap now, expensive to retrofit.
CREATE TABLE IF NOT EXISTS transactions (
  id         BIGSERIAL PRIMARY KEY,
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('earn', 'spend')),
  item       TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  source     TEXT NOT NULL,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_player_id_idx ON transactions (player_id, id);
