# Glidewood

A cozy browser game about a gliding squirrel. Launch from a branch, ride the
glide across the canopy, catch a trunk on the far side, climb, and go again.

**Phase 1 is done.** One small forest, basic glide physics, and the single
question it existed to answer — *does the movement feel good?* — settled by
playing it. That was the go/no-go gate for everything after it.

**Phase 2 is done.** Land on a tree and you pocket what is cached there; land
on a shop and you can spend it on a glide upgrade; reload the page and it is
all still yours. Materials, accounts, Postgres persistence and the server-side
economy are wired to the client and driven end to end. What is done and the one
check still outstanding are tracked item by item in
[`docs/phase-2-progress.md`](docs/phase-2-progress.md).

Scope for both comes from the [product document](docs/glidewood-product-doc.md) §9.

---

## Run it locally, from scratch

You need **Node.js 20 or newer** and npm.

```bash
git clone https://github.com/ocapmycap/glydewoude.git
cd glydewoude
npm install
npm run dev
```

Then open **http://localhost:5173**. The game runs and flies with nothing else
installed — no database, no Docker, no `.env`. It will say *"Playing offline —
nothing will be saved"* on the opening card, and it means it: no account, tier
zero, no shop.

For the saving half — accounts, materials that survive a reload, a shop that
sells you anything — you also need the server running, which needs Docker. See
[Running the server](#running-the-server). Start it before `npm run dev` and the
dev server proxies to it automatically; there is nothing to configure.

### Every script

Run all of these from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload on http://localhost:5173 |
| `npm test` | The full test suite, headless, in Node |
| `npm run test:watch` | The same suite in watch mode |
| `npm run lint` | ESLint over the whole repo |
| `npm run build` | Production bundle into `client/dist/` |
| `npm run preview` | Serve the built bundle on http://localhost:4173 |
| `npm run verify` | `lint`, then `test`, then `build` — what CI runs |

### Deploying the prototype

`npm run build` writes a self-contained static site to `client/dist/`. It uses
relative asset paths, so it works from any static host and any subpath without
a rebuild — drop it on Vercel, Netlify or Cloudflare Pages.

The bundle calls the API at the same origin it was served from. If the API
lives somewhere else, point the build at it:

```bash
VITE_API_URL=https://api.example.com npm run build
```

A build deployed without a reachable API still works — it just plays offline.

### Running the server

Needed for anything to be saved. It wants Docker for Postgres, and **Node
20.12 or newer**: the server scripts load `.env` with Node's own
`--env-file-if-exists` rather than a `dotenv` dependency, and that flag arrived
in 20.12. The client is fine on any Node 20.

```bash
cp server/.env.example server/.env
docker compose -f server/docker-compose.yml up -d   # Postgres on :5432
npm start --workspace server                        # http://localhost:8787
```

It applies pending migrations on boot. With it up, `npm run dev` proxies `/api`
and `/healthz` to port 8787, so the client's default API base can stay empty and
nobody has to think about CORS locally.

Endpoints, the seed script for a test player with materials already banked, and
the design notes are in [`server/README.md`](server/README.md).

---

## How to play

| Input | Action |
|---|---|
| <kbd>Space</kbd> | Launch from the branch |
| <kbd>A</kbd> <kbd>D</kbd> or <kbd>←</kbd> <kbd>→</kbd> | Steer |
| <kbd>W</kbd> <kbd>S</kbd> or <kbd>↑</kbd> <kbd>↓</kbd> | Dive / flare |
| Click the canvas | Steer with the mouse instead (pointer lock; <kbd>Esc</kbd> releases) |
| <kbd>R</kbd> | Return to the great oak |
| <kbd>T</kbd> | Show or hide the glide tuning dials |
| <kbd>1</kbd>–<kbd>4</kbd> | Buy that row's upgrade, while perched at a shop |

**The one thing that is not obvious:** a glide only ever loses height. You get
it back by flying *into* a tall tree — catch the trunk anywhere on its upper
half and the squirrel climbs to the top. So a tall tree is not an obstacle, it
is an altitude station, and the interesting question on every glide is whether
you can reach one before you sink below its lowest branches.

Diving buys ground speed at the cost of glide ratio; flaring slows you and
softens the descent. Cruising untouched is the most efficient way to travel.

**Materials come from landing.** Roughly half the trees have a cache on them,
and arriving is the pickup — there is no separate collect button, because the
landing is the thing you already had to earn. The strip at the top of the
screen is your pouch. A dot beside it means the server has not confirmed
something yet.

**Shops are the mauve canopies.** Nine of them sit in the default forest, 71 to
246 metres out, coloured apart from the gold of an ordinary landmark so you can
pick one out from the air — finding one is the navigation half of the loop.
Landing opens the counter and hands you back the mouse pointer; the panel shows
what each upgrade costs *you*, greys out what you cannot afford, and a click or
a number key buys it. Prices, tiers and your balance all live on the server, so
a bought upgrade is a longer glide on your next launch and it is still there
tomorrow.

### The tuning dials

Press <kbd>T</kbd> and the glide constants become editable while you fly. This
was the whole point of Phase 1 — if the glide feels wrong, find the numbers
where it feels right and say what they were — and the dials stayed, because
upgrades change the same feel and it still needs tuning by hand. Changes are
local to your browser tab and reset on reload.

---

## Layout

```
client/          Three.js frontend — the game you actually play
  src/sim/         the glide loop, collection, shops. Pure JS: no Three.js, no DOM
  src/render/      everything that touches Three.js
  src/net/         the API client, the session, and the intent pump
  src/ui/          input bindings, HUD, pouch, shop panel, tuning panel
  test/            headless tests, including the core glide-loop smoke test
shared/          logic the client and the server both need
  src/             glide physics, forest generation, material caches, seeded RNG
server/          accounts, persistence, and validation of the economy
  src/domain/      the rules: auth, upgrades, anti-cheat
  src/repo/        SQL, one module per table
docs/             the product doc, phase plans, and the decision log
```

`server/` imports `shared/` to re-derive what a client claims — the same
physics, the same forest, from the same seed. That is §6.1, and it is the
reason the Three.js-free boundary below is enforced rather than encouraged.

`client/src/sim` and `shared/src` are deliberately free of Three.js, the DOM
and browser globals. That is what lets the automated tests fly the *actual*
game loop in Node rather than a test-only copy of it, and it is enforced by
both ESLint and a test rather than left to good intentions.

The same rule runs the other way for the network. `main.js` is the only module
that reaches for the server; `sim/` may not import `net/` and may not call
`fetch`, which is also enforced by a test. A simulation that could make a
network call is a simulation that could not be replayed from a seed.

---

## Tests

```bash
npm test
```

Everything runs in plain Node — no browser, no WebGL, no jsdom. The server
suite included: it runs the real schema and the real SQL against
[pg-mem](https://github.com/oguimbal/pg-mem), so `npm test` needs no database.

Two tests skip by default, because pg-mem cannot demonstrate what they assert —
the append-only ledger trigger and a concurrent duplicate-claim race. Point the
suite at a real PostgreSQL to run them, as CI does:

```bash
DATABASE_URL=postgres://glidewood:glidewood@localhost:5432/glidewood npm test
```

The one that matters is `client/test/glide-loop.smoke.test.js`. It builds the
seeded forest, perches the squirrel on the great oak, and flies five
consecutive hops through the shipped simulation with a scripted pilot,
asserting each one ends in a real mid-air catch on a new tree. If altitude ever
stopped being recoverable, that chain would collapse into ground recoveries and
the test would fail.

`client/test/sync.test.js` is the Phase 2 equivalent: it flies the same real
simulation against a stand-in for the network and asserts the pickup is banked,
the purchase reaches the physics, and a refusal is settled rather than retried
forever.

The rest covers glide-math invariants, worldgen determinism, landing volumes,
the fixed-timestep loop, the session's token lifecycle, and both boundaries.

Glide *feel* is not tested and deliberately so — the product document is
explicit that feel-based systems resist automated testing (§7.4). That is what
the tuning panel and manual playtesting are for.

---

## Contributing

Conventions — directory layout, naming, how to add an interactive element, what
belongs in which package — are in [`CLAUDE.md`](CLAUDE.md). Design decisions and
the reasoning behind them are in [`docs/decisions.md`](docs/decisions.md).

Before opening a PR: `npm run verify`.
