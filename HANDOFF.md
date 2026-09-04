# Handoff — 2026-09-04

**Branch:** `devel` (clean, at `eeec310`) · **Open PRs:** #12, #13

## What this session was about

Phase 2 is finished and passing. The question was what makes Glidewood *fun*,
and the answer we picked is **run mode**: a run is a chain of perch landings
with no ground contact in between, scored by distance times a chain multiplier
times a bonus for trees the run has not used yet. Hitting the ground ends the
run and banks it. Nothing is taken away — you keep every material — so it adds
stakes without costing the game its calm.

The full design story, the fixed contract every ticket builds against, and all
five tickets are in [`run-mode-tasks.md`](run-mode-tasks.md) at the repo root.
**Read that file first.** It is the source of truth for this feature and it is
committed to `devel`.

WebSocket multiplayer is explicitly deferred — we want a fun single-player game
before touching presence.

## Completed this session

- **`run-mode-tasks.md` written and committed to `devel`** (`6b64dcb`). Carries
  the story, a Contract section fixing the scoring signatures, the simulation
  event names and the HTTP shape, plus five tickets scoped to build in parallel.
- **T1 merged — PR #11.** `shared/src/run.js` with `startRun`, `extendRun`,
  `endRun`, `runMultiplier` and `isBankable`; `RUN_TUNING` appended to
  `shared/src/constants.js`; 14 tests; decision D-28.
  - Two things differ from the brief's contract, and later tickets must use the
    real signatures: `extendRun` takes `tuning` as an optional third argument,
    and `isBankable(run, tuning?)` exists so nothing compares against
    `minChainToBank` by hand.
- **T2 built — PR #13 open, `claude/run-persistence`.** Migration `003` adds
  four best-run columns to `players`; `POST /api/player/run` stores a run only
  when it beats the stored best; `bestRun` also returned from
  `GET /api/player/me`. Ran the real-PostgreSQL suite: `Tests 216 passed (216)`.
- **T3 built — PR #12 open, `claude/run-tracker`.** `client/src/sim/run.js`
  tracks the run in progress and `createSimulation` emits `run:started`,
  `run:extended` and `run:ended`. Events match the contract exactly; `points` is
  the score delta, so a HUD summing events cannot drift from the total.
- **Both PRs reviewed diff by diff.** Purely additive, no deletions of
  consequence, all SQL parameterised, both within their declared file scope.

### Ticket status

| Ticket | What | State |
|---|---|---|
| T1 | Run scoring in `shared/` | Merged, PR #11 |
| T2 | Best run persistence | PR #13 open, reviewed |
| T3 | Run tracker and events | PR #12 open, reviewed |
| T4 | The run HUD | Not started — wave 2 |
| T5 | Syncing the finished run | Not started — wave 2 |

T4 and T5 were deliberately held back. Both can be *written* against the
contract, but neither can be *verified* until T3 is on `devel`: T4 is a HUD and
CLAUDE.md says rendering is checked by looking at it, and T5 needs a run that
actually ends. Both also append to `client/src/main.js`, so whichever merges
second will take a small conflict there.

## Next step

Merge PR #13, then rebase PR #12 onto `devel` and renumber its two decision
entries to D-30 and D-31 — the renumber is the one thing standing between the
two branches and a clean merge, and T4 and T5 cannot start until T3 lands.

## Blockers

- **Two different D-29 entries.** T3 wrote `D-29 — The tree you scamper up
  after a fall scores nothing` and `D-30 — The run tracker returns events`;
  T2 wrote `D-29 — The best run is four columns on players`. Both append to the
  end of `docs/decisions.md`, so GitHub calls each mergeable against `devel`
  while the second merge will conflict. Caused by the brief saying "take D-29
  onward" without assigning a range per ticket — give T4 and T5 explicit ranges.
- **Both agent runs came back with a harness security warning** ("Blocked by
  classifier"). The diffs are clean — additive only, parameterised SQL, no
  network calls or credential handling — and nothing in them explains it. Best
  guess for T2 is running the README's own
  `DATABASE_URL=postgres://glidewood:glidewood@localhost:5432/glidewood npm test`,
  since a credential-shaped string on a command line trips classifiers whether
  or not it is a real secret. **There is no explanation for T3's warning.** Read
  both diffs before merging.
- **Migration `003` has not been applied to the local dev database.** T2
  deliberately did not run it, because that writes to real data. Run
  `npm run migrate --workspace server` before playing against a local server.

## Cleanup left on disk

Two agent worktrees are untracked under `.claude/worktrees/`:

```
.claude/worktrees/agent-ad3ce68b2138eb847   claude/run-tracker
.claude/worktrees/agent-af579b94943cfa87f   claude/run-persistence
```

Both branches are pushed, so nothing is lost by removing them:

```bash
git worktree remove .claude/worktrees/agent-ad3ce68b2138eb847
git worktree remove .claude/worktrees/agent-af579b94943cfa87f
```

## Verifying where things stand

```bash
npm run verify                    # lint, test, build — clean on devel
gh pr list --state open           # should show #12 and #13
```
