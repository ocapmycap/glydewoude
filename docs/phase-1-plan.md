# Phase 1 Implementation Plan — "Prove the glide"

Scope reference: [`glidewood-product-doc.md`](./glidewood-product-doc.md) §9, Phase 1.

> **Phase 1 deliverable (verbatim from the product doc):** one small forest
> area, basic glide physics, no persistence, no accounts. A playable prototype
> on a shareable link, no save state. The gate it exists to answer: *does the
> movement feel good?*

Everything below is bounded by that. Where the doc describes a system that
belongs to Phase 2+, this plan says so explicitly and leaves it out.

---

## 1. What ships

A browser page that loads a small stylized forest, drops you on a launch
branch, and lets you glide from tree to tree until you decide to stop:

1. **Perch** on a tree platform.
2. **Launch** (space) into a glide.
3. **Steer** in the air — camera-relative, momentum-carrying, floaty.
4. **Land** on another tree platform (or the forest floor, which is a soft
   reset back to the nearest perch).
5. Repeat, with a HUD reading out the numbers that make glide feel tunable
   (speed, altitude, glide ratio, distance of last glide).

Plus: a live tuning panel for the glide constants, because Phase 1's entire
job is iterating on feel, and the doc calls the glide-feel loop "the most
iterated-on system" (§7.3).

## 2. What is deliberately *not* in Phase 1

| Deferred | Belongs to | Why it is out |
|---|---|---|
| Materials, currency, collection | Phase 2 | Economy is Phase 2; §6.1 requires server validation the moment it exists |
| Shop / upgrades / upgrade tree | Phase 2 | Same |
| Accounts, save/load, Postgres, REST API | Phase 2 | "no persistence, no accounts" |
| WebSocket presence, remote squirrels | Phase 3 | Explicit Phase 3 line item |
| Puzzle / cafeteria / customization trees | Phase 3–4 | Content phases |
| Multiple zones gated by glide stats | Phase 4 | "one small forest area" |
| Custom GLSL squirrel shader, rim light | Phase 4 | §5.1 reserves it until the core loop is validated |
| Flap move, wind currents, weather | Phase 2+ | §2.2 layers these on "once the base feel is solid"; Phase 1 is *basic* glide physics |
| Server, `docker-compose`, seed scripts | Phase 2 | Nothing to persist or validate yet |

The upgrade *tables* (glide-stat tiers) are also out — but the physics is
written so that glide stats are an **input parameter object**, not hardcoded
constants, so Phase 2 can feed it upgraded values without touching the
integrator. That is a shape decision, not Phase 2 work.

## 3. Stack

Exactly as specified in the product doc §5.1 / §7.1 / §7.3:

- **Three.js** for rendering, low-poly geometry
- **`MeshToonMaterial` + inverted-hull outlines** for the forest
- **Vanilla JS**, no framework, no state library
- **Vite** dev server + build
- **Vitest** for the deterministic unit tests the doc asks for (§7.4)
- **ESLint** for the lint leg of CI (§7.2)
- npm workspaces monorepo: `/client`, `/shared`, `/docs`

No `/server` directory in Phase 1 — there is no server to write. It gets
created in Phase 2 when persistence arrives.

## 4. Repo layout

```
/client                      Three.js frontend (the only runnable app)
  index.html
  vite.config.js
  src/
    main.js                  bootstrap: build world, wire sim + renderer + input, start loop
    sim/                     PURE simulation — no Three.js import anywhere in here
      world.js               runtime world state built from the shared layout
      glider.js              squirrel state machine: perched -> gliding -> landed
      landing.js             perch/ground collision resolution
      interactions.js        interactive-element registry (see §7)
      loop.js                fixed-timestep accumulator loop
      input-state.js         plain intent object { steer, pitch, launch }
    render/                  ALL Three.js lives here
      renderer.js            scene, lights, sky, resize, render()
      materials.js           toon palette + inverted-hull outline helper
      trees.js               tree + platform meshes
      squirrel.js            squirrel mesh (low-poly, toon)
      follow-camera.js       camera-relative chase cam
    ui/
      hud.js                 speed / altitude / glide ratio / last glide distance
      tuning-panel.js        live glide-constant sliders
      input.js               DOM listeners -> input-state intent object
  test/
/shared                      things a future server will also need
  src/
    constants.js             glide tuning defaults, base glide stats, world config
    rng.js                   deterministic seeded PRNG (mulberry32)
    glide.js                 pure glide math: step(), glideRatio(), applyGlideStats()
    worldgen.js              deterministic forest layout from a seed
  test/
/docs
```

**Why `glide.js` and `worldgen.js` live in `/shared` and not `/client`:**
§6.1 says the server must eventually sanity-check collection against
"glide-stat-implied maximum speed/positions". That check needs the same
physics and the same tree positions the client used. Putting them in
`/shared` now costs nothing and is the difference between Phase 2 reusing
them and Phase 2 reimplementing them.

