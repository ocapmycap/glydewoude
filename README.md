# Glidewood

A cozy browser game about a gliding squirrel. Launch from a branch, ride the
glide across the canopy, catch a trunk on the far side, climb, and go again.

**This repository is at Phase 1 of the [product document](docs/glidewood-product-doc.md):
one small forest, basic glide physics, no accounts, no saving.** The whole
phase exists to answer one question — *does the movement feel good?* — because
that is the go/no-go gate for everything after it.

---

## Run it locally, from scratch

You need **Node.js 20 or newer** and npm. Nothing else — no database, no Docker,
no API keys, no `.env` file.

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
a rebuild — drop it on Vercel, Netlify or Cloudflare Pages. There is no backend
to deploy in Phase 1.

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

### The tuning dials

Press <kbd>T</kbd> and the glide constants become editable while you fly. This
is the point of Phase 1 — if the glide feels wrong, find the numbers where it
feels right and say what they were. Changes are local to your browser tab and
reset on reload.

---

## Layout

```
client/          Three.js frontend — the only runnable app in Phase 1
  src/sim/         the glide loop. Pure JS: no Three.js, no DOM
  src/render/      everything that touches Three.js
  src/ui/          input bindings, HUD, tuning panel
  test/            headless tests, including the core glide-loop smoke test
shared/          logic the Phase 2 server will also need
  src/             glide physics, forest generation, seeded RNG, constants
docs/            the product doc, the Phase 1 plan, and the decision log
```

There is no `server/` yet. Phase 2 adds it along with persistence and
server-side validation — see [`docs/decisions.md`](docs/decisions.md) (D-2).

`client/src/sim` and `shared/src` are deliberately free of Three.js, the DOM
and browser globals. That is what lets the automated tests fly the *actual*
game loop in Node rather than a test-only copy of it, and it is enforced by
both ESLint and a test rather than left to good intentions.

---

## Tests

```bash
npm test
```

Everything runs in plain Node — no browser, no WebGL, no jsdom.

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
