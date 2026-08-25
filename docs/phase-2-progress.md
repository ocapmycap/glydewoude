# Phase 2 Progress — "Progression skeleton"

Scope reference: [`glidewood-product-doc.md`](./glidewood-product-doc.md) §9,
Phase 2. The brief handed to the implementing sessions is
[`phase-2-tasks.md`](./phase-2-tasks.md), which reproduces §9 verbatim.

> **Phase 2 deliverable (verbatim from the product doc):** material collection,
> one functioning shop, basic glide upgrades. Player accounts + save/load
> (Postgres backend introduced here). Server-side validation of
> collection/purchases from the start (§6.1). *Deliverable: a loop that
> persists across sessions.*

This file tracks what of that is real. It is written to be read by someone
picking the work up cold, so it says what is missing as plainly as what is
done.

**Status: the deliverable is not met.** Every piece exists except the wiring
between them. The client cannot talk to the server, and until it can, nothing
persists across sessions.

---

## 1. Item by item

| Product doc §9 item | State |
|---|---|
| Material collection | **Done.** Caches derived from the world seed in `shared/src/materials.js`; `client/src/sim/collection.js` raises intents and holds no balance. |
| One functioning shop | **Half.** Shop trees exist in the world and open on landing; purchase intents are raised. Nothing carries them to the server, and there is no UI to press. |
| Basic glide upgrades | **Server only.** The catalogue, prices and purchase validation are in `server/src/domain/upgrades.js`. The client never reads a tier — `main.js` still constructs the simulation without stats, so the game runs at tier 0. |
| Accounts + save/load (Postgres) | **Done.** Register/logout, `/api/player/me`, position saves, migrations, a seed CLI. |
| Server-side validation from the start (§6.1) | **Done.** `server/src/domain/validation.js` imports the shared physics to check what a client claims — the thing the `shared/` boundary in CLAUDE.md was set up to allow. |
| **A loop that persists across sessions** | **Not met.** See §3. |

## 2. What landed, and where

Three merged PRs, all on `devel`. `main` has not moved since the product doc.

**PR #1 — Phase 1.** The workspace, the headless glide sim, the Three.js
renderer, HUD, input, tuning panel, CI. Complete and gated; see
[`phase-1-plan.md`](./phase-1-plan.md).

**PR #2 — Materials and collection.** `shared/src/materials.js` derives caches
from the world seed so client and server agree without shipping a table.
`client/src/sim/collection.js` raises collection intents and deliberately holds
no balance. Decisions D-15 through D-20.

**PR #3 — The server.** `node:http` and `pg` with no framework (D-21),
Postgres migrations, token auth (D-24), the upgrade catalogue with prices held
server-side (D-25), position anchoring and anti-cheat (D-27), and CI with a
Postgres service. Eight endpoints:

```
POST /api/auth/register      POST /api/collect
POST /api/auth/logout        GET  /api/shop/catalog
GET  /api/player/me          POST /api/shop/purchase
POST /api/player/position    GET  /api/player/transactions
```

**Shop trees.** Worldgen splits destination trees between `SHOP` and
`LANDMARK` at `WORLD_CONFIG.shopShare`; the default forest holds 9 shops among
22 destinations, spread 71–246 m from spawn. `client/src/sim/shop.js` opens on
landing, closes on leaving, and raises purchase intents anchored to the tree
and the moment — no price, no balance, no tiers, matching what collection does
with materials. Shops get their own canopy colour so they can be picked out
from the air. Decision D-28.

## 3. What is missing

Four gaps, in the order they need closing. The shape for all four already
exists — `deriveGlideProfile` takes stats as a parameter, the interaction
registry is populated, `collection.settle()` and `shop.settle()` are both built
to be driven from outside. This is wiring, not architecture.

**1. There is no transport.** Not one `fetch` call anywhere under
`client/src/`. Eight endpoints, zero callers. This blocks the other three.

Where it goes is an open question worth deciding deliberately: CLAUDE.md's
dependency diagram has exactly three arms out of `main.js` — `sim/`, `render/`,
`ui/` — and transport fits none of them. The suggestion on the table is a
fourth peer, `client/src/net/`, owned by `main.js` and injected the same way
the clock already is, so `sim/` never calls it. That is not yet decided and has
no D-number.

**2. Upgrades never reach the physics.** `client/src/main.js:27` calls
`createSimulation({ world })` with no stats. The server stores a player's
tiers; the client has no idea they exist. Once `/api/player/me` is reachable
this is close to a one-line change — which is the whole reason glide stats were
made a parameter in Phase 1.

**3. Nothing drains the intent queues.** `collection.settle()` and
`shop.settle()` both wait for a server verdict that never comes. Collection
intents accumulate for the whole session; purchase intents are raised and never
answered.

**4. There is no UI for any of it.** The HUD shows perch, speed, altitude,
glide ratio and range — no materials, no balance, no shop panel, no purchase
button. D-20 deferred this explicitly to a session that never landed. As it
stands a player can land on a shop and nothing visible happens.

## 4. Verification

`npm run verify` — lint, then 181 tests, then build — passes from a clean
checkout. Test counts by area: shared glide and materials 40, worldgen 18,
client sim and loop 63, server 59, architecture 3 — 183 in total, of which 2
are skipped (they need a real PostgreSQL rather than pg-mem, D-26).

**Not verified: the shop canopy colour.** CLAUDE.md requires rendering changes
to be looked at rather than tested, and that has not happened for the shop
colour. Anyone opening the app next should confirm a shop reads as distinct
from a gold landmark at glide distance, and say so here.

## 5. Deliverables checklist

- [x] Materials derived from the world seed, shared between client and server
- [x] Collection raises intents and holds no balance
- [x] Postgres schema, migrations, seed CLI
- [x] Accounts: register, logout, token auth
- [x] Server-side validation of collection against the shared physics
- [x] Upgrade catalogue and purchase validation, priced server-side
- [x] Position anchoring and speed-bound anti-cheat
- [x] Shop trees in the world, with their own names and canopy colour
- [x] Shop interaction: opens on landing, raises purchase intents
- [ ] **Transport: a client that can reach the eight endpoints**
- [ ] Upgrade tiers fetched and fed into `createSimulation`
- [ ] Collection and purchase intents settled against the server
- [ ] HUD: materials and balance
- [ ] Shop panel: catalogue, prices, a button that buys
- [ ] Visual check on the shop canopy colour
- [ ] **Deliverable: land, collect, buy an upgrade, reload, still have it**

## 6. Documentation that has gone stale

Flagged rather than fixed, because they are not this file's to change:

- **`README.md`** still says "This repository is at Phase 1 … no accounts, no
  saving" and "There is no `server/` yet." Both were true before PR #3.
- **`phase-1-plan.md` §2** lists materials, shops, upgrades, accounts and the
  server as deferred to Phase 2. That table is correct as a record of Phase 1's
  scope and is probably best left alone.
