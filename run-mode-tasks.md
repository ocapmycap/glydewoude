Base your work on the devel branch. Open your PR against devel.

Read CLAUDE.md and docs/decisions.md first and follow the existing
conventions. Do not restructure anything outside your own area.

Five sessions are working on this feature in parallel. Keep your changes
confined to the files your ticket lists. If you must touch a shared file,
make the change purely additive — do not reorganize, rename, or reformat
it. Do not modify CLAUDE.md.

Where the spec is ambiguous, choose and proceed. Do not wait for me.

---

# Run mode

## The story

Right now Glidewood is a toy, not a game. You can glide, land, collect,
and buy — but nothing you do is better or worse than anything else. Aim
at the far tree and miss, and `client/src/sim/landing.js:51` puts you on
the nearest trunk for free. A perfect glide and a bungled one end the
same way, so there is no reason to attempt the perfect one.

Run mode gives the aiming a consequence.

**A run is a chain of perch landings without touching the ground.** You
launch, you catch a tree, you launch again. Each catch extends the chain
and adds to a score built from the distance you covered. Touch the
ground and the run ends: the score is banked, your best is updated, and
you are back on the nearest trunk ready to start another.

That one rule changes every launch. The far tree is now a gamble — more
distance, more multiplier, and a real chance of ending the chain. The
near tree is the safe hold. Deciding between them, mid-air, at 18 metres
and falling, is the game.

### Why this stays cosy

The product doc's first pillar (§2.1) is a calm game, and a failure
state is the fastest way to lose that. So run mode never takes anything
away:

- **You keep every material you collected.** A run ending is not a
  death; the collection ledger is untouched.
- **Ground contact still means scampering up the nearest trunk.** The
  soft reset in `landing.js` stays exactly as it is. Nothing is lost but
  the chain.
- **The best score is yours alone.** No leaderboard, no rank, no other
  player to lose to. Phase 3's multiplayer is presence-only and this
  does not change that.

What a run adds is a reason to care, not a punishment for not caring. A
player who ignores the chain counter entirely plays the game they play
today, unchanged.

### What the score rewards

Distance alone would reward one strategy: point at the biggest tree in
range and repeat. Two terms fix that.

- **A chain multiplier**, so a long sequence is worth more per metre
  than a fresh one. It rewards not stopping.
- **A freshness bonus** for landing on a tree you have not already used
  this run, so bouncing between the same two trees pays less than
  working your way across the forest.

The exact numbers are in the contract below. They are first guesses and
the tuning panel should be able to move them; nobody should defend them
in review.

### What we are not building

- No leaderboard, no sharing, no comparison to other players.
- No material or currency reward for a run. The moment a score buys
  something it becomes currency, and §6.1 would require the server to
  recompute it rather than store what the client reported. See D-28.
- No new glide physics. The flap stays deferred.

---

## The contract

Every ticket below depends on this section and nothing else. Build
against it and the five branches merge without a conversation.

### Scoring (owned by T1, `shared/src/run.js`)

```js
/** A run in progress. Treat as immutable; every function returns a new one. */
// { chain, score, distance, treeIds, startedAt, endedAt }

startRun(atTime)                      -> run
extendRun(run, { tree, glide })       -> run     // a perch landing
endRun(run, atTime)                   -> run     // ground contact
runMultiplier(chain, tuning)          -> number
```

`extendRun` adds, for a landing with glide distance `d`:

```
multiplier = min(1 + chainStep * chain, maxMultiplier)
fresh      = run.treeIds.includes(tree.id) ? 1 : freshBonus
points     = d * multiplier * fresh
```

with defaults in a frozen `RUN_TUNING` beside `GLIDE_TUNING` in
`shared/src/constants.js`:

```js
export const RUN_TUNING = Object.freeze({
  chainStep: 0.25,      // multiplier gained per link
  maxMultiplier: 4,     // ceiling, so a long chain cannot run away
  freshBonus: 1.5,      // landing on a tree not yet used this run
  minChainToBank: 2,    // a run of one landing is not a run
});
```

Pure. No clock, no `Math.random`, no mutation of the run passed in — a
test asserts the last one, the way `stepGlide`'s does.

### Events (owned by T3, emitted from `createSimulation`)

```js
{ type: 'run:started',  run }
{ type: 'run:extended', run, tree, points }   // points added by this landing
{ type: 'run:ended',    run, reason: 'ground' | 'respawn' }
```

`run` is always the full run object above. `run:ended` fires with the
final run, `endRun` already applied.

`simulation.run` is a getter returning the run in progress, or `null`
when perched with no chain going.

### Persistence (owned by T2, server)

```http
POST /api/player/run
{ "score": 4820, "chain": 7, "distance": 1930, "durationMs": 84000 }

200 { "best": { "score": 5100, "chain": 9, "recordedAt": "..." }, "improved": false }
```

The route stores the run **only if it beats the stored best**, so the
response always carries the authoritative best and a replayed request
cannot lower it. Rate-limited like the other economy routes.

---

## The tickets

