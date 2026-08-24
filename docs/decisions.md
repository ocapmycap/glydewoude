# Decision log

Every place the product document left room for interpretation during Phase 1,
what was chosen, and why. The standing instruction was: where the doc is
ambiguous, take the simpler option and record it. That is what happened, with
one exception noted below (D-11) where the simpler option would have made the
game unplayable.

Later phases are free to revisit any of these — that is the point of writing
them down rather than burying them in a diff.

---

## D-1 — Plain JavaScript, not TypeScript

**Ambiguity.** §5.1 says "vanilla JS or a minimal state layer"; §7.1 lists a
`/shared` directory for "shared types/constants"; §7.2 lists "type-check" as a
CI step. Those pull in opposite directions.

**Decision.** Plain ES modules with JSDoc annotations. No TypeScript, no build
step for the shared package, and the CI "type-check" leg is dropped in favour
of lint.

**Reasoning.** The simpler option, and the one §5.1 actually names. The doc is
explicit that Phase 1 should "prioritize iteration speed over structure at this
stage, refactor once mechanics stabilize". JSDoc gives editors most of the
same autocomplete without a compile step.

**Revisit when.** Phase 2 introduces a server and a shared economy schema. A
wrong shape in an upgrade table is the kind of bug types actually catch, and by
then the mechanics have stabilised enough for the refactor the doc anticipates.

---

## D-2 — No `/server` directory in Phase 1

**Ambiguity.** §7.1 gives a four-directory repo layout including `/server`.
Phase 1 has no persistence, no accounts and no multiplayer.

**Decision.** Ship `/client`, `/shared` and `/docs`. Create `/server` in
Phase 2, when there is something for it to do.

**Reasoning.** An empty directory with a placeholder `package.json` is not
structure, it is a promise. Phase 2 introduces Postgres, auth and server-side
validation together, and the server should be shaped by those requirements.

---

## D-3 — Pure glide math and worldgen live in `/shared`, not `/client`

**Ambiguity.** §7.1 describes `/shared` as "shared types/constants". Physics
and world generation are neither.

**Decision.** `shared/src/glide.js` and `shared/src/worldgen.js` sit in
`/shared` alongside the constants.

**Reasoning.** §6.1 requires the Phase 2 server to sanity-check material
collection "against glide-stat-implied maximum speed/positions". That check
needs this exact physics and these exact tree positions. Putting them in
`/shared` now costs nothing; moving them later means Phase 2 either
reimplements them and drifts, or does the move under deadline.

---

## D-4 — No flap, no wind, no weather

**Ambiguity.** §2.2 lists wind currents and a flap move under the glide
mechanic, then says they are "skill-expressive mechanics layered on top once
the base feel is solid". Phase 1 is specified as "basic glide physics".

**Decision.** Neither is implemented. `flapCharges` exists in the glide-stats
object so the shape is right, and is unused.

**Reasoning.** The simpler reading, and the one the phase description supports.
Phase 1's gate is whether the *base* glide feels good; adding a height-recovery
move before answering that question would mask a bad answer.

---

## D-5 — Landing is forgiving: no crash state, no failure

**Ambiguity.** The doc never says what happens when you miss.

**Decision.** There is no descent-rate limit and no death. The squirrel catches
bark at any speed, and touching the ground means scampering up the nearest
trunk. The only cost of a bad glide is the time it took.

**Reasoning.** Simplest possible rule, and it matches the "floaty and forgiving
rather than twitchy" pillar and the cozy positioning in §1. Phase 1 is
measuring whether gliding is fun; punishing failure adds a confound.

---

## D-6 — No trunk or canopy collision in flight

**Ambiguity.** Not addressed by the doc.

**Decision.** There is no blocking collision. Every contact with a tree's catch
volume is a landing, and you never bounce off anything.

**Reasoning.** Simplest option. Blocking collision in a game about threading
between trunks needs recovery states, bump physics and a camera that copes with
being shoved — a lot of machinery in service of punishing the player.

---

## D-7 — Direct real-money cosmetics deferred entirely; no currency of any kind

**Ambiguity.** §3.1 asks for an early decision on hard currency versus direct
purchases.

**Decision.** Not decided, because nothing in Phase 1 needs it. No currency,
no materials, no prices.

