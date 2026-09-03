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

---

## D-15 — Materials are collected by landing, not by flying through them

**Ambiguity.** §2.1's loop is "glide → land on a tree → interact (collect / …)".
It does not say whether materials are picked up in the air or on arrival.

**Decision.** A cache is claimed by perching on the tree that holds it. There
are no mid-air collectibles.

**Reasoning.** The simpler option, and it reuses a landing the player already
had to earn. Mid-air motes would need a second proximity system in the step
loop, a second tuning surface for pickup radius, and would pull attention away
from the line you are flying — which is the thing Phase 1 established as the
point of the game. The §2.1 wording puts collection after landing anyway.

---

## D-16 — Cache placement is derived from the world seed, in `/shared`

**Decision.** `shared/src/materials.js` generates caches deterministically from
the world's seed, in the same package as worldgen and the glide math.

**Reasoning.** Straight extension of D-3. §6.1 requires the server to validate
collection claims, which means it must know what was collectable and where. A
seed-derived layout means both sides compute the same answer without shipping a
table over the wire or trusting the client's account of it.

The material RNG is salted off the world seed rather than sharing its stream,
so retuning cache placement cannot silently move every tree. A test covers
this.

---

## D-17 — The client raises intents and never holds a balance

**Ambiguity.** §6.1 requires server-side validation of material collection.
The server does not exist yet.

**Decision.** Collection produces an *intent* — which cache, at what position,
at what point in the run, after what glide — pushed onto a pending queue. The
ledger's `confirmed` totals start at zero and can only be written by
`settle()`, which is the shape a server transport will drive. What the UI can
show is `provisionalTotals()`: confirmed plus in-flight, documented as display
only.

**Reasoning.** CLAUDE.md warns about exactly this: "Do not let a handler mutate
a balance locally, however convenient it is while the server is still being
written." A local counter would work fine today and would be genuinely hard to
remove later, because by then the UI, the shop and the save format would all be
reading it. Building the intent shape first costs one indirection now and
nothing later.

`settle()` *replaces* the confirmed totals with the server's number rather than
adding to them — if the server disagrees with what the client claimed, the
server is right by definition, and adding would let a bad client keep its
inflated figure.

---

## D-18 — Rarity is gated by how hard a tree is to reach

**Ambiguity.** §3.3 asks that "rare materials gate the best upgrades behind
actual skill/puzzle completion, not pure grind". There are no puzzles yet.

**Decision.** Each tree gets an `effort` score from its distance from spawn and
its height, and rare materials are weighted toward high-effort trees. Berries
(the rarest) do not appear on the easiest third of trees at all.

**Reasoning.** Reach is the only skill expression Phase 2 has — puzzles are
Phase 3. Distance and height are exactly what a better glide ratio buys, so
this also makes the upgrade tree feel like it opens up the map, which is §2.3's
soft gating. Both inputs are recomputable from the world, so the server can
check a claim's plausibility against the same numbers.

Effort is normalised against the forest's actual range rather than an absolute
divisor. That is not cosmetic: with a fixed divisor every tree in the default
forest scored above 0.6, the rare-material boost applied everywhere at once,
and berries came out at 13% even beside the spawn. Tests assert the gradient
rather than the exact mix.

---

## D-19 — One cache per tree, claimed once per run

**Decision.** A tree carries at most one cache, and claiming it marks it spent
for the rest of the run. A cache whose intent the server *rejects* stays
claimed.

**Reasoning.** Simplest rule that stops a player farming one convenient tree by
relaunching and re-landing. Keeping rejected caches claimed is deliberate: if
rejection freed the cache, a client whose claims are being refused would be
invited to retry the same one in a loop, which is the opposite of what a
rejection means.

Respawning does not reset the ledger — `reset()` exists for a future new-run
boundary, but pressing R is a convenience, not a fresh run.

---

## D-20 — No rendering or HUD for materials in this change

**Decision.** This work stops at `shared/src` and `client/src/sim`. Caches are
not drawn and totals are not displayed.

**Reasoning.** Scope boundary, not an oversight. Several sessions are working
on Phase 2 in parallel and `client/src/render` and `client/src/ui` are heavily
shared; claiming them here would collide. Everything a renderer or HUD needs is
already exposed and needs no change to this code: `simulation.collection.caches`
for what to draw, the `material:collected` event for feedback,
`provisionalTotals()` and `hasUnconfirmed` for a display that can be honest
about what is and is not confirmed.

---

## D-21 — The server is `node:http` and `pg`, with no framework

**Ambiguity.** §5.2 asks for "a small REST or RPC layer" without naming a
stack.

**Decision.** Node's built-in `http` module, a thirty-line router, and `pg`.
No Express, no Fastify, no ORM, no migration tool.

**Reasoning.** Nine endpoints do not justify a framework, and the parts a
framework would have supplied — routing and body parsing — are the least
security-sensitive parts of this server. What actually matters here is
parameterised SQL, hashed tokens, rate limiting and validation, and a
framework would not have done any of those for us. §6.5 also asks for
dependency scanning, and the cheapest dependency to audit is the one that is
not there.