All five can start immediately. T1 and T2 depend on nothing. T3, T4 and
T5 depend only on the contract above, which is already fixed — do not
wait for the branch you depend on to merge.

### T1 — Run scoring in `shared/`

**Files:** `shared/src/run.js` (new), `shared/src/index.js` (one export
line), `shared/src/constants.js` (append `RUN_TUNING`),
`shared/test/run.test.js` (new).

Implement the four functions in the contract, exactly those signatures.
It goes in `shared/` rather than `client/src/sim/` by CLAUDE.md's own
test: a server would need it to check a client's claim, and D-28 leaves
the door open to that even though we are not doing it yet.

Test invariants, not exact values — "a longer chain scores more per
metre", "a revisited tree scores less than a fresh one", "the
multiplier never exceeds `maxMultiplier`", "`extendRun` does not mutate
its argument". Exact-value assertions turn a tuning tweak into a test
failure.

### T2 — Best run persistence

**Files:** `server/src/db/migrations/003_best_run.sql` (new),
`server/src/repo/players.js`, `server/src/app.js` (one route),
`server/src/domain/validation.js`, `server/test/persistence.test.js`,
`server/README.md` (one API table row).

Add `best_run_score`, `best_run_chain`, `best_run_distance` and
`best_run_at` to `players`, all defaulting to zero or null with
non-negative checks, matching the style of the existing stat columns.

The update is one conditional statement — `UPDATE ... WHERE
best_run_score < $1` — so two concurrent submissions cannot both win and
the lower one cannot overwrite the higher. Same shape as the conditional
debit in the purchase path; follow it.

Validate the body the way `/api/player/position` validates its own:
finite non-negative numbers, integer chain, sane ceilings. A run score is
client-reported, but a client sending `Infinity` should still bounce.

Do **not** write a ledger row. A run earns nothing, so it is not a
transaction.

### T3 — The run tracker and simulation events

**Files:** `client/src/sim/run.js` (new), `client/src/sim/simulation.js`
(additive), `client/test/run.test.js` (new).

Own the run in progress and emit the three events. The tracker is a
`create*` factory holding state; the maths all comes from T1.

Where the state transitions hang off the existing loop:

- `doLaunch` — start a run if none is in progress.
- `doLand` with `reason === 'perch'` — extend.
- `doLand` with `reason === 'ground'` — end it.
- `doRespawn` — end it, `reason: 'respawn'`. Pressing respawn should
  not bank a run as though it were a clean finish, but it must not leave
  a stale chain running either.

A run below `minChainToBank` ends silently: still a `run:ended` event,
but the HUD and the sync both ignore it.

Test through the shipped `createSimulation` with the scripted pilot in
`client/test/helpers/autopilot.js`, the way `glide-loop.smoke.test.js`
does. Do not reimplement the loop.

### T4 — The run HUD

**Files:** `client/src/ui/run-hud.js` (new), `client/src/style.css`
(additive), `client/src/main.js` (two lines, additive).

Three things on screen, and no more: the current chain, the running
score, and your best. It subscribes to the T3 events — it must not read
simulation internals, and it must not compute score itself.

The moment that matters is the run ending. A chain of nine that dies on
the ground deserves to be *seen* — hold the final score on screen for a
few seconds, and say plainly whether it beat your best. Reuse the
existing toast in `client/src/ui/hud.js` if it fits; a second, larger
element is fine if it does not.

Keep it out of `hud.js`. That panel is flight instruments and this is
the game state; they change for different reasons.

Rendering is not covered by automated tests (CLAUDE.md). Actually look
at it before pushing.

### T5 — Syncing the finished run

**Files:** `client/src/net/run-sync.js` (new), `client/src/main.js` (two
lines, additive), `client/test/run-sync.test.js` (new).

Post a finished run to T2's route and hand the authoritative best back
to the HUD. Mirror `client/src/net/position-sync.js` — same injected
session, same silence when offline, same shape of test with a fake.

Runs below `minChainToBank` are never posted. Neither is a run that
cannot beat the best the server already returned; check locally first
and save the request.

Offline is not an error. The session is optional by design
(`client/src/net/session.js`), and run mode must work with no server at
all — you simply have no best that survives a reload.

---

## Two shared files, and how not to collide

`client/src/main.js` is touched by T4 and T5, and
`shared/src/constants.js` by T1 alone. Append; do not reorder. Both
additions to `main.js` are a single import and a single wiring line, in
the blocks that already do the same for the shop and the position sync.

## Before your PR

`npm run verify` from the repo root — lint, test, build. T2 also runs
the suite against real PostgreSQL, because it changes the schema:

```bash
DATABASE_URL=postgres://glidewood:glidewood@localhost:5432/glidewood npm test
```

Add a decision-log entry for anything you chose that the next person
would otherwise wonder about. D-28 is reserved for the one below; take
D-29 onward.

**D-28 — A run score is client-reported.** The server stores what the
client sends rather than recomputing it, on the same reasoning as
`last_position` in `001_init.sql`: a spoofed score buys nothing. If a
run ever pays out materials, §6.1 applies and this decision has to be
revisited — which is why the scoring lives in `shared/` where a server
can import it.
