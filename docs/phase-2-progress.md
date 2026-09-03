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

**Status: the deliverable is met.** The loop was driven end to end against a
real Postgres-backed server — collect, buy, reload, still there. The numbers
are in §4.

---

## 1. Item by item

| Product doc §9 item | State |
|---|---|
| Material collection | **Done.** Caches derived from the world seed in `shared/src/materials.js`; `client/src/sim/collection.js` raises intents and holds no balance; `client/src/net/sync.js` carries them to the server and settles them. |
| One functioning shop | **Done.** Shop trees are in the world, open on landing, show the server's catalogue with the player's own next price, and a button buys. |
| Basic glide upgrades | **Done.** Priced and validated in `server/src/domain/upgrades.js`; confirmed tiers reach the physics through `simulation.applyStats()`. |
| Accounts + save/load (Postgres) | **Done.** Register/logout, `/api/player/me`, position saves, migrations, a seed CLI. A token in `localStorage` is what survives the reload. |
| Server-side validation from the start (§6.1) | **Done for collection**, partial for purchases — see §3. |
| **A loop that persists across sessions** | **Met.** See §4. |

## 2. What landed, and where

Four merged efforts. `main` has not moved since the product doc.

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
22 destinations, spread 71–246 m from spawn. Decision D-28.

**This session — the wiring.** The four gaps the previous version of this file
listed are closed. Decisions D-29, D-30, D-31.

- **`client/src/net/`** — a fourth peer under `main.js` alongside `sim/`,
  `render/` and `ui/` (D-29). `api.js` is the eight endpoints as functions,
  returning values rather than throwing; `session.js` keeps one token across
  reloads; `sync.js` drains the intent queues, one at a time and in order,
  because the D-27 position anchor makes out-of-order collections look like a
  teleport (D-30).
- **`simulation.applyStats()`** — the one method `sim/` gained. It writes
  server-confirmed tiers into the stats object and re-derives the glide
  profile. This is the payoff for `deriveGlideProfile(stats, tuning)` taking
  stats as a parameter in Phase 1.
- **`client/src/ui/pouch.js`** — the materials strip. Shows the provisional
  total with a dot while anything is unconfirmed.
- **`client/src/ui/shop-panel.js`** — the counter. Renders
  `GET /api/shop/catalog` and turns a click into an intent. Landing on a shop
  releases the pointer lock, because a captured pointer cannot press a button.
- **Offline play** — a missing server means tier zero on the default forest and
  a hint card that says nothing will be saved, rather than an error screen
  (D-31).

## 3. What is missing

**Purchases are not position-validated.** `client/src/sim/shop.js` builds a
purchase intent carrying `treeId` and `atPosition`, and its header says this is
"for the same reason" collection claims are anchored. That is not true yet.
`api.purchase()` sends only `{ upgrade }`, and `economy.purchase()` checks the
tier, the price and the balance but never where the player was standing. The
"you must be perched at a shop" rule is enforced by the client alone, which
§6.1 says is not enforcement at all.

Nothing is exploitable in a way that creates materials — the balance check is
atomic and server-side — so this is a missing check rather than a hole. What it
does cost is the navigation half of the loop: a purchase that works from the
spawn branch means never having to find a shop.

Written up as
[`.scratch/purchase-anchoring/issues/01-anchor-purchases-to-a-shop.md`](../.scratch/purchase-anchoring/issues/01-anchor-purchases-to-a-shop.md),
`ready-for-agent`. It is small — `checkReachable` is already exported on its own
for exactly this kind of reuse — and it is the first thing to do next.

**No offline replay.** Intents raised while the server is unreachable stay
pending and go up if the connection returns; a reload loses them (D-31).

**Two tests still skipped.** They need a real PostgreSQL rather than pg-mem
(D-26).

## 4. Verification

`npm run verify` — lint, then tests, then build — passes from a clean checkout.
**231 tests pass, 2 skipped**, up from 181. New coverage:

| File | Covers |
|---|---|
| `client/test/net-api.test.js` | every outcome arrives as a value; refusals keep the server's reason |
| `client/test/session.test.js` | the token's lifecycle, including *keeping* it when the server merely could not be reached |
| `client/test/sync.test.js` | settle/reject routing, retry-only-on-"could not ask", serial ordering, position re-anchoring, and the loop end to end |
| `client/test/upgrades.test.js` | confirmed tiers reaching `deriveGlideProfile` |
| `client/test/architecture.test.js` | `sim/` and `shared/` may not import `net/` or call `fetch`; `net/` may not touch the DOM |

**The deliverable, driven against a real server.** Docker Postgres, the real
`server/`, and the real client modules — `createApiClient`, `createSession`,
`createSync`, `createSimulation` — flown by the test autopilot:

```
start: true  Rowantail 792  resumed: false
collected: {"acorns":13,"silk":10,"bark":5,"berries":2}   (40 hops)
tier before: 0  ratio: 5.500
  purchased: {"upgrade":"distance","tier":1,"price":{"acorns":12}}
tier after:  1  ratio: 6.300

--- reloading with the stored token ---
resumed: true as Rowantail 792
stats after reload:     {"distance":1,"agility":0,"flapCharges":0,"fallControl":0}
materials after reload: {"acorns":1,"silk":10,"bark":5,"berries":2}
ratio after reload: 6.300
```

Land, collect, buy an upgrade, reload, still have it. Note the acorns: 13
earned, 12 spent, 1 left — the server debited them, not the client.

**Rendering, verified by looking at it** (CLAUDE.md requires this rather than a
test):

- **Shop canopies read as distinct.** Mauve shops, gold landmarks and green
  scenery are all separable at glide distance. This closes the item the
  previous version of this file left open.
- **The pouch** shows counts, dims materials never found, and shows the
  unconfirmed dot.
- **The shop panel** renders the catalogue with the player's own prices,
  disables what is unaffordable and what is maxed, and buys on click. A
  refusal reads "Not yet — you need 4 more acorns and 2 more bark." Offline it
  reads "The shelves are dark — no connection."

**One thing worth noticing about the pace.** It took 40 hops to afford the
first upgrade. That is a tuning question for a playtest, not a bug, but the
first tier should probably not be an afternoon's work.

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
- [x] Transport: a client that can reach the eight endpoints
- [x] Upgrade tiers fetched and fed into `createSimulation`
- [x] Collection and purchase intents settled against the server
- [x] HUD: materials and balance
- [x] Shop panel: catalogue, prices, a button that buys
- [x] Visual check on the shop canopy colour
- [x] **Deliverable: land, collect, buy an upgrade, reload, still have it**
- [ ] Purchases anchored to a shop the server checks (§3, [ticket 01](../.scratch/purchase-anchoring/issues/01-anchor-purchases-to-a-shop.md))

## 6. Documentation that has gone stale

- **`phase-1-plan.md` §2** lists materials, shops, upgrades, accounts and the
  server as deferred to Phase 2. That table is correct as a record of Phase 1's
  scope and is best left alone.
