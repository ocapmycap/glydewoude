/**
 * The thin layer everything else talks to instead of `pg` directly.
 *
 * Two reasons it exists: it keeps `transaction()` in one place so no route can
 * forget to roll back, and it lets the tests run the real SQL against pg-mem
 * without a database server. Queries are always parameterised — there is no
 * string interpolation of user input anywhere in this package.
 */

export function createDatabase(pool) {
  return {
    pool,

    query(text, params = []) {
      return pool.query(text, params);
    },

    /**
     * Run `fn` inside a transaction, committing on return and rolling back on
     * throw. Every economy mutation goes through this: a debit that commits
     * without its matching ledger row would be exactly the kind of corruption
     * the audit trail exists to rule out.
     *
     * @param {(client: {query: Function}) => Promise<T>} fn
     * @returns {Promise<T>}
     * @template T
     */
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // The original error is the useful one; a rollback failure on an
          // already-broken connection would just mask it.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end?.();
    },
  };
}
