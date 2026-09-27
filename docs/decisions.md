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

---

## D-28 — A run score is client-reported

**Ambiguity.** §6.1 makes the server the authority on anything the client
claims. A run score is a number the client computes about its own play, which
sounds exactly like the thing §6.1 exists to distrust.

**Decision.** The client computes the score and the server stores what it is
sent, updating a player's best only when the new score beats it. The server
does not recompute the run.

**Reasoning.** The same reasoning as `last_position` in `001_init.sql`: a
spoofed value is cosmetic. A run score buys nothing, unlocks nothing, and is
compared against nobody — run mode has no leaderboard by design, so the only
person a cheated score deceives is the person who cheated it.

Recomputing it properly would mean the client streaming its whole flight path
for the server to re-simulate, which is a large amount of machinery to protect
a number with no value attached.

The scoring maths still lives in `shared/src/run.js` rather than in
`client/src/sim/`, so a server that later needs to check a run imports the same
functions the client used instead of reimplementing them.

**Revisit when.** A run pays out materials, currency or an unlock, or a
leaderboard exists. Either one gives the score value, §6.1 applies in full, and
this decision has to be reopened.

---

## D-29 — The best run is four columns on `players`, not a `runs` table

**Ambiguity.** D-28 settles that the server stores what the client reports. It
does not say how much of it to keep: every run, or only the best one.

**Decision.** `players` gains `best_run_score`, `best_run_chain`,
`best_run_distance` and `best_run_at`. No run history is stored, and the
submitted `durationMs` is validated and then discarded.

**Reasoning.** Nothing reads a history. There is no leaderboard, no replay and
no payout (D-28), so a `runs` table would be a table that only ever grows and
is only ever collapsed to a single `MAX(score)`. Storing the aggregate
directly makes the write one conditional `UPDATE ... WHERE best_run_score <
$1` — the same shape as the conditional debit in the purchase path, and the
same guarantee: two runs finishing at once cannot both win, and the lower of
the two cannot land second and overwrite the higher.

A tie is deliberately not an improvement. That is what makes a replayed
request a no-op rather than a way to bump `best_run_at` forward.

Chain and distance travel with the score instead of being compared column by
column, so the stored best is one real flight rather than a composite
assembled from three different ones.

`durationMs` is bounded like the rest and then dropped because nothing shows
it — the HUD has three numbers and this is not one of them. It stays in the
request body so that a later "longest run" needs no client change.

**Revisit when.** A run history is worth showing — a graph of your last twenty
runs, or a per-session summary. That is a `runs` table and a migration that
backfills the current best as a single row.

## D-30 — The tree you scamper up after a fall scores nothing

**Ambiguity.** Ground contact produces a `glide:landed` event like any other,
carrying a real tree and a real glide distance — `landing.js` puts the squirrel
on the nearest trunk. Run mode could treat that as one last link in the chain
before ending it, or as no link at all.

**Decision.** A landing with `reason === 'ground'` ends the run and adds
nothing. Only `reason === 'perch'` calls `extendRun`.

**Reasoning.** The whole point of run mode is that aiming has a consequence.
Paying for the recovery trunk would mean a player who aims at nothing still
banks the distance they fell across, which is the same score a player who
actually caught the tree would get — the two outcomes would be worth the same
again, and that is the state run mode exists to leave behind.

It also keeps the cosy rule honest in the other direction. Nothing is taken
away when a run ends, so the ending needs no compensation to feel fair.

---

## D-31 — The run tracker returns events; `createSimulation` emits them

**Ambiguity.** `client/src/sim/` has two patterns for a stateful module that
needs to tell the UI something. Interaction handlers are handed an `emit` and
call it themselves; `createCollectionLedger.collectAt` returns an intent and
lets its caller emit.

**Decision.** `createRunTracker` follows the ledger: `start`, `extend` and
`end` each return an event object or `null`, and `createSimulation` emits what
comes back.

**Reasoning.** Three parallel branches subscribe to these events, so the order
a subscriber sees `glide:landed`, `run:extended` and `material:collected` in is
part of the contract. Every `emit` call for those three sits in one function in
`simulation.js`, where that order can be read off the page instead of
reconstructed across two modules.

The cost is one line of ceremony at each call site — `if (event) emit(event)` —
and a tracker that cannot raise an event nobody asked it for. Both seemed worth
it. The `emit`-passing pattern stays the right one for interaction handlers,
which fire at moments their caller does not otherwise care about.

## D-32 — The run sync seeds its best from the session and hands it on by subscription

**Ambiguity.** T5 says to skip a run that "cannot beat the best the server
already returned" and to hand the best "to whatever displays it", but not where
the first known best comes from, whether a tie can beat it, or how the display
gets it. It also allows only one wiring line in `main.js`.

**Decision.** `createRunSync({ session, simulation })` starts from
`session.player.bestRun`, which `/api/player/me` and register already return.
A run is posted only if its score is strictly greater than that best, matching
the server's `best_run_score < $2`. The sync subscribes itself to `run:ended`,
so `main.js` needs one line, and it exposes `best` plus `onBest(listener)` for
the run HUD (T4) to read.

**Reasoning.** Seeding from the session means the local check works on the
first run after a reload, not only after the first post. A tie cannot win on
the server, so posting one would waste the request the ticket says to save. A
subscription rather than a constructor callback means T4 can attach to the
sync without editing the line that builds it, which keeps the `main.js`
conflict the ticket expects small.

## D-34 — The run HUD names the sync, keeps a session best, and skips unbankable runs

**Ambiguity.** T4 asks for "your best" and a verdict on whether the run beat
it, but T5's sync only learns a best from the server, and the `main.js` line
that builds it discarded the return value. The ticket also does not say what a
one-landing run shows when it ends, or whether a respawn counts.

**Decision.** `main.js` now keeps the sync as `const runSync = createRunSync(...)`
— a change to T5's line rather than a pure append, because there was no other
way to reach `best` and `onBest`. The HUD shows the higher of the sync's best
and a best it keeps for this session, so offline play still has a best that
simply does not survive a reload. A run below `minChainToBank` updates the
counters but raises no end card and never counts as a best, matching
`isBankable` in the sync. Ground and respawn endings both get the card; only
the title differs ("run over" or "home again").

**Reasoning.** The session best is a `Math.max` over final scores the
simulation already computed, so the HUD still does no run arithmetic. Using
`isBankable` for the card means the HUD and the server agree on what counts as
a run. The verdict is judged against the best known *before* the run ended —
the sync's server round-trip resolves later and can only raise the best, which
`onBest` then shows.

## D-36 — `extend` returns a list of run events, and milestones carry no reward

