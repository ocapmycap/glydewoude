# Glidewood

A cozy browser game about a gliding squirrel. Launch from a branch, ride the
glide across the canopy, catch a trunk on the far side, climb, and go again.

**Phase 1 is done.** One small forest, basic glide physics, and the single
question it existed to answer — *does the movement feel good?* — settled by
playing it. That was the go/no-go gate for everything after it.

**Phase 2 is half built.** Materials, accounts, Postgres persistence and the
whole server-side economy exist and are tested. What does not exist yet is the
wire between them: the client cannot call the server, so nothing you pick up
survives a reload, and the shop trees now scattered through the forest have no
counter to stand at. What is done and what is left is tracked item by item in
[`docs/phase-2-progress.md`](docs/phase-2-progress.md).

Scope for both comes from the [product document](docs/glidewood-product-doc.md) §9.

---

## Run it locally, from scratch

You need **Node.js 20 or newer** and npm. Nothing else — no database, no Docker,
no API keys, no `.env` file. That is not leftover Phase 1 wording: the client
has no transport to the server yet, so the game genuinely runs standalone.
Running the backend is optional, and covered under
[Running the server](#running-the-server).

```bash
git clone https://github.com/ocapmycap/glydewoude.git
cd glydewoude
npm install
npm run dev
```

Then open **http://localhost:5173**. That is the whole setup.

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

The backend does not need deploying alongside it yet. Nothing in the built
bundle calls it.

### Running the server

Optional, and only interesting if you are working on persistence or the
economy — the game does not call it. It needs Docker for Postgres, and
**Node 20.12 or newer**: the server scripts load `.env` with Node's own
`--env-file-if-exists` rather than a `dotenv` dependency, and that flag arrived
in 20.12. The client is fine on any Node 20.

```bash
cp server/.env.example server/.env
docker compose -f server/docker-compose.yml up -d   # Postgres on :5432
npm start --workspace server                        # http://localhost:8787
```

It applies pending migrations on boot. Endpoints, the seed script for a test
player with materials already banked, and the design notes are in
[`server/README.md`](server/README.md).

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

**The one thing that is not obvious:** a glide only ever loses height. You get
it back by flying *into* a tall tree — catch the trunk anywhere on its upper
half and the squirrel climbs to the top. So a tall tree is not an obstacle, it
is an altitude station, and the interesting question on every glide is whether
you can reach one before you sink below its lowest branches.

Diving buys ground speed at the cost of glide ratio; flaring slows you and
softens the descent. Cruising untouched is the most efficient way to travel.

**Shop trees are visible but inert.** Nine of them sit in the default forest,
71 to 246 metres out, canopies coloured apart from the gold of an ordinary
landmark so you can pick one out from the air. Landing on one opens the shop
internally and raises a purchase intent if something asks for one — but there
is no panel to press yet, and no server connection to answer it, so nothing
happens on screen. Same for materials: you collect them by landing, and the
HUD does not show them.

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
  src/ui/          input bindings, HUD, tuning panel
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

The rest covers glide-math invariants, worldgen determinism, landing volumes,
the fixed-timestep loop, and the render boundary.

Glide *feel* is not tested and deliberately so — the product document is
explicit that feel-based systems resist automated testing (§7.4). That is what
the tuning panel and manual playtesting are for.

---

## Contributing

Conventions — directory layout, naming, how to add an interactive element, what
belongs in which package — are in [`CLAUDE.md`](CLAUDE.md). Design decisions and
the reasoning behind them are in [`docs/decisions.md`](docs/decisions.md).

Before opening a PR: `npm run verify`.
