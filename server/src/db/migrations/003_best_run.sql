-- Run mode's high score (see run-mode-tasks.md, docs/decisions.md D-28).
--
-- Four columns on `players` rather than a `runs` table: nothing keeps a run
-- history, because nothing reads one. There is no leaderboard, no replay and
-- no payout, so the only fact worth storing is the best one, and a row per run
-- would be a table that only ever grows and is only ever aggregated to a
-- single MAX.
--
-- Same shape as the stat columns above them: NOT NULL, DEFAULT 0, and a
-- non-negative CHECK, so an existing player is simply a player whose best run
-- is zero. `best_run_at` is the exception — NULL means "has never banked a
-- run", which zero cannot express for a timestamp.
--
-- One ALTER per column, because pg-mem parses a multi-column ADD as far as the
-- first comma and then stops (decisions.md D-26).

ALTER TABLE players ADD COLUMN IF NOT EXISTS
  best_run_score INTEGER NOT NULL DEFAULT 0 CHECK (best_run_score >= 0);
ALTER TABLE players ADD COLUMN IF NOT EXISTS
  best_run_chain INTEGER NOT NULL DEFAULT 0 CHECK (best_run_chain >= 0);
ALTER TABLE players ADD COLUMN IF NOT EXISTS
  best_run_distance INTEGER NOT NULL DEFAULT 0 CHECK (best_run_distance >= 0);
ALTER TABLE players ADD COLUMN IF NOT EXISTS
  best_run_at TIMESTAMPTZ;
