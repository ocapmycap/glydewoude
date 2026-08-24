-- Enforce the append-only rule in the database, not just in the repository.
--
-- The `.pg.sql` suffix means "real PostgreSQL only": the migration runner
-- skips these when running against pg-mem, which cannot parse plpgsql. The
-- guarantee therefore exists everywhere the server actually runs, and the
-- test suite covers the same rule at the repository layer instead.

CREATE OR REPLACE FUNCTION transactions_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transactions is append-only (attempted %)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transactions_no_mutate ON transactions;
CREATE TRIGGER transactions_no_mutate
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_append_only();
