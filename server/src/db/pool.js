/**
 * The production connection pool. Tests never import this — they hand
 * `createDatabase` a pg-mem pool instead.
 */

import pg from 'pg';

export function createPool(config) {
  if (!config.databaseUrl) {
    throw new Error(
      'DATABASE_URL is not set. From the repo root: '
      + '`docker compose -f server/docker-compose.yml up -d`, '
      + '`cp server/.env.example server/.env`, '
      + 'then `npm start --workspace server`. See server/README.md.',
    );
  }
  return new pg.Pool({
    connectionString: config.databaseUrl,
    // Small: this is one process on a small VPS (§5.4), not a fleet.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}
