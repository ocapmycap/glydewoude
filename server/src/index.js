/** Entry point. */

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const db = createDatabase(createPool(config));

const applied = await migrate(db, { log: (message) => console.log(`[migrate] ${message}`) });
if (applied.length === 0) console.log('[migrate] schema up to date');

const app = createApp({ db, config });
const server = await app.listen(config.port, config.host);
console.log(`[glidewood] listening on http://${config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[glidewood] ${signal}, shutting down`);
    server.close(() => db.close().finally(() => process.exit(0)));
  });
}
