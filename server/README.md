# Glidewood server

Accounts, persistence, and server-side validation of the economy — Phase 2 of
the [product document](../docs/glidewood-product-doc.md).

The rule this package exists to enforce is §6.1: **the client sends intents,
the server decides what is true.** Nothing here trusts a number the client
supplied about its own balance.

---

## Run it locally

Needs Docker (for Postgres) and Node 20+.

```bash
cd server
cp .env.example .env
docker compose up -d          # Postgres on :5432
npm install --workspaces      # from the repo root
npm run migrate --workspace server
npm start --workspace server  # http://localhost:8787
```

`npm start` runs pending migrations itself, so the explicit `migrate` step is
only needed if you want to apply them without booting the server.

### A test player with materials already banked

Re-earning an economy by hand to test a purchase is a waste of a morning
(§7.3), so:

```bash
npm run seed --workspace server -- --name "Test Squirrel" --acorns 250
```

It prints a player id and a session token. The seeded player goes through the
same repositories as a real one, ledger rows included.

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