**Ambiguity.** LAN-518 asks the run tracker to return `run:milestone`
"alongside" `run:extended`, but D-31 has `extend` returning one event or
`null`. The ticket also says each threshold fires once per run without saying
where that is remembered.

**Decision.** `extend` now returns an array: empty when no run is going,
otherwise `run:extended` followed by `run:milestone` when the new chain equals
a value in `RUN_TUNING.milestoneChains`. `createSimulation` emits the array in
order. `start` and `end` keep D-31's event-or-`null` shape. The tracker
remembers which thresholds a run has fired and forgets them when the next run
starts. A milestone event carries the run and the chain, and nothing else.

**Reasoning.** D-31's point was that every run `emit` sits in one function so
the order is readable there. A list keeps that: `run:milestone` can only come
out right after the extension that caused it. A separate `checkMilestone` call
would have put that ordering back on the caller. Chains only grow by one per
landing, so "exactly a threshold" already fires each once per run. The
remembered set guards against a future rule that lets a chain repeat a
length. No `points` field keeps the milestone from becoming currency (D-28).

## D-38 — Tree detail rides on the existing instances, not new meshes

**Ambiguity.** LAN-519 offers two ways to break up the canopy (jitter the
geometry, or add smaller leaf clusters) and says the forest must stay "a
handful of draw calls" without saying whether new instanced meshes count.

**Decision.** Both, with no new draw calls. The shared canopy icosahedron has
its corners pushed in or out by up to 18%, seeded from a fixed string, keyed by
position so the mesh and its outline hull stay closed. Each tree also gets four
smaller leaf tufts around its rim, drawn as extra instances of the canopy mesh
in a slightly lighter shade. Bark is one 64×128 canvas texture of near-white
vertical grooves, used as the trunk material's `map` so the per-instance bark
colour still sets the hue and `MeshToonMaterial` still bands the lighting.
Canopy and bark colour, tuft placement and blob spin come from an RNG seeded
with `hashSeed('render:' + tree.id)`. The world seed's own stream is not used,
so render-only variety can never shift worldgen. Destination canopies drift at
most 25% toward green, so they still read as gold from the air. Tufts and
jittered corners reach a little past `canopyRadius`. That changes the drawing
only: perch and catch radii are untouched.

**Reasoning.** The instance count grows with the forest, but the draw-call
count stays at four. Seeding from the id rather than the array index keeps a
tree's look stable if worldgen later inserts or reorders trees.

## D-40 — Structures ride the world rng after the trees, relative to the trunk base

**Ambiguity.** LAN-520 asks for drey and platform placement drawn from the
seeded worldgen RNG, "relative to the tree", but does not say where in the rng
stream to draw them, what point the offset is measured from, or what "inside or
just under the canopy" means as numbers.

**Decision.** `generateForest` builds every tree exactly as before, then makes
one more pass in tree order and gives each destination tree its `structures`
from the same rng, continuing its stream. Scenery trees get `[]` and draw
nothing. `offset` is measured from `tree.position`, the trunk base, so the
renderer places a structure at `position + offset`. Horizontally it sits
between 25% and 70% of `canopyRadius` from the trunk. Vertically it sits
between 10% and 45% of `canopyDepth` below the perch. `rotation` is a
yaw in [0, 2π). Destination trees get one or two structures of either kind,
evenly. The great tree's first structure is always a platform.

**Reasoning.** Drawing inside the construction loop would shift every later
tree's height, radius and destination roll, so the whole forest would change
for a decoration. Doing it afterwards keeps the layout, the D-8 share and
every existing test as they were. The vertical band uses `canopyDepth`, which
`WORLD_CONFIG` already matches to how far the drawn foliage hangs, so a
structure is never floating above the leaves or buried near the ground. Structures are data only.
`perchRadius`, `catchRadius` and landing do not read them.

## D-42 — The leaf burst is one pooled InstancedMesh that keeps its own clock

**Ambiguity.** LAN-521 asks for pooled leaves, reused geometry and material,
and only one import and one wiring line in `main.js`. It does not say how the
effect advances each frame, since `renderer.render` is not handed events and
`main.js` should not grow a per-frame call for it.

**Decision.** `client/src/render/leaf-burst.js` allocates four burst slots of
sixteen leaves as one `InstancedMesh` plus its outline hull, once. A landing
claims the oldest slot and rewrites its leaves. The effect steps itself from
the leaf mesh's `onBeforeRender`, timed by `performance.now()`. When no leaf
is live, it parks every instance at zero scale and skips the step. The meshes
stay visible so their shaders compile at load, not on the first landing. `main.js` builds it from `renderer.scene` and
forwards `glide:landed` events whose `reason` is `'perch'`. Ground landings get
no burst. The squirrel missed, and the tree it scampers up was not caught
(the same reasoning `simulation.js` uses for the chain). Leaf colours come
from a local `createRng` stream, never from sim state.

**Reasoning.** A fixed pool means ten rapid landings cost the same two draw
calls and no allocations. A fifth landing within about a second recycles the
oldest puff, which by then is mostly gone. Self-timing keeps `renderer.js`
and the loop untouched. The wiring is one import and two lines, a
`createLeafBurst` call and a `simulation.on` filter, because `render/` must not
know sim event names.

## D-43 — Leaves "fade" by shrinking, not by opacity

**Ambiguity.** The issue says the leaves "drift down and fade over about a
second". `MeshToonMaterial` has one opacity per material, not per instance,
so the leaves of an instanced burst cannot fade out individually.

**Decision.** Each leaf lives 0.8–1.15 s. It pops in over its first 80 ms and
shrinks to nothing over the last 45% of its life. The material stays opaque.

**Reasoning.** Shrinking reads as fading at this size and keeps the toon look
and the outline hull intact. A transparent material would need a custom
shader for per-instance alpha, and it would also cause sorting artefacts
against the canopy.

## D-44 — The great tree is its own mesh, drawn in `great-tree.js`

**Ambiguity.** LAN-522 allows the great tree to be drawn in `trees.js` or in a
new module. It also leaves open whether the instanced forest should still keep
a slot for it underneath the new drawing.

**Decision.** `createForest` leaves the spawn tree out of the instanced meshes
and adds `createGreatTree(tree, { barkTexture })` to the forest group. The
great tree has a twisting trunk with a lobed root flare, 1.3× thicker than
its worldgen radius, and a canopy of four flattened cones that narrow as they
go up. The top tier's apex sits about 1.2 m below `perchY`, so the spawn
camera stays clear of the foliage. The trunk's outline hull scales across the
trunk only, so it cannot rise above the perch. Perch and catch radii come from
worldgen and are unchanged.

