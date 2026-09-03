/** `npm run migrate --workspace server` */

import '../load-env.js';

import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';

const db = createDatabase(createPool(loadConfig()));
const applied = await migrate(db, { log: (message) => console.log(`[migrate] ${message}`) });
console.log(applied.length ? `[migrate] applied ${applied.length}` : '[migrate] up to date');
await db.close();
