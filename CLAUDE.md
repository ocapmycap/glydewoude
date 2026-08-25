# Working in this repository

Conventions established during Phase 1. Follow them rather than inventing
new ones; if one is wrong, change it deliberately and say so in
`docs/decisions.md`.

Read first: [`docs/glidewood-product-doc.md`](docs/glidewood-product-doc.md) is
the source of truth for scope and design.
[`docs/decisions.md`](docs/decisions.md) records where it was ambiguous and what
was chosen.

---

## The rule that everything else hangs off

**`shared/src/` and `client/src/sim/` must never import Three.js, touch the
DOM, or use a browser global.**

Not a style preference. It is why the core glide loop can be tested in Node,
and why the Phase 2 server will be able to import the same physics to validate
what clients claim (product doc §6.1). Both halves are enforced:

- ESLint switches browser globals off for those paths, so `document`,
  `window`, `performance` and `requestAnimationFrame` are `no-undef` errors
  there.
- `client/test/architecture.test.js` fails if anything outside
  `client/src/render/` imports `three`.

If simulation code needs the clock, a scheduler, or anything else from the
runtime, **inject it**. `createLoop` takes `now`, `schedule` and `cancel`;
`main.js` supplies the browser versions and the tests supply hand-cranked ones.

---

## Where code goes

```
shared/src/       Pure logic both the client and the future server need.
                  Constants, seeded RNG, glide math, world generation.
client/src/sim/   The running game: state machines, landing, interactions,
                  the fixed-timestep loop. Pure JS, no renderer.
client/src/render/ Everything Three.js. Scene, materials, meshes, camera.
client/src/ui/    DOM chrome: input bindings, HUD, tuning panel.
client/test/      Tests for client code.
shared/test/      Tests for shared code.
docs/             Product doc, phase plans, decision log.
```

Dependency direction is one way and does not bend:

```
main.js  ->  sim/  ->  shared/
   |
   +------>  render/  ->  three
   +------>  ui/      ->  DOM
```

`sim/` knows nothing about `render/` or `ui/`. `render/` knows nothing about
`sim/` — it is handed a plain state object each frame. `main.js` is the only
module that knows all three exist.

**Deciding between `shared/` and `client/src/sim/`:** ask whether a server
would need it to check a client's claim. Tree positions and glide physics —
yes, so they are shared. The squirrel's current state machine — no, that is
the client's own bookkeeping.

---

## Naming and style

- **ES modules everywhere**, `.js`, `"type": "module"`. No TypeScript (D-1);
  use JSDoc on anything whose shape is not obvious from the code.
- **Factory functions, not classes.** `createSimulation`, `createRenderer`,
  `createInteractionRegistry`. They return an object of methods and close over
  their state. There is no `new` in this codebase outside Three.js calls.
- **`create*` builds a thing that holds state; bare verbs are pure.**
  `stepGlide`, `resolveLanding`, `perchOn`, `deriveGlideProfile` all take
  arguments and return values, mutating nothing.
- **Pure functions return new objects.** `stepGlide` does not write into the
  motion it is given; a test asserts this.
- **Files are lower-kebab-case**, exports are `camelCase`, constant tables are
  `SCREAMING_SNAKE_CASE` and `Object.freeze`d.
- **Units are metres and seconds.** Angles are radians. A variable holding
  something else says so in its name (`durationMs`).
- **Comments explain why, not what.** Most existing comments justify a choice
  or warn about a trap. Add one where the next person would otherwise wonder
  why something is the way it is; skip it where the code already says it.

### Coordinates

Y is up. A heading of `h` means forward is `(sin h, 0, cos h)`, matching a
Three.js mesh with `rotation.y = h` whose model faces `+Z`. **Heading decreases
when the squirrel turns right** — screen-right is `-X` at heading zero. Get
this backwards and steering inverts; `headingVector` and its test are the
reference.

---

## Tuning versus stats

Two different things, kept apart on purpose in `shared/src/constants.js`:

- **`GLIDE_TUNING`** — the feel dials, global to the game. The tuning panel
  edits a mutable copy of these at runtime.
- **`BASE_GLIDE_STATS`** — per-player upgrade tiers from the product doc's
  upgrade tree. Phase 1 runs at tier 0 throughout.

`deriveGlideProfile(stats, tuning)` collapses both into the handful of numbers
the integrator uses. **Nothing below that function reads either object
directly.** That is what lets Phase 2 raise a player's tiers without touching
the physics. If you find yourself importing `GLIDE_TUNING` inside a step
function, add a field to the profile instead.

