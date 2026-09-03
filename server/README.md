# Glidewood server

Accounts, persistence, and server-side validation of the economy — Phase 2 of
the [product document](../docs/glidewood-product-doc.md).

The rule this package exists to enforce is §6.1: **the client sends intents,
the server decides what is true.** Nothing here trusts a number the client
supplied about its own balance.

---

## Run it locally

Needs Docker (for Postgres) and Node 20.12+ (for the built-in `.env` loader).

```bash
npm install                     # from the repo root — installs every workspace
cp server/.env.example server/.env
docker compose -f server/docker-compose.yml up -d   # Postgres on :5432
npm start --workspace server    # http://localhost:8787
```

`npm start` loads `server/.env` itself (via `src/load-env.js`) and runs any
pending migrations before it listens, so there is no separate step for either.
`npm install`, run once from the repo root, installs the dependencies of every
workspace — client, server and shared.

If you would rather apply migrations without booting the server, or seed a test
player, those commands read `server/.env` the same way:

```bash
npm run migrate --workspace server
```

### A test player with materials already banked

Re-earning an economy by hand to test a purchase is a waste of a morning
(§7.3), so:

```bash
npm run seed --workspace server -- --name "Test Squirrel" --acorns 250
```

It prints a player id and a **session token**. The seeded player goes through
the same repositories as a real one, ledger rows included. Keep the token — the
end-to-end guide below uses it to open the browser as that wealthy player.

### Troubleshooting

- **`DATABASE_URL is not set`** — Postgres is not up, or `server/.env` is
  missing. The server reads `server/.env` automatically; `.env` is gitignored,
  so copy it from `.env.example` on a fresh clone.
- **`ECONNREFUSED 127.0.0.1:5432`** — `.env` loaded fine, but no Postgres is
  answering. Start it with the `docker compose` line above and wait for the
  container to report healthy (`docker ps`).

---

## Playing it end to end

The Phase 2 promise is a loop that persists across sessions. To watch it do
that, run the server and the client together and drive them from a browser.

**Terminal 1 — the server**, exactly as under *Run it locally* above (Postgres
up, then `npm start --workspace server`).

**Terminal 2 — the client**, pointed at that server:

```bash
VITE_API_URL=http://localhost:8787 npm run dev --workspace client
```

Open the printed `http://localhost:5173`. Without `VITE_API_URL` the client
still runs, but offline and unpersisted — no session, no saving.

### Getting a balance to spend

On first load the client **registers a fresh player** and stores its token in
`localStorage` under `glidewood.token`. A new player owns nothing, so there are
two ways to get materials:

- **Earn them.** Glide and land on trees that hold caches. Each claim syncs to
  the server and settles into your balance.
- **Borrow the seeded wallet.** Run the `seed` command above, then in the
  browser devtools console become that player:

  ```js
  localStorage.setItem('glidewood.token', 'PASTE_SEED_TOKEN'); location.reload();
  ```

### What to confirm

1. **Persistence.** Note your materials, reload the page, and confirm they are
   unchanged — they come back from `GET /api/player/me`, not from the browser.
2. **Buying.** Spend on an upgrade (through the in-client shop where the build
   has one, or with the API below). The balance drops and the tier rises.
3. **The purchase sticks.** Reload again: the new tier and lower balance
   persist, and the glide reflects the upgrade.

Driving the economy straight from the API, to check the server without the
client:

```bash
TOKEN=...   # from the seed output, or a register call
curl localhost:8787/api/shop/catalog -H "authorization: Bearer $TOKEN"
curl -XPOST localhost:8787/api/shop/purchase \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"upgrade":"distance"}'
curl localhost:8787/api/player/transactions -H "authorization: Bearer $TOKEN"
```

---

## Tests

```bash
npm test                      # from the repo root; no database needed
```

The suite runs the **real schema and the real SQL** against
[pg-mem](https://github.com/oguimbal/pg-mem), so it needs no service and stays
in the one CI job with everything else.

Point it at a real database to run the same suite for real:

```bash
DATABASE_URL=postgres://glidewood:glidewood@localhost:5432/glidewood npm test
```

Each harness gets its own schema, so runs do not collide.

**Two tests only run against real PostgreSQL**, and CI runs them in a separate
job with a Postgres service:

- the append-only trigger (pg-mem cannot parse plpgsql)
- the concurrent duplicate-claim race (pg-mem does not isolate transactions)

Both guarantees are real; pg-mem simply cannot demonstrate either. If you
change anything about claiming or the ledger, run against real Postgres before
pushing.

---

## API

All economy routes need `Authorization: Bearer <token>`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | liveness, checks the database |
| `POST` | `/api/auth/register` | create a player, returns a token |
| `POST` | `/api/auth/logout` | revoke the current token |
| `GET` | `/api/player/me` | full player state |
| `POST` | `/api/player/position` | save last position (client-reported) |
| `GET` | `/api/shop/catalog` | upgrades and this player's next prices |
| `POST` | `/api/collect` | bank a material cache |
| `POST` | `/api/shop/purchase` | buy the next tier of an upgrade |
| `GET` | `/api/player/transactions` | the player's ledger |

### Collecting

```http
POST /api/collect
{ "cacheId": "cache-tree-042", "position": { "x": 120, "y": 26, "z": -45 } }
```

The response carries the **authoritative** totals:

```json
{ "credited": { "material": "acorns", "amount": 2 },
  "materials": { "acorns": 2, "silk": 0, "bark": 0, "berries": 0 } }
```

Note what the request does *not* contain: how much the cache was worth. The
server looks that up from the seed-derived world. A client asking for a
thousand berries gets whatever the cache actually held.

This maps onto the client's collection ledger directly — `materials` is what
`settle()` expects, and it *replaces* the client's provisional tally rather
than adding to it.

### Validation

A collection claim is refused if the cache does not exist in the seeded world,
has already been banked by this player, is claimed from somewhere the player
is not, or could not have been reached in the time since we last saw them.
The last one bounds horizontal speed against the player's own upgrade tiers —
proportionate to §6.3, which asks for teleport and speed-hack detection rather
than a full anti-cheat system.

---

## Design notes

- **No Zone or Tree tables.** The forest is derived from a seed on both sides,
  so storing it would create a second source of truth. See `docs/decisions.md`.
- **Materials are rows, stats are columns**, not JSON blobs, so the economy
  moves with atomic constraint-checked SQL rather than read-modify-write.
- **Purchases debit conditionally** (`WHERE amount >= cost`) instead of
  locking. Two concurrent buys cannot both succeed.
- **`transactions` is append-only**, by trigger on PostgreSQL and by the
  absence of any update or delete in the repository.
- **Sessions are opaque hashed tokens**, not JWTs, so they can be revoked.
- **Rate limiting is in-process** — correct for the single VPS in §5.4, and the
  thing to replace with Redis the moment there are two.