The trade is real: request parsing is ours to get right, so the body reader
caps its size before buffering and refuses anything that is not a JSON object.

---

## D-22 — No Zone or Tree tables

**Ambiguity.** §5.3's data model lists `Zone` and `Tree` tables.

**Decision.** Neither exists. The server regenerates the forest and its caches
from the world seed, exactly as the client does.

**Reasoning.** D-3 and D-16 already made the world seed-derived so that both
sides agree without syncing. Storing trees as well would create a second
source of truth that could drift from the one the physics actually uses, and a
migration burden every time worldgen is retuned. The data model is described
as illustrative; this is the same model with the derivable part left derived.

The player's `world_seed` is stored, so a future forest change does not
silently invalidate existing saves.

---

## D-23 — Materials are rows and stats are columns, not JSON blobs

**Ambiguity.** §5.3 sketches `glide_stats {}` and `materials {}` as nested
objects.

**Decision.** `player_materials` is a table keyed by (player, material), and
the four upgrade tiers are integer columns with `CHECK (>= 0)`. The API still
presents both as objects, so the doc's shape is what clients see.

**Reasoning.** §5.2 chooses Postgres over SQLite specifically because of
concurrent writers. A JSON blob forces read-modify-write for every purchase,
which is exactly the pattern that loses an update under concurrency. With
rows, a debit is `UPDATE ... SET amount = amount - $1 WHERE amount >= $1` —
one statement that is atomic, refuses to go negative, and needs no lock. Two
concurrent purchases cannot both succeed, and a test asserts it.

---

## D-24 — Accounts are a token, with no password and no social login

**Ambiguity.** §9 asks for "player accounts" in Phase 2. §6.2 says use
session or JWT auth and, for social login, "keep scope minimal".

**Decision.** Registering creates a player and returns an opaque random token.
Whoever holds the token is the player. No password, no email, no OAuth.

**Reasoning.** The Phase 2 deliverable is "a loop that persists across
sessions", and a bearer token delivers exactly that. Passwords bring reset
flows, email delivery and credential storage; social login brings a provider
integration and its consent screens. Neither protects anything yet — there are
no purchased cosmetics to steal until Phase 3.

Tokens are stored as SHA-256 hashes, so the database never holds anything
usable (§6.5), and sessions are revocable, which is the reason for choosing
opaque tokens over JWTs.

**Revisit when.** Real-money cosmetics exist. At that point an account is worth
stealing and needs a recovery story.

---

## D-25 — Prices live on the server, not in `/shared`

**Ambiguity.** Upgrade costs are game data, and `/shared` is where game data
has lived so far.

**Decision.** The catalogue and its prices are server-side. Clients read them
from `GET /api/shop/catalog`.

**Reasoning.** §6.1 makes the server the only authority on cost. A price table
shipped to the browser is either redundant or, if anything trusts it, a thing
to be edited. Keeping it server-side also means prices can be retuned without
shipping a client build.

---

## D-26 — Tests run on pg-mem by default and real PostgreSQL on demand

**Ambiguity.** §7.4 asks for integration tests on transaction validation and
"can the client cheat this" cases. §7.3 wants dev to match production.

**Decision.** The suite runs the real schema and real SQL against pg-mem with
no service required, and the identical suite runs against PostgreSQL when
`DATABASE_URL` is set. A separate CI job runs the latter.

**Reasoning.** Server tests that need a database daemon would either break the
existing single-job CI or get skipped, and skipped tests are worse than absent
ones. pg-mem executes the actual SQL, so it catches far more than mocks would.

Two things it cannot do, both covered in the PostgreSQL job and marked in the
source: it cannot parse the plpgsql of the append-only trigger, and it does not
isolate concurrent transactions, so it cannot demonstrate that a duplicate
claim pays out once. Both guarantees are real — this is a limitation of the
emulator, not of the code — and finding that out was worth the extra job.

---

## D-27 — Position anchoring, and why the travel allowance is small

**Ambiguity.** §6.1 permits client-reported position but asks for plausibility
checks "given last known position/time".

**Decision.** The server stores a position anchor, written on every validated
collection and on explicit position saves. A claim is refused when the distance
from the anchor exceeds `graceMetres + (elapsed + graceSeconds) × topSpeed`,
where top speed comes from the player's own upgrade tiers.

**Reasoning.** Bounding horizontal speed catches teleports and speed hacks,
which is what §6.3 asks for, without pretending to judge whether a line was
optimal. Altitude is deliberately not bounded: climbing a trunk is free height
by design (D-11), so a vertical bound would flag ordinary play.

The grace is split into a flat distance and a small time allowance for a
reason found the hard way. The first version used a single 15-second grace,
which at top speed buys about 576 metres — wider than the entire forest, so no
teleport was detectable and the check was decorative while appearing to work.
A unit test now asserts the allowance stays smaller than the map.