---

## Adding a new interactive element

The registry in `client/src/sim/interactions.js` is the extension point. Adding
a shop tree — or a puzzle, cafeteria, or customization tree — takes four steps
and touches no existing landing or glide code.

**1. Make sure the tree type exists** in `TREE_TYPES` (`shared/src/constants.js`).
The product doc's data model (§5.3) already names `scenery | shop | puzzle |
cafeteria | customization`, so most of the time it is already there.

**2. Have worldgen tag trees with it.** In `shared/src/worldgen.js`, destination
trees currently all become `LANDMARK`. Give the type a share of them:

```js
const type = isDestination ? pickDestinationType(rng) : TREE_TYPES.SCENERY;
```

Keep the overall destination share inside the doc's 10–15% band — a test
enforces it (D-8).

**3. Write the handler.** Its own module under `client/src/sim/`, exporting a
plain object with optional `onLand` and `onLeave`:

```js
// client/src/sim/shop.js
export const shopInteraction = {
  onLand({ tree, glider, emit }) {
    emit({ type: 'shop:opened', tree, stock: stockFor(tree) });
  },
  onLeave({ tree, emit }) {
    emit({ type: 'shop:closed', tree });
  },
};
```

Rules for handlers:
- **Emit events; do not touch the DOM.** Handlers live in `sim/`, so the same
  boundary applies. The UI subscribes via `simulation.on(...)` and renders.
- **Do not mutate the glider.** Treat the context as read-only. Anything that
  changes the squirrel's motion belongs in the state machine.
- **A missing handler is a no-op, never an error.** Most trees are scenery, and
  an unimplemented type must not be able to break the glide loop.

**4. Register it** in `createSimulation` (`client/src/sim/simulation.js`):

```js
interactions.register(TREE_TYPES.SHOP, shopInteraction);
```

Then add a test in `client/test/interactions.test.js` covering the handler
firing and the no-handler case, and — if the element changes what the tree
looks like — give it a canopy colour in `client/src/render/trees.js`.

**One warning for Phase 2:** the moment an interaction touches materials,
currency or upgrades, product doc §6.1 applies — the client sends an *intent*
and the server validates and commits. Do not let a handler mutate a balance
locally, however convenient it is while the server is still being written.

---

## Tests

`npm test` — Vitest, plain Node, no browser (D-9). Tests live in
`<package>/test/**/*.test.js`, mirroring the source layout.

What to test, and what not to:

- **Pure math** — thoroughly. Invariants over exact values: "a better tier
  glides further", "altitude never increases without lift", "the step does not
  mutate its input". Exact-value assertions turn every tuning tweak into a
  test failure.
- **The glide loop** — end to end, headlessly, through the shipped
  `createSimulation`. Never reimplement the loop in a test; drive the real one
  with a scripted input object, exactly as the browser does. The scripted pilot
  in `client/test/helpers/autopilot.js` is test-only scaffolding and must not
  be imported by anything under `src/`.
- **Determinism** — worldgen and the simulation are seeded and must stay
  reproducible. Never call `Math.random()` or read a clock inside `shared/src/`
  or `client/src/sim/`; take a seed or an injected clock.
- **Feel** — do not. The product doc is explicit (§7.4). The tuning panel and
  manual playtesting cover it.
- **Rendering** — not covered by automated tests. Verify visually. If you
  change camera framing, canopy placement or the squirrel mesh, actually look
  at it before pushing.

Before any PR: `npm run verify` (lint, test, build).

---

## Scope discipline

The roadmap in product doc §9 is phased so that each phase ends in something
playable, and Phase 1's job is a go/no-go on glide feel. Work belonging to a
later phase stays out even when it looks like ten minutes: economy, accounts,
persistence, multiplayer, puzzle content, the custom squirrel shader, the flap
move.

Where a later phase needs a *shape* to exist now — glide stats as a parameter,
the interaction registry, tree types in the data model — that shape is here and
empty. Filling it in is that phase's work, not this one's.

---

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature-slug>/` in this repo. See
[`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md).

### Triage labels

The five canonical roles, used verbatim: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
[`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).

### Domain docs

Single-context — one `CONTEXT.md` and `docs/adr/` at the repo root. See
[`docs/agents/domain.md`](docs/agents/domain.md).
