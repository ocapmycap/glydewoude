/**
 * Test harness.
 *
 * Runs the real schema and the real SQL. By default that happens against
 * pg-mem, so `npm test` needs no database and CI stays a single job. Set
 * `DATABASE_URL` and the identical suite runs against real PostgreSQL —
 * which is how the schema is checked for things pg-mem is more relaxed about.
 */

import { DataType, newDb } from 'pg-mem';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDatabase } from '../../src/db/database.js';
import { migrate } from '../../src/db/migrate.js';

export const USING_REAL_POSTGRES = Boolean(process.env.DATABASE_URL);

async function realPool() {
  const pg = await import('pg');
  const schema = `test_${randomUUID().replace(/-/g, '')}`;

  // Every harness gets its own schema, so suites cannot see each other's rows
  // and can run in parallel.
  const admin = new pg.default.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  // search_path is set through connection options rather than an unawaited
  // `connect` listener — that listener races the first real query and trips
  // pg's "client is already executing a query" warning.
  const pool = new pg.default.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 4,
    options: `-c search_path=${schema}`,
  });
  return { pool, schema };
}

/**
 * @param {object} [overrides] config overrides, e.g. tighter rate limits
 */
export async function createHarness(overrides = {}) {
  let pool;
  let cleanup = async () => {};

  if (USING_REAL_POSTGRES) {
    const created = await realPool();
    pool = created.pool;
    cleanup = async () => {
      await pool.query(`DROP SCHEMA ${created.schema} CASCADE`).catch(() => {});
      await pool.end();
    };
  } else {
    const mem = newDb();
    // pg-mem does not ship every builtin. `length` is used by the
    // display_name CHECK, and the constraint is worth keeping in the real
    // schema, so it is taught to the emulator rather than removed from
    // production.
    mem.public.registerFunction({
      name: 'length',
      args: [DataType.text],
      returns: DataType.integer,
      implementation: (value) => (value === null ? null : String(value).length),
    });
    pool = new (mem.adapters.createPg()).Pool();
  }

  const db = createDatabase(pool);
  // pg-mem cannot parse plpgsql, so the append-only trigger is skipped there.
  // The repository-level guarantee is asserted separately.
  await migrate(db, { nativeOnly: USING_REAL_POSTGRES });

  const config = {
    ...loadConfig({ DATABASE_URL: 'test' }),
    ...overrides,
    validation: { ...loadConfig({}).validation, ...(overrides.validation ?? {}) },
    rateLimit: { ...loadConfig({}).rateLimit, ...(overrides.rateLimit ?? {}) },
  };

  const app = createApp({ db, config });
  return { db, app, config, close: cleanup };
}

/**
 * Call a route without opening a socket: build fake req/res objects and hand
 * them to the same handler the HTTP server uses.
 */
export function request(app, method, path, { token, body, headers = {} } = {}) {
  return new Promise((resolve) => {
    // A real Readable, not a hand-rolled emitter: authenticated routes await
    // the session lookup before they read the body, so anything that pushes
    // chunks eagerly loses them and the request hangs forever.
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const req = Readable.from(payload.length ? [payload] : []);

    req.method = method;
    req.url = path;
    req.headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    };
    req.socket = { remoteAddress: headers['x-test-ip'] ?? '10.0.0.1' };

    const res = {
      statusCode: 200,
      headers: {},
      headersSent: false,
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(status, extra = {}) {
        this.statusCode = status;
        this.headersSent = true;
        Object.assign(this.headers, extra);
      },
      end(raw) {
        let parsed = null;
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
        }
        resolve({ status: this.statusCode, body: parsed, headers: this.headers });
      },
    };

    app.handle(req, res).catch((error) => {
      resolve({ status: 0, body: { error: String(error) }, headers: {} });
    });
  });
}

/** Register a player and return {token, player}. */
export async function registerPlayer(app, displayName = 'Nutkin') {
  const response = await request(app, 'POST', '/api/auth/register', {
    body: { displayName },
  });
  return { ...response.body, status: response.status };
}