**Reasoning.** A separate module keeps `trees.js` about the instanced forest.
The great tree costs about ten extra draw calls, once. `renderer.js` is
unchanged because the forest group still holds everything. Tiered cones give
an outline that no blob tree has, so the tree can be recognised by shape
alone.

## D-45 — `PALETTE.greatAccent` is a warm russet used only by the great tree

**Ambiguity.** The issue suggests an optional warm accent colour from
`PALETTE`, used nowhere else, but no such entry existed.

**Decision.** Added `greatAccent: 0xc8643a` to `PALETTE`. Each canopy tier
mixes canopy green toward it, and the top tier is the warmest. The trunk
keeps `barkGreat`.

**Reasoning.** Russet sets the great tree apart from the gold destination
canopies (`canopyDestination`) and the green forest while keeping the palette
warm. Mixing it with green keeps the tree inside the low-saturation look.

## D-46 — Milestone bursts are ranked in CSS, keyed on the event's chain

**Ambiguity.** LAN-523 wants 10 to be louder than 3, but also says the burst
must read the chain from the event and compute nothing. Ranking a milestone
against the others would mean reading `RUN_TUNING.milestoneChains`.

**Decision.** `createMilestoneBurst` writes the event's chain into
`data-chain` and the text "Chain of N!". `style.css` gives `3` the base pill,
`5` a larger accent-coloured one, and `10` the largest, bolder with a warm
glow. A chain with no rule of its own (after a retune) gets the base style.
Each burst is one element with a single 1.5 s CSS animation (pop in, hold,
fade up and out). The JS constant `BURST_MS` sets both the animation length,
through `--burst-ms`, and the removal timer. The burst sits at `top: 34vh`,
above the squirrel and below the end-of-run card. A new burst replaces one
still on screen. Under `prefers-reduced-motion` it only fades.

**Reasoning.** Attribute selectors keep the module a pure listener. The cost
is that the CSS names today's thresholds, and a retune falls back to the
plain style instead of breaking. One timer from one constant means the
element cannot outlive its animation.

## D-48 — Structures are pushed out to the drawn canopy's rim, not placed literally

**Ambiguity.** LAN-524 draws `tree.structures` (D-40) at `position + offset`,
but that offset was rolled against `canopyRadius` and `canopyDepth`, not
against the canopy trees.js actually draws. Measured across the forest, most
rolls land a median 2.5 m (up to ~5.5 m) inside the drawn foliage blob, so a
literal placement is invisible from the air.

**Decision.** `structures.js` keeps a structure's height, bearing and yaw
exactly as worldgen rolled them, and pushes only the horizontal distance
outward — never inward — to the surface of the ellipsoid trees.js actually
draws for the main canopy blob (`CANOPY_DROP` and the vertical squash,
exported from `trees.js` rather than copied). The great tree's canopy is four
cones (`great-tree.js`), not that ellipsoid; its platform already measured
close to a tier's surface, so it is placed literally.

**Reasoning.** Reusing `trees.js`'s own numbers keeps this a rendering-only
fix — worldgen, landing and catch radii are untouched, and the drey or
platform a player sees now matches the canopy silhouette it is supposed to
sit in.

## D-49 — Puzzle targets are measured from the drop to the target's perch, with slack and a clear line

**Ambiguity.** LAN-546 asks for a target "reachable in one glide at base
stats" using `maxGlideRange` "from the puzzle tree's perch height", and for
rings "between the puzzle tree and the target". Measuring range from the perch
height above the *ground* would accept targets you can only reach by arriving
below their catch volumes. It also leaves open where between the trees the
rings go, and whether anything may stand in the way.

**Decision.** A target must perch lower than the puzzle tree, sit at least
`PUZZLE_CONFIG.minTargetDistance` (30 m) away horizontally, and be within
`reachMargin` (0.8) × `maxGlideRange(puzzle.perchY − target.perchY)` at
`BASE_GLIDE_STATS`. The great tree, other puzzle trees and other targets are
never targets or puzzles. The 3 rings sit at ¼, ½ and ¾ of the straight line
from the puzzle perch point to the target perch point, so they descend by
construction, and every ring's `normal` is that line's unit direction. A
target is rejected if that line, sampled every ~1 m, enters another tree's
catch volume inflated by the ring radius (`pathIsClear`, mirroring
`treeCatches` in `client/src/sim/landing.js`). Selection runs after the
structures pass on its own stream, `(seed ^ PUZZLE_CONFIG.seedSalt) >>> 0`.

**Reasoning.** Measuring from the drop is the stricter reading, so it satisfies
the looser one too. The margin leaves room for the launch and small
corrections. The line is steeper than a best-ratio glide, so a pilot can
always lose height to meet it. A course blocked by a canopy would catch the
squirrel mid-trial and could never be solved. The clearance check copies the
landing geometry because `shared/` cannot import `client/`; if
`treeCatches` changes, `pathIsClear` must change with it.

## D-50 — Puzzle trees stop announcing their name until LAN-548 registers them

