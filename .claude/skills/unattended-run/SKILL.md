---
name: unattended-run
description: How to work one Linear issue start to finish with no human present, inside the Sandcastle sandbox. Use when a Sandcastle prompt says to, or when running unattended in the sandbox.
---

# Unattended run

Nobody is watching this run. Nobody can answer a question until it is over. Your
job is one Linear issue, taken to one of three endings:

- **done**: the work is committed and verified.
- **review**: the work is committed and verified, but a human must look at it
  before it counts. Rendering changes always end here.
- **park**: you stopped, and the issue comment says exactly what you need.

Every run ends on one of these three. A run that ends any other way leaves the
tracker lying about the state of the code.

Linear commands all go through `.sandcastle/linear.sh`. Run it with no arguments
to see the subcommands.

## Answering your own questions

Other skills ask you to check with the user: `tdd` asks you to confirm seams, and
`diagnosing-bugs` asks you to share hypotheses. In this run, you answer those
questions yourself, using these sources in this order:

1. The issue's text and comments.
2. `CLAUDE.md`, then `docs/glidewood-product-doc.md`, then `docs/decisions.md`.
3. The existing code and tests.

Make the call, and put it in your closing comment under **Decisions**, so a
human can overturn it cheaply. For `tdd`, the issue's acceptance criteria are
the agreed seams.

Some questions have no answer in those sources:

- a product or scope call the docs leave open
- anything needing credentials or accounts you do not have
- work that `CLAUDE.md`'s scope discipline puts in a later phase

Any of those means **park**. Guessing is worse than parking. A wrong guess costs
a human the time to find it and then undo it.

## Steps

### 1. Pick and read

Take the issue with the lowest number from the list in your prompt, so repeated
runs pick in the same order. Read it in full with `linear.sh view <ID>`,
comments included, since earlier runs and humans leave context there.

Done when: you can state, in one sentence, what will be true when this issue is
finished. If you cannot, park with a comment naming what is unclear.

### 2. Work

Follow `CLAUDE.md`, and let it win whenever a skill's example code disagrees
with it. The Three.js skills use classes, `window` globals and their own render
loops; this repo uses factory functions, and its loop lives in `sim/` with an
injected clock. The `vitest` skill describes Vitest 5, and this repo runs
Vitest 3, so check `node_modules/vitest/package.json` before using an API the
existing tests do not already use.

Change only the files the issue needs.

### 3. Verify

Run `npm run verify` and read the last lines of its output. It must exit 0.
Follow `verification-before-completion`.

If verify is red, fix and rerun. After three red runs on the same failure,
stop: park the issue, with the failing output and what you tried in the
comment. Then restore every file you changed to its committed state
(`git status` lists them).

A change to anything under `client/src/render/` cannot be seen from here.
Finish and commit it, and end on **review**, with a comment naming what a
human should look at in the browser.

### 4. Commit

Make one commit on the current branch, following the `pr-writing` skill, with
the issue ID in the subject: `LAN-123: …`. Stay on the branch you started on.
The commit is the whole hand-off: the human decides when to push.

Done when: `git status` is clean, and `git log -1` shows your commit.

### 5. Report and close

Post one comment with `linear.sh comment <ID> "<text>"`:

```
**What changed:** <the behavior that is different now>
**Commit:** <short sha> on <branch>
**Verified:** npm run verify, <last line of its output>
**Decisions:** <each call you made in place of asking, or "none">
**Needs a human:** <what to look at, or "nothing">
```

Then run `linear.sh done <ID>` or `linear.sh review <ID>`. Output
`<promise>COMPLETE</promise>`.

### Parking

When you park, post a comment in place of the report above. The comment says
what you tried, what stopped you, and the one question or action that unblocks
the issue. Then run `linear.sh park <ID>`, which moves the issue to Backlog, so
the next run does not pick it up again. A human moves it back to Todo once it
is answered. Output `<promise>COMPLETE</promise>`.

## Secrets

`LINEAR_API_KEY` and `CLAUDE_CODE_OAUTH_TOKEN` stay in the environment. Refer to
them by name in commands, and write `<REDACTED>` wherever a value would appear
in output you quote.
