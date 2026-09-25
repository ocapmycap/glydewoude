# Handoff — 2026-09-25

**Branch:** `add-skills` (2 commits ahead of `devel`, not pushed) · **Open PRs:** none

## What this session was about

Run mode's first three tickets have landed on `devel`, and this session set up
**unattended agent runs** so the remaining tickets can be worked without a person
at the keyboard. An agent in a Docker sandbox ([Sandcastle](https://github.com/mattpocock/sandcastle))
works Linear issues labelled `ready-for-agent`, one per iteration, and commits to
its own branch, `agent/glidewood`. A person merges that branch.

Run mode itself is unchanged: [`run-mode-tasks.md`](run-mode-tasks.md) is still
the source of truth for the feature, and **T4 and T5 are the work left**.

## Completed this session

- **PR #12 and PR #13 merged into `devel`.** T2 (best-run persistence) and T3
  (run tracker and events) are in. The duplicate D-29 was resolved in the merge:
  `devel` now has D-29, D-30 and D-31 once each. **The next free decision number
  is D-32.**
- **Sandcastle set up in `.sandcastle/`**, modelled on grillmaster-gleam's:
  - `main.ts` runs up to 5 iterations on `agent/glidewood`, cut from `devel`, and
    prints a status line every 5 minutes and a summary at the end.
  - `tracker/tracker.mjs` reads the Linear project **Glidewood** (P-LAN-19). It
    lists issues labelled `ready-for-agent`, and closes each one to In Review
    labelled `approved-by-agent` or `ready-for-human`.
  - `claude-home/` holds four subagents (`scout`, `test-writer`, `implementer`,
    `reviewer`) and deny rules that block `git push`, `checkout`, `stash` and
    reading `.env`.
  - `prompt.md` gives the orchestrator its loop: scout, baseline, red, green,
    review, commit, comment, close.
- **Seven skills added to `.claude/skills/`**, read in full before installing:
  `vitest`, `tdd`, `diagnosing-bugs`, `verification-before-completion`,
  `threejs-fundamentals`, `threejs-animation`, alongside the existing `pr-writing`.
- **Two trial runs**, both on the earlier one-agent loop:
  - LAN-510, "Propose some names": Done. The names are in its Linear comment.
  - LAN-512, "Propose a game mechanic": In Review. It wrote
    `docs/proposal-grove-tending.md` (commit `b3513fb` on `agent/glidewood`) and
    ends with four questions for you.
- **Fixed a lint failure this session introduced.** `eslint.config.js` now gives
  `.sandcastle/**/*.mjs` Node globals; without that, `npm run verify` failed on
  `tracker.mjs`.

### Ticket status

| Ticket | What | State |
|---|---|---|
| T1 | Run scoring in `shared/` | Merged, PR #11 |
| T2 | Best run persistence | Merged, PR #13 |
| T3 | Run tracker and events | Merged, PR #12 |
| T4 | The run HUD | LAN-517, Backlog |
| T5 | Syncing the finished run | LAN-516, Todo, `ready-for-agent` |

T5 suits the first real agent run: it has a real failing test
(`client/test/run-sync.test.js`) and a pattern to copy (`position-sync.js`). T4
is a HUD the sandbox cannot see, so its run would end on a visual check. Both
append to `client/src/main.js`; whichever merges second takes a small conflict.

## Next step

Merge `add-skills` into `devel`, so the tracker, subagents and lint fix are on
the branch the agent builds from. Then run `npx tsx .sandcastle/main.ts` from the
repo root: it picks up LAN-516 (T5).

LAN-516 and LAN-517 each carry their own decision range, **D-32–D-33** and
**D-34–D-35**, so two branches never append the same number again.

## Open items

- **LAN-512 needs your answers.** Read `docs/proposal-grove-tending.md` on
  `agent/glidewood` and answer its four questions in Linear. Merging
  `agent/glidewood` brings the proposal document with it; drop commit `b3513fb`
  first if you do not want it on `devel`.
- **Migration `003` on the local dev database was not checked this session.** If
  it still has not been applied, run `npm run migrate --workspace server` before
  playing against a local server.
- **`main` is 22 commits behind `devel`.**

## Verifying where things stand

```bash
npm run verify                                  # lint, test, build — passes on add-skills
gh pr list --state open                         # should show nothing
node .sandcastle/tracker/tracker.mjs list       # ready-for-agent issues, as JSON
```

The tracker needs `LINEAR_API_KEY` from `.sandcastle/.env` in the environment.