## 5. Glide model

Physics-lite, per §2.2 — not a real aerodynamic sim. Fixed 60 Hz timestep so
it is deterministic and testable:

- Velocity carries momentum; heading turns toward the steer input at a
  rate bounded by `turnRate` (from glide stats) — no instant direction change.
- Vertical: gravity pulls down; the glide surface converts forward speed into
  lift, expressed directly as a **glide ratio** — horizontal distance per unit
  of altitude lost — which is the number the doc names and the number the
  upgrade tree tunes.
- Pitch input trades altitude for speed (dive) or speed for altitude (flare),
  bounded, so diving to cross a gap is a real choice.
- Air drag pulls speed toward a stat-derived terminal cruise speed, so the
  glide settles into a readable steady state rather than accelerating forever.
- Landing: if the squirrel's position crosses a perch volume with a survivable
  descent rate, it perches. Ground contact returns it to the last perch.

All of it is a pure function `step(state, input, stats, tuning, dt) -> state`.
No globals, no `Math.random`, no `performance.now` inside it.

## 6. Test approach

Per §7.4 — thin, deterministic, on the pure math; feel stays manual.

1. **Unit tests (`shared/test/glide.test.js`)** — glide ratio math, that
   better stats produce a strictly longer glide, that turn rate is bounded,
   that a step is deterministic for a given seed/state, that altitude is
   monotonically non-increasing without a lift source.
2. **Worldgen tests** — same seed gives the identical forest; trees do not
   interpenetrate; at least one destination tree is reachable from spawn with
   base stats and one is not (that is the soft gate, in miniature).
3. **Smoke test (`client/test/glide-loop.smoke.test.js`)** — the required
   headless test covering the *core glide loop*: build the seeded world,
   perch the squirrel, issue a launch intent, run the fixed-step loop with
   scripted steering input for a bounded number of ticks, and assert the
   squirrel ends **perched on a different tree** than it started on, having
   passed through the `gliding` state. Pure Node, no DOM, no WebGL, no
   browser — it imports `client/src/sim/**` and `shared/src/**` only.

This is exactly why rendering is quarantined in `client/src/render/`: the
loop is testable because nothing in it touches Three.js.

No Playwright / browser-driven test in Phase 1 — it would require downloading
a browser binary on a clean clone, which conflicts with the "builds and runs
from a clean clone" requirement for the cost of asserting a canvas exists.

## 7. Interactive elements

Phase 1 has one interaction kind: **`landmark`** — a destination tree that
announces itself when you land on it. That is §2.3's orientation aid (the
great tree, the waterfall overlook), not §2.4's economy content. Shops,
puzzles, cafeterias and customization trees are Phase 2–4 and are not
implemented.

But the *registry* they will plug into is built now, because it is three
functions and it is what stops Phase 2 from bolting shops onto the landing
code path:

```js
// client/src/sim/interactions.js
registerInteraction('landmark', {
  onLand(ctx) { ... },   // fired once when the squirrel perches
  onLeave(ctx) { ... },  // fired when it launches away
});
```

Trees carry a `type` matching the doc's data model (`scenery | shop | puzzle |
cafeteria | customization`), and worldgen tags roughly 12% as destination
trees — inside the doc's 10–15% band (§2.3). In Phase 1 every destination
tree resolves to `landmark`; the type field is populated so Phase 2 has real
data to switch on. Landing on a tree with no registered handler is a no-op,
not an error.

## 8. Build & run from a clean clone

```
npm install      # workspace install, root only
npm run dev      # vite dev server, hot reload
npm test         # vitest, headless
npm run lint     # eslint
npm run build    # static bundle -> client/dist
npm run preview  # serve the built bundle
```

`npm run build` output is a plain static directory — that is the "shareable
link" deliverable, droppable on Vercel/Netlify/Cloudflare Pages per §5.4.

A GitHub Actions workflow runs install + lint + test + build on PRs, matching
the CI leg described in §7.2 (minus type-check, see the decisions log).

## 9. Deliverables checklist

- [ ] `docs/phase-1-plan.md` (this file), committed first
- [ ] Product doc relocated into `/docs` per §7.1
- [ ] Workspace scaffold: root, `/client`, `/shared`
- [ ] `/shared`: constants, seeded RNG, pure glide math, worldgen
- [ ] `/client/src/sim`: world, glider state machine, landing, interactions, loop
- [ ] `/client/src/render`: toon materials + outlines, trees, squirrel, camera, renderer
- [ ] `/client/src/ui`: input, HUD, tuning panel
- [ ] Unit tests + headless core-glide-loop smoke test, passing
- [ ] ESLint config, CI workflow
- [ ] `README.md` — run from scratch
- [ ] `docs/decisions.md` — every ambiguity resolved, with reasoning
- [ ] `CLAUDE.md` — conventions for later sessions
- [ ] Verified: clean clone -> install -> lint -> test -> build all succeed
