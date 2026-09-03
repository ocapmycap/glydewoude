/**
 * Seed a test player with materials already banked (§7.3).
 *
 * The point is to avoid re-grinding the economy by hand every time someone
 * wants to test a purchase flow. It goes through the same repositories as the
 * live server, so a seeded player is indistinguishable from an earned one —
 * including having a real ledger behind their balance.
 *
 *   npm run seed --workspace server -- --name "Test Squirrel" --acorns 200
 */

import '../load-env.js';

import { loadConfig } from '../config.js';
import { createDatabase } from './database.js';
import { migrate } from './migrate.js';
import { createPool } from './pool.js';
import { createAuth } from '../domain/auth.js';
import { createPlayerRepo } from '../repo/players.js';
import { createTransactionRepo } from '../repo/transactions.js';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const config = loadConfig();
const db = createDatabase(createPool(config));
await migrate(db);

const players = createPlayerRepo(db);
const transactions = createTransactionRepo(db);
const auth = createAuth({ db, players, config });

const created = await auth.register({ displayName: arg('name', 'Test Squirrel') });
if (!created.ok) throw new Error(`seed failed: ${created.reason}`);

const grants = {
  acorns: Number(arg('acorns', 250)),
  bark: Number(arg('bark', 120)),
  silk: Number(arg('silk', 40)),
  berries: Number(arg('berries', 5)),
};

await db.transaction(async (client) => {
  for (const [material, amount] of Object.entries(grants)) {
    if (!amount) continue;
    await players.creditMaterial(created.player.id, material, amount, client);
    await transactions.record({
      playerId: created.player.id,
      type: 'earn',
      item: material,
      amount,
      source: 'seed',
      metadata: { note: 'development seed' },
    }, client);
  }
});

console.log('seeded player');
console.log(`  id:    ${created.player.id}`);
console.log(`  name:  ${created.player.displayName}`);
console.log(`  token: ${created.token}`);
console.log(`  materials: ${JSON.stringify(grants)}`);
await db.close();