**Reasoning.** §10 recommends deferring the call to Phase 3 "when real
cosmetics exist to sell". Deciding now would mean deciding without evidence.

---

## D-8 — 12% destination trees

**Ambiguity.** §2.3 gives a 10–15% band and flags the number as a scope control
to revisit.

**Decision.** 12%, at the middle of the band, enforced by a test that fails if
generation drifts outside 8–18%.

**Reasoning.** Mid-band is the choice that assumes least. The test exists so
that a worldgen change moving the ratio is a deliberate act rather than a
side effect.

---

## D-9 — Vitest and Node only; no browser-driven test

**Ambiguity.** §7.2 asks for a "basic smoke test" on PR without naming a tool.

**Decision.** Vitest running in plain Node. No Playwright, no jsdom, no
headless-browser test in the committed suite.

**Reasoning.** A browser-driven test needs a browser binary downloaded at
install time, which conflicts with the requirement that the project build and
run from a clean clone. What it would buy — "a canvas element exists" — is
worth much less than the headless simulation tests, which exercise the actual
glide loop. The renderer was still verified manually in headless Chromium
during development; that is a development activity, not a committed dependency.

---

## D-10 — Flat ground

**Ambiguity.** §2.3 mentions landmarks including a waterfall and a lake, and
implies terrain relief.

**Decision.** The forest floor is a flat disc. Height variation comes entirely
from the trees.

**Reasoning.** Simplest option, and the trees already provide all the vertical
structure the glide needs. Terrain relief is a Phase 4 concern, arriving with
the additional zones and the art pass.

---

## D-11 — Catching a trunk mid-height climbs you to the perch

**Ambiguity.** The doc's core loop is "glide → land on a tree → ... → reach
previously-unreachable trees". It never says how altitude is regained, and in
Phase 1 there are no upgrades, no flap and no wind.

**Decision.** A tree catches the squirrel anywhere on its upper trunk or in its
canopy, and the squirrel then climbs to the perch at the top. Aiming low at a
tall tree is therefore how you gain height.

**Reasoning.** *This is the one place the simpler option was rejected.* The
simpler rule — you can only land on a perch you are already above — makes the
game terminate: every glide loses altitude, so within a few hops the squirrel
is on the forest floor with nowhere to go, and Phase 1 cannot answer its own
question. Every alternative fix was more complex, not less: a flap move (a
later-phase mechanic, D-4), thermals, or an explicit climb control with its own
input and animation. Catching bark and scampering up is one conditional in
`landing.js`, needs no new input, and is what an actual squirrel does.

It also creates the route-planning the doc wants from soft gating: a tall tree
is an altitude station, and "can I reach that one before I sink below its lowest
branches?" is a real decision. The smoke test asserts five consecutive mid-air
catches specifically to prove the loop sustains itself.

---

## D-12 — Development tuning panel ships in the build

**Ambiguity.** Not addressed by the doc.

**Decision.** The glide-tuning sliders are in the deployed prototype, behind
the T key, rather than stripped from production builds.

**Reasoning.** Phase 1's deliverable is a shareable link whose purpose is
collecting opinions on feel. A playtester who can say "it was better at 7.0"
is worth more than one who can only say "it felt floaty". There is nothing to
protect: no economy, no accounts, no server. It should be removed when Phase 2
introduces an economy, because by then the same sliders would be a cheat menu.

---

## D-13 — Inverted-hull outlines by uniform scaling

**Ambiguity.** §5.1 asks for inverted-hull outlines without specifying the
technique.

**Decision.** The hull is the same geometry scaled up ~3.5% and drawn
back-faces-only. On non-uniformly scaled instances (a tall thin trunk) this
makes the outline proportionally thinner across than along.

**Reasoning.** Simplest implementation, and at this art scale the variance is
not noticeable. The alternative — a custom view-space normal-offset shader — is
exactly the kind of work §5.1 reserves for the Phase 4 art pass.

---

## D-14 — Forest is a single flat-shaded instanced batch

**Ambiguity.** Not addressed.

**Decision.** The entire forest is four `InstancedMesh` draws (trunks,
canopies, and an outline hull for each) rather than a mesh per tree.

**Reasoning.** Marginally more code than the naive version, but §10 flags viral
traffic spikes as the expected shape of success, and those arrive on whatever
phone is nearest. Four draw calls instead of ~750 is worth ten lines.