**Ambiguity.** Turning a landmark into `TREE_TYPES.PUZZLE` moves it out of
reach of the `landmark` interaction, so landing on it no longer emits
`landmark:arrived`. Registering `landmarkInteraction` for `PUZZLE` now would
fix that, but `client/test/interactions.test.js` ("does not register economy
interactions") asserts that `PUZZLE` is *not* registered.

**Decision.** Leave `createSimulation` alone in LAN-546. The 2–3 puzzle trees
land silently until LAN-548, which the issue already tasks with registering a
`PUZZLE` interaction that reuses `landmarkInteraction`. That ticket will have
to update the existing assertion deliberately.

**Reasoning.** An existing test's expectations are not changed to make a new
change pass. Losing a name popup on three trees for one ticket costs little,
and LAN-548 already owns this wiring.

## D-51 — A ring crossing is half-open: from strictly behind the plane to on or past it

**Ambiguity.** LAN-547 says a step "crosses the ring's plane in the direction
of `normal`", but not what happens when an endpoint sits exactly on the plane.
Counting both "ends on the plane" and "starts on the plane" would credit one
pass twice across two consecutive fixed steps; counting neither would miss it.

**Decision.** `crossesRing` counts a step only when the start is strictly
behind the plane and the end is on or in front of it. The crossing point is
inside the ring when its distance from `center` is at most `radius`
(boundary inclusive).

**Reasoning.** A half-open interval gives each pass exactly one step. It also
rejects in-plane and zero-length segments before the one division, so no
separate guard is needed. The ring's `normal` is assumed unit length, as
worldgen builds it (D-49); a non-unit normal would scale both distances
equally and still give the right answer.

## D-53 — Every perch on a puzzle tree arms it, and PUZZLE is now a registered interaction

**Ambiguity.** LAN-548 says "perching on a puzzle tree arms its trial", but
the squirrel also ends up perched after a ground reset, at construction and
after a respawn. The issue also asks for a `PUZZLE` interaction while saying
the existing interaction tests pass unchanged, yet
`client/test/interactions.test.js` asserted `PUZZLE` was *not* registered.

**Decision.** Any perch on a puzzle tree arms it — a catch, a ground reset
that climbs one, the spawn perch and a respawn. A ground failure and a re-arm
can therefore arrive together (`puzzle:failed` then `puzzle:armed`). Perching
on any other tree clears an unstarted trial silently. The one `PUZZLE` line in
"does not register economy interactions" was removed and a positive test
added beside it, as D-50 said this ticket would; the shop, cafeteria and
customization assertions are untouched.

**Reasoning.** The squirrel can launch from wherever it perches, so arming on
every perch keeps "am I on a puzzle tree?" a single rule. The great tree is
never a puzzle (D-49), so spawn arming only matters for hand-built test
worlds. The assertion change was planned in D-50; leaving it would have made
the issue's explicit registration impossible.

## D-54 — The trial returns events from plain methods; failures name the puzzle tree

**Ambiguity.** The issue fixes the `puzzle:solved` payload but not the others,
nor exactly when in a step each check runs.

**Decision.** `createPuzzleTrial()` exposes `arm`, `start`, `step`, `land` and
`respawn`, each returning an event array the simulation emits. Payloads:
`puzzle:armed { tree, course }`, `puzzle:started { treeId, course }`,
`puzzle:ring { treeId, index }`, `puzzle:solved { treeId, atTime, glide }`,
`puzzle:failed { treeId, reason }`, where `treeId` is always the puzzle tree.
Rings are checked after the glide step and before landing is resolved, so a
ring crossed on the step that catches the target still counts. Puzzle events
follow `glide:landed` and the run events, and precede interactions and
material collection.

**Reasoning.** Returning events mirrors `runs.extend` and keeps the trial
testable without a simulation. Naming the puzzle tree in every event lets the
UI (LAN-549) and the server intent (LAN-550) key on one id.

## D-55 — The target gets a gold cone hanging over its perch, and is "the marked tree" when unnamed

**Ambiguity.** LAN-549 leaves the target marker to the implementer, and asks
for a prompt reading "land on <target name>". In the default world every
course targets an unnamed scenery tree (D-49 picks targets from any lower
tree), so there is usually no name to show.

**Decision.** One upside-down cone, outlined, in the same gold as the next
ring (`PALETTE.ringNext`), hangs 3.2 m above the target's perch while its
trial is armed or flying, and hides with the rings. The prompt uses the
target's `name` when it has one and "the marked tree" otherwise. Rings still
ahead are pale cream (`PALETTE.ring`); the next ring due is gold; passed rings
drop their outline and fade to 30 % opacity rather than disappearing.

**Reasoning.** A marker the player can see from the puzzle tree does the job a
name cannot, and sharing the next ring's colour makes "fly through gold, land
under gold" a single rule. Naming targets would change worldgen output for
existing trees, which is out of scope here. Keeping passed rings faintly
visible shows the line already flown.

## D-56 — Rings are driven by events, and a respawn hides them

**Ambiguity.** The simulation clears an armed trial that never launched on a
respawn without emitting any `puzzle:*` event (D-54), so a renderer that only
listens to puzzle events would leave the rings up.

**Decision.** `main.js` shows a course on `puzzle:armed`, advances it on
`puzzle:ring`, and hides it on `puzzle:solved`, `puzzle:failed` or
`glide:respawned`. The prompt clears its line on `glide:respawned` the same
way. Every course's rings are built once at startup and toggled, not built
when a trial arms.

**Reasoning.** The issue asks for the wiring to follow the simulation's
events. Adding a respawn event to the trial would change sim/ for a display
concern. Events arrive in order, so a failure followed by a re-arm on the
same landing (D-53) hides and then shows the right course. With at most three
courses of three rings, building them all up front costs less than a stall on
the frame a trial arms.

## D-59 — Gamepad mapping: standard layout, forward-is-dive, dead zone 0.15

**Ambiguity.** LAN-551 asks for gamepad support but the product doc doesn't
pin down which axes and buttons map to what, or how a dead zone should be
applied.

**Decision.** Only the Standard Gamepad layout is read, and only the first
connected pad reporting it — other pads and non-standard layouts are ignored
rather than guessed at. Axis 0 is steer, right positive, matching the sim's
sign. Axis 1 is pitch, used as-is: the browser reports pushing the stick
forward as negative, and forward already means dive (negative pitch) in this
game's convention, so no inversion is needed. Button 0 (A) is launch, button
3 (Y) is toggleShop, button 8 (Back/Select) is respawn, all in a frozen index
table. Deflection inside `GAMEPAD_DEAD_ZONE` (0.15) reads as zero; past it,
the remaining travel is rescaled so full deflection still reaches +-1.

**Reasoning.** Standard-only keeps the mapping honest — anything else would
be guessing at unlabelled axes. Matching the existing dive/pitch sign
convention (`W` = dive in `ui/input.js`) means the stick
"just works" instead of needing a per-control inversion the player has to
learn. Rescaling past the dead zone keeps precision at the extremes instead
of leaving a dead band the player can feel.

## D-60 — Precedence keys > stick > mouse; buttons are press-edge; polled once per step

**Ambiguity.** With three simultaneous input sources it isn't obvious which
should win when more than one is active at once, or how often the gamepad
should be read against the fixed-timestep loop it feeds.

**Decision.** `sync(dt)` resolves steer and pitch in the order keys, then
gamepad stick, then mouse drift — each only fills in a zero left by the one
before it. Gamepad buttons fire on the press edge only, using the previous
poll's held state, so holding launch doesn't repeat it every step. The pad is
polled exactly once per `sync` call, i.e. once per fixed step; a press
shorter than the gap between two polls could be missed entirely.

**Reasoning.** Keys are digital and deliberate, so they should never be
fought by an idle stick sitting slightly off-centre; the stick is likewise a
more explicit signal than ambient mouse drift while pointer-locked, so it
goes next. Press-edge buttons match how the keyboard's `event.repeat` guard
already behaves, keeping the two input paths consistent. Polling once per
step is the same cadence every other input source already runs at; a missed
sub-step press is an acceptable trade against reading raw browser state at a
different rate than the simulation advances.

## D-61 — Wind is visual only, with one seeded direction per world

**Ambiguity.** LAN-552 asks for visible wind. Real wind would push the
squirrel and change glide feel, which is the Phase 1 go/no-go (product doc
§9). It is also open whether wind should vary across the forest.

**Decision.** `client/src/render/wind.js` draws streaks and leaves and
nothing else; the simulation never hears about wind. One prevailing heading
per world, drawn from `createRng(world.seed ^ 0x77a1d5e3)` in the glider's
heading convention, so the same world always blows the same way. Spawn
positions, lifetimes and wobble use `Math.random()`, which `CLAUDE.md` allows
under `render/`.

**Reasoning.** Pushing the squirrel needs a human playtest. A fixed direction
reads as weather; per-mark random directions would read as noise. Salting the
seed keeps the wind stream apart from worldgen's, so it cannot disturb the
forest.

## D-62 — A fixed pool of marks around the camera, recycled in place

**Ambiguity.** How to keep the effect's cost flat, and how to fade marks
subtly when toon materials cannot fade per instance (D-43).

**Decision.** 24 streaks share one `LineSegments` buffer (8 points each) and
12 leaves share one `InstancedMesh`, both built once. Marks spawn within 60 m
of the camera (horizontally), in a band from 14 m below to 10 m above it and
never under 1.5 m above the ground. A mark is respawned when its life ends or
when it is more than 70 m from the camera. Streaks fade through per-vertex
alpha (a four-component colour attribute): the tail is transparent, and the
whole streak rises and falls with `sin(pi * t)` to a peak of 0.35. Leaves use
a transparent toon material at 0.7 opacity with no outline hull, and grow in
and shrink away like the landing burst. The step runs in the streaks'
`onBeforeRender`, which gets the camera it draws for, and writes into
preallocated buffers without allocating.

**Reasoning.** Two draw calls and no allocation, however large the forest.
Lines stay one pixel wide at any distance, which gives "thin" without a
camera-facing ribbon. Recycling marks the camera has outrun keeps the density
steady at glide speed.

## D-63 — "Towering" trees, with `perchY: null` meaning "no reachable top"

**Ambiguity.** LAN-553 asks for "headless" trees: giants whose tops you can
never reach. "Headless" already means "runs without a browser" here, and the
issue leaves open how landing code should tell that a tree has no perch.

**Decision.** In code they are **towering** trees: `tree.towering === true`
on the giants, `false` on every other tree. A towering tree has
`perchY: null`; `minCatchY` and `catchRadius` stay numeric so LAN-554 can
catch the trunk from the side. They are `TREE_TYPES.SCENERY`, never
destinations, and carry no structures, course or material cache. Until
LAN-554 adds clinging, `treeCatches` returns `false` for them explicitly, and
the ground-contact reset in `landing.js` only picks ordinary trees.
`materialEffortScale` ignores them, so every cache's effort is unchanged.
Until LAN-555 draws them, `client/src/render/trees.js` leaves them out of the
instanced forest, because its canopy placement is computed from `perchY`.

**Reasoning.** One searchable word per meaning. A `null` perch fails loudly in
arithmetic instead of pretending to be a height, which is what we want for
any code that has not considered towering trees yet. For now they are
invisible and do not catch the squirrel, so a player cannot run into
something they cannot see.

## D-64 — Four towering trees on their own salted stream, in the outer half

**Ambiguity.** How many, how big, and where. LAN-553 set defaults without a
human, and the existing forest must not move.

**Decision.** `TOWERING_TREE_CONFIG` in `shared/src/constants.js`: 4 trees;
trunk height 2.5–3.5 × `trunkHeightRange[1]` (85–119 m, against the great
tree's 46 m); trunk radius 2–3 × `trunkRadiusRange[1]`; canopy radius 2–2.5 ×
`canopyRadiusRange[1]`. Positions are drawn evenly over the annulus from
0.5 × to 1 × `areaRadius`. Each is at least `minSpacing` from every ordinary
tree and at least 0.5 × `areaRadius` (130 m) from every other towering tree,
with up to 4000 attempts (fewer trees if they do not fit). They come from
`createRng((seed ^ 0x2545f491) >>> 0)` after puzzle courses are placed, and
are appended to the end of `world.trees` with ids `tree-towering-N`. Tests
pin a hash of the default world's first 187 trees and of all its caches,
taken before this change.

**Reasoning.** A separate salted stream appended last is the pattern
puzzle courses already use (LAN-546). It is the only way to leave every
existing id, position and cache untouched. The outer half keeps them away from
the spawn clearing. 130 m of separation spreads four trees around the rim, so
they frame the forest instead of clustering.

## D-65 — Cling geometry: anywhere on the trunk, and a new phase to hold it

**Ambiguity.** LAN-553 left towering trees uncatchable — `treeCatches`
explicitly returns `false` for them — with clinging deferred to LAN-554.
Nothing said whether the trunk should keep the ordinary tree's `minCatchY`
floor and canopy volume, or how the squirrel's state machine should represent
"stuck to the side of a trunk" versus "standing on a perch".

**Decision.** Clinging is a separate check, `clingPoint` in `landing.js`, not
a branch of `treeCatches` — that function keeps returning `false` for
towering trees exactly as D-63 left it, so LAN-553's test stays meaningful. A
towering trunk catches anywhere from the ground to `tree.position.y +
tree.trunkHeight`, with no `minCatchY` floor: there is no perch to require
climbing further towards, so there is nothing for a floor to protect. The
canopy above the trunk top is not a catch volume — flying over it just passes
through open air above, same as any tree's crown. The catch point sits
`trunkRadius` out from the centre, on the side the squirrel approached from
(falling back to the direction from `previous`, then +Z, so a dead-centre hit
never divides by zero), at the exact height of the hit. `resolveLanding`
skips a towering tree outright while it is `fromTreeId` — unlike the
distance-gated guard ordinary trees use, there is no perch radius to measure
a towering tree's guard against.

The squirrel gets a third `GliderPhase`, `CLINGING`, alongside `PERCHED` and
`GLIDING`, rather than overloading `PERCHED` with a null perch height. A
cling and a perch both mean "not airborne", but they hold different motion
(a cling's `x/y/z` are the trunk-side point, not a branch) and, per D-66,
different consequences when they end.

**Reasoning.** Reusing `treeCatches`'s canopy/trunk split would have given
towering trees a canopy volume they don't have and a floor that serves no
purpose without a perch above it — "climbable anywhere on the visible bark"
is the whole pitch of a giant tree you fly into. A dedicated phase keeps
`sim/` code that branches on "is the squirrel free to launch" simple (both
`PERCHED` and `CLINGING` qualify) without ever needing to ask whether a given
perch is real.

## D-66 — Cling in the loop: a catch, not a landing

**Ambiguity.** `doLand` and `launch` assumed every arrival was onto a real
perch: interactions fired, materials could be collected, and a launch always
started from a branch already facing outward. A cling has none of those —
there is no perch to announce to the interaction registry, no branch to push
off from — but LAN-554 still needs it to feel like catching the run rather
than losing it.

**Decision.** `doLand` branches on `reason === 'cling'` before any of the
perch bookkeeping: it calls `clingTo` instead of `landOn`, emits
`glide:clung` with `{ tree, height }` instead of `glide:landed`, and still
extends the run chain (`runs.extend`) and ends any puzzle trial in progress
as a wrong-tree landing (`puzzle.land` already treats any non-ground,
non-target tree that way). It does not call `interactions.land` or
`collection.collectAt` — a trunk has no shop, no cache and nothing to
announce. `launch` accepts `CLINGING` the same as `PERCHED`, but first turns
the heading by π (wrapped into `(-π, π]`) so the push-off faces away from the
trunk instead of into it, then hands off to the same `launchMotion` — same
speed, same hop, no height gained or lost by clinging itself. `doLaunch` and
`doRespawn` both skip `interactions.leave` when leaving a cling, since
`interactions.land` never fired for it to balance. The `fromTreeId` guard
that lets the squirrel loop back onto a tree it just left needed its own
clause too: a towering tree has no `perchRadius` to measure against
(`perchY` is `null`), so it clears at `catchRadius + 2` instead.

One thing a cling does *not* do: save the server position anchor. `main.js`
only calls `positionSync.save` on `glide:landed` and `glide:respawned`, so a
cling's `glide:clung` is silently skipped. Checking `position-sync.js` and
the server's plausibility check (`server/src/domain/validation.js`) confirms
the anchor is not perch-specific — it is just the last position the server
was told, used to bound how far a later `/collect` claim could plausibly be
— so this is a gap worth naming rather than a broken assumption: a player who
clings for a long time before their next perch reports a slightly stale
anchor, the same as one who glides a long way without landing at all. Closing
that gap, if it needs closing, is a `position-sync.js` change, not a `sim/`
one.

**Reasoning.** Treating a cling as a catch (extends the run) but not a
landing (no interactions, no collection) matches what the player sees: they
caught the tree and can push off again, but there was never a branch to
arrive at. Reusing `launchMotion` rather than inventing a second launch path
keeps the one place that owns "how fast does a push-off start" — no new
tuning dial for a cling's hop.

## D-67 — Towering trees: straight where you can cling, hazed toward the fog above

**Ambiguity.** LAN-555 set the look (darker, cooler bark with a slight taper;
a high, wide canopy; fog softening the upper trunk) without a human. Three
things were left open. A taper moves the bark inward, but `clingPoint` always
puts the squirrel exactly `trunkRadius` from the centre. The scene fog is
linear by distance, so on its own it barely touches the top of a trunk 150 m
away. And the dark inverted-hull outline would make the top end sharply
whatever the fog does.

**Decision.** Towering trees get their own module,
`client/src/render/towering-trees.js`, called from `createForest` with the
forest's shared bark texture and canopy geometry. There are four instanced
meshes for all of them: trunk, trunk hull, canopy and canopy hull. The trunk
keeps its full `trunkRadius` for the bottom 55% and tapers to 62% at the top.
Nothing launches higher than the great tree's 46 m perch, and every towering
trunk is at least 85 m tall (D-64), so the taper never reaches bark a
squirrel can touch. It also uses 16 sides rather than 7, so the flats stay
close to the circle the cling point is set on. The bark is
`PALETTE.barkTowering` (a cool grey-brown). Above 35% of the height, both the
bark and its outline blend toward `PALETTE.fog`, reaching 72% fog at the top.
This is baked into vertex colours, so the fade works however the scene fog is
set. The canopy is five wide, flat blobs centred on the top of the trunk, 42%
of the way to fog, with a hull 60% of the way to fog. No scene-wide change
to the fog was made.

**Reasoning.** Keeping the reachable trunk straight means clinging needs no
render-side knowledge of sim geometry, and no change to `clingPoint`. Vertex
colours give a height fade without a custom shader, which is reserved for the
Phase 4 art pass (§5.1), and cost no extra draw calls. If a height fog is
added later, the vertex haze can be turned down rather than removed.

## D-68 — Cling pose in a child group, and a side-on cling camera

**Ambiguity.** The squirrel mesh had no limbs, and its root's rotation
belongs to the renderer (heading, flight pitch, bank). LAN-555 also asked the
camera to "pull back and out from the trunk, looking past the squirrel along
the direction it will launch". Read literally, that puts the camera inside
the trunk, because the squirrel faces the bark and the launch line runs
straight back through where a chase camera sits.

**Decision.** All squirrel parts now hang off a child `pose` group.
`squirrel.update(spread, bank, clinging)` eases it through a quarter turn so
the nose points up the trunk and the belly faces the bark, flattens it across
the back to 72%, and shifts it so the belly meets the bark at the root
(which the sim places on the trunk surface). The membranes hide, and four
small leg boxes, hidden at all other times, show splayed diagonally on the
bark. The renderer drops the perch's 0.55 m lift while clinging.
`followCamera.update` now takes the glider phase instead of a `gliding`
boolean. While clinging it sits 8 m to the squirrel's right, 1 m clear of the
bark and 3 m up, and looks 4 m out along the launch line and 2.5 m down. That
keeps the camera outside the trunk and the squirrel in frame, while turning
the view toward the jump.

**Reasoning.** A child group composes the cling in the squirrel's own frame,
whatever the heading, so the renderer's Euler order and pitch logic are
untouched. A side-on camera is the nearest framing to "looking past the
squirrel" that is neither occluded by the trunk nor loses the squirrel
off-screen. `CLINGING` in `follow-camera.js` is the dial to change after a
playtest.

## D-69 — Puzzle trees: a fall canopy and two pale beech bands

**Ambiguity.** LAN-565 asked for puzzle trees to stand out from the air with
"warm reds, oranges and ambers" and two light-tan trunk bands "on the
lower-to-mid trunk", without fixing exact colours or heights. Puzzle trees
are also destinations, which already get a gold canopy.

**Decision.** In `trees.js`, a puzzle tree's canopy mixes `canopyAutumn`
(`#C4472B`, a brick red) toward `canopyAutumnAlt` (`#E2782C`, orange) by one
per-tree seeded draw. Its tufts lean 45% toward `canopyAutumnTuft` (`#EAA53C`,
amber, lifted 10% toward the sky colour as green tufts are) instead of green. The canopy stays redder than `canopyDestination` so a
puzzle tree never reads as an ordinary landmark. Two bands in `beechBand`
(`#DCC6A2`, a touch lighter than the suggested `#D8C3A0` so the toon shadow
band doesn't go muddy) sit at 40% and 70% of the bare trunk. The bare trunk is
trunk height minus 1.7 canopy radii (the underside of the lowest blobs), with
a floor of half the trunk height. Each band is 0.45 m tall and 6% wider than
the trunk at that height, with the same seven facets and spin as the trunk and
its own outline hull. That puts them at about 8 m and 14 m on Split Cedar.
Bands are one extra InstancedMesh plus its hull, both skipped when a world has
no puzzle trees.

**Reasoning.** Placing bands against the bare trunk keeps them in view under
the canopy on any tree height. Thin, flat and hugging the bark, they can't be
mistaken for the round, free-floating flight rings from `rings.js`. Scenery,
landmark and towering trees take the same colour paths and the same per-tree
random draws as before, so they look unchanged.

## D-70 — Tree name labels: DOM tags, 60 m fade to a 130 m cutoff

**Ambiguity.** LAN-567 asked for a floating name tag over every named tree,
toggled off by default with the N key, fading with distance and hidden past
a cutoff and behind the camera, without fixing the fade band, the cutoff, or
whether a label is DOM or a sprite.

**Decision.** Labels are plain DOM, one `.tree-label` pill per named tree,
positioned each frame from `renderer.projectToScreen(anchor)` and styled to
match the existing toast (paper background, pill radius, letter-spacing),
with a text and box shadow added so it stays readable over both sky and
canopy. `TREE_LABEL_VIEW` in `client/src/ui/tree-labels.js` — the only module
that reads it — fades a label from full opacity at `fadeStartDistance` (60 m)
to invisible at `cutoffDistance` (130 m). On the default seed, ordinary named
trees sit 71–119 m from the great tree, so their labels are already fading in
gently by the time they're readable; Split Cedar, the puzzle tree, sits at
148 m, past the cutoff, so its tag only appears once you've actually glided
towards it. A label is hidden outright, not just faded to 0, once its world
anchor is behind the camera (checked in view space, before the perspective
divide, so it can't flip sign right at the camera plane) or past the cutoff.
The N key toggles visibility; it starts off so the forest stays calm (product
doc §2.1). No gamepad button: the only free one (X, button 2) is not wired,
because adding it would change `mapGamepad`'s and `heldButtons`'s return
shape, which existing gamepad tests pin with `toEqual`.

**Reasoning.** DOM text is crisp at any zoom with no font atlas to bake and
no extra draw call, and it reuses the toast's styling for free. Building each
label's element once and only repositioning it after avoids per-frame DOM
churn. The fade numbers come from where the current forest actually places
its named trees, so the effect is visible without a screenshot: labels ease
in over the approach to an ordinary destination, and a distant puzzle tree
stays a surprise. The pure fade/anchor math lives in `ui/tree-labels.js`
rather than `render/`, because that is its only consumer and it keeps the
curve unit-testable without pulling in Three.js, the same boundary the rest
of `sim/` and `shared/` are held to.

## D-71 — Easing into the cling view over about 1.3 s

**Ambiguity.** LAN-570 asked for the swing into the side-on cling view
(D-68) to settle in "about 1 second", roughly 1.2–1.5 s to cover 95% of the
distance, and for the aim point to sweep instead of snapping. It left open
how the slower entry hands back to firm tracking, and whether aim easing
should apply to every phase change.

**Decision.** `follow-camera.js` gains `CLING_ENTRY` (`stiffness` 2.3/s,
`seconds` 1.3). For 1.3 s after the phase becomes `clinging`, position eases
at 2.3/s, which covers 95% of the swing in ln 20 / 2.3 ≈ 1.3 s; after that it
tracks at `CLINGING.stiffness` (4) as before. The aim point is now held as an
offset from the squirrel. Across a change into or out of `clinging` that
offset eases with the same factor as position (so the launch back to the
behind view keeps its old 3.4/s pace), and snaps to exact once within
`LOOK_EASE.settled` (0.05 m). Every other phase change, such as perch to
glide, still aims instantly. `PERCHED` and `GLIDING` are unchanged.

**Reasoning.** 1.3 s sits in the middle of the requested band. A separate
entry stiffness leaves the settled cling view as firm as before, so it does
not drift. Easing the aim as an offset, and only around the cling view,
removes the single-frame flip that read as a jolt without adding lag to the
perched and gliding framing that has already been tuned. A time limit rather
than a distance check ends the entry, so it cannot stretch out if the
squirrel is moving.

## D-72 — A trunk catch climbs into view instead of teleporting to the perch

**Ambiguity.** LAN-571 asked for a bare-trunk catch on an ordinary tree to
scamper up visibly rather than snapping straight to the perch, without
saying which of the two catch volumes should trigger it, whether the events
that already fire at the moment of catch (`glide:landed`, run-chain scoring,
puzzle solve/fail, material collection) should move to the moment the climb
finishes, or what happens to a held launch input during the climb.

**Decision.** Only the trunk volume climbs — a canopy catch (at or above
`perchY - canopyDepth`) still drops straight onto the perch exactly as
before, and so does a ground-contact reset, which stays a teleport. Every
game event that used to fire at catch still fires at catch, unchanged:
`resolveLanding` keeps returning `reason: 'perch'` for a trunk catch too, so
none of the existing listeners, the run tracker, or the puzzle trial need to
know a climb is happening — it is presentation between the catch and the
perch, not a new outcome. The one addition is `climbFrom`, a point on the
trunk's bark at the height of the catch, carried on the landing result;
`doLand`'s whole perch path (events, run scoring, puzzle resolution,
`interactions.land`, material collection) runs exactly as it does today, and
only the final glider assignment branches on whether `climbFrom` is present.
A new `climbing` phase in `client/src/sim/glider.js` moves the glider
straight up the trunk surface at `profile.climbSpeed` on a fixed timestep,
keeping the heading it was flying at catch (`perchHeading`) so the perch it
lands on faces the way the squirrel arrived, the same as a direct catch
does today. It reaches the perch by snapping from the trunk surface to the
perch's centre once `y` would reach or pass `perchY`, rather than sliding
along the surface the whole way up. Launch input during a climb is ignored
outright and does not queue for the moment it becomes perched.

**Reasoning.** Keeping every event at catch time means LAN-571 cannot change
what a run is worth or when a puzzle resolves — a purely visual issue stays
visual. Reusing `reason: 'perch'` rather than inventing a third reason means
none of the code that already branches on landing reasons needs to change,
and a future reader only has to learn `climbFrom` exists, not a new outcome
to handle. Keeping the flight heading for the eventual perch matches what a
direct catch already did, so a canopy catch and a climbed one end up facing
the same way. Ignoring launch outright, rather than queuing it, keeps the
climb's timing simple and matches the product doc's "floaty and forgiving"
pillar better than punishing an impatient held key.

## D-73 — `climbSpeed` as a tuning dial; the climb reuses the cling camera and pose

**Ambiguity.** LAN-571 left open how fast the climb should be, whether it
belongs in `GLIDE_TUNING` or somewhere else, and what the camera and squirrel
pose should do while it happens — a state genuinely new to the render layer.

**Decision.** `climbSpeed` (8 m/s) joins `GLIDE_TUNING` and flows through
`deriveGlideProfile` like every other dial nothing below it may read
directly, and it gets its own row on the tuning panel (min 1, max 24, step
0.5) so it can be felt out the same way the rest of the glide can. The
renderer and follow camera treat `climbing` as the same "side view" as
`clinging`: no perch lift, the same cling body pose, and the same
side-on rig, entry ease, and look-ease rules — including on the way back
out, when the climb finishes and the phase becomes `perched`, which now
counts as leaving a side view exactly as leaving a cling already did.

**Reasoning.** A dial governs how the climb feels, exactly like cruise speed
or turn rate, so it belongs with them rather than as a hardcoded constant
nothing can retune. The cling pose and camera already solve "squirrel
plastered against bark, camera to the side" for the towering-trunk case;
climbing is the same shape of problem on an ordinary trunk, and reusing the
rig means LAN-571 adds no new camera code, just one more phase that counts
as the view already tuned in D-68 and D-71.

## D-74 — Trees between the camera and the squirrel: a dithered screen-door cutout

**Ambiguity.** LAN-572 asked for trees standing between the camera and the
squirrel to go see-through, without saying how — a per-material opacity
fade, a shader-level cutout, or something else — or what the capsule size,
clear zone round the squirrel, and ease timing should be.

**Decision.** A dithered screen-door cutout patched onto the existing toon
and outline materials via `onBeforeCompile`, in one new module,
`render/see-through.js`, rather than three copies wired into trees.js,
towering-trees.js and great-tree.js separately. Every patched fragment shader
tests its world position against a capsule running from the camera to the
squirrel and discards a share of fragments inside it, chosen by a 4x4 Bayer
threshold at `gl_FragCoord.xy` so the cut share can ramp smoothly with the
eased strength rather than popping a fixed checkerboard in and out. The
numbers live in a frozen `SEE_THROUGH`: a 1.5 m capsule radius, a 1 m clear
radius round the squirrel so bark it is touching or perched on never cuts
out, a 0.15 s ease, and a 50% share of fragments discarded at full strength.
The ease is global, not per-tree: `createSeeThrough(forest)` raycasts once a
frame from the camera toward the squirrel against the forest group (`far`
trimmed by the clear radius, so the squirrel's own trunk is never the
blocker) and eases one shared strength uniform toward 1 when something is
hit and toward 0 otherwise. Trunk, canopy, puzzle-tree bands and every
outline hull are patched — ordinary trees, towering trees and the great
tree alike — so a cut trunk and its outline hole line up. Ground and
squirrel are never cut. Structures (dreys and platforms, `structures.js`)
are also left alone, because LAN-572 scoped the cutout to trees: they are
neither patched nor raycast against, so a platform between the camera and
the squirrel still blocks the view. That is a known gap, not an oversight.

**Reasoning.** The forest is instanced (D-38) precisely so a couple of
hundred trees cost a handful of draw calls; per-tree transparency would mean
per-tree materials and lose that. D-43 already ruled out per-material
opacity as a general tool because Three.js has one opacity per material and
sorting transparent instances is its own problem — the same reasoning
applies here, doubled, since this needs a *moving* cutout rather than a
fixed one. A discard-based cutout sidesteps both: it stays opaque for
depth and sorting purposes and only decides per-fragment, in screen space,
whether to draw. Easing per-fragment is impossible with materials shared
across many instances — there is no per-tree "time since this tree started
blocking" to store — so the ease has to live on one shared clock instead,
which also means a tree completely out of the way renders exactly as it did
before this feature, at zero cost beyond the one raycast per frame.

---

## D-79 — Turning on the perch: steer spins on the spot, a back-tap about-faces

**Ambiguity.** LAN-577 asked for the squirrel to be able to turn around while
perched, without saying whether steer and the about-face should share one
speed, what should trigger the about-face given there was no dedicated input
field for it, and whether it should interrupt itself if steer is also held.

**Decision.** While `PERCHED`, `input.steer` spins the squirrel on the spot at
a new `perchTurnRate` (2.5 rad/s), the same sign convention as every other
turn in the game — right decreases heading. Clinging and climbing are
unchanged: steer and pitch still do nothing there, exactly as before. A
back-tap plays a scripted about-face instead: exactly π, always toward
increasing heading (left), over `aboutFaceDuration` (0.4 s), with steer
ignored for as long as it is in progress — it does not add to or get
interrupted by anything held alongside it. Rather than add a new input field,
the trigger is the rising edge of `input.pitch >= 0.5` — the same threshold
`stepGlide` already treats as a flare — detected once per step in
`simulation.js`'s `step()` and tracked across every phase, not just `PERCHED`.
That gets keyboard S/down, a stick pulled back, and (while pointer-locked) a
sharp downward mouse move all for free, and it means a flare held all the way
down through a landing does not fire an about-face the instant the squirrel
reaches a perch — the edge already happened in the air, well before landing.
`perchTurnRate` gets a row on the tuning panel, the same as every other feel
dial; `aboutFaceDuration` does not, since the issue only asked for the turn
rate to be tunable. No interaction handler auto-faces the squirrel toward
anything — this is purely player input, exactly as landing already leaves
heading wherever the approach put it.

**Reasoning.** Reusing the flare threshold instead of adding a new bound key
keeps the input surface the same shape `input-state.js` already has —
`steer` and `pitch` are the only motion-relevant fields on `InputState`, and
every other feature so far has found a way to read them rather than growing
the struct. Edge-detecting in `simulation.js` rather than in `stepPerch`
keeps `stepPerch` a pure function of its own arguments (`{ steer, aboutFace }`)
with no memory of previous input, which is what lets it be tested directly
without going through the simulation at all.
