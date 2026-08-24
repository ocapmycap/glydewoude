/**
 * Migration runner.
 *
 * Plain ordered `.sql` files, tracked in `schema_migrations`. No framework:
 * the whole thing is fifty lines and a migration tool is a dependency with a
 * lifecycle of its own.
 *
 * Files ending `.pg.sql` need real PostgreSQL (plpgsql, triggers). They are
 * skipped when `nativeOnly` is false, which is how the test suite runs the
 * same schema against pg-mem.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

export async function listMigrations({ nativeOnly = true } = {}) {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => nativeOnly || !name.endsWith('.pg.sql'))
    .sort();
}

/**
 * @param {ReturnType<import('./database.js').createDatabase>} db
 * @param {object} [options]
 * @param {boolean} [options.nativeOnly] include PostgreSQL-only migrations
 * @param {(message: string) => void} [options.log]
 */
export async function migrate(db, { nativeOnly = true, log = () => {} } = {}) {
  await db.query(CREATE_TABLE);
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const names = await listMigrations({ nativeOnly });
  const ran = [];

  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    // Each migration is its own transaction, so a failure half way through
    // the set leaves the earlier ones applied and the broken one not.
    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    });
    ran.push(name);
    log(`applied ${name}`);
  }
  return ran;
}
