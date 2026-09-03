---
name: pr-writing
description: Template and rules for writing pull request descriptions, commit messages, and tracker items so a reviewer can understand the change without reading the diff first. Use when opening a pull request, writing or revising a PR description or title, writing a commit message, or drafting an issue or ticket.
---

# Writing pull requests, commits, and tickets

This skill is self-contained. Copy it into a repository at
`.claude/skills/pr-writing/SKILL.md` to apply it to one project's conventions, and edit
the template there rather than here.

**The one rule underneath all the others:** a pull request description says what the
change *does*. A description that only reports facts about the repository has not been
written yet.

---

## Pull request description

Fill every heading. Do not delete a heading — write the one-line answer instead.

```markdown
## What changed
One to three sentences, plain language, about behavior. Not about files.

## Why
The problem this fixes, described as what went wrong for a person using the app.
Link the tracker item by ID.

## How it works
Only what a reviewer cannot get from reading the diff. If the diff speaks for
itself, write "Diff is self-explanatory." and move on.

## What to check
The one thing a reviewer should look at hardest, and the command to run it.

## Risk
What could break. "None I can see" is a valid answer. Silence is not.
```

Add a closing `## Not in this PR` section when related work is knowingly left undone,
so nobody reviews it by accident. Say plainly whether it is filed and where.

## Rules for the text

- **Title:** imperative, under 70 characters, names the behavior change, not the file.
  "Refresh auth token before expiry", not "Update authService.ts".
- **No bullet list that walks the diff file by file.** The diff already does that.
- **No "This PR introduces…" or "This change enhances…".** Start with a verb or a noun.
- **200 words total**, unless the change is a data migration or touches more than 10
  files.
- **Numerals above nine.** Write 29, not twenty-nine.
- **Never state that a test passes unless you ran it.** Name the command and paste its
  last line.
- **If you need the word "Separately", split the pull request.**

## Commit messages

- Subject: imperative mood, under 70 characters, no trailing period.
- Body only when the *why* is not obvious from the subject. Wrap at 72 characters.
- Never "cleanup", "various fixes", "misc", or "wip" as an entire subject.

## Tracker items

- Title names the symptom, not the suspected cause: "Saving twice loses the first edit",
  not "Race condition in save handler".
- Body states what happened, what was expected, and how to reproduce it. Three lines is
  usually enough.

---

## Worked example

**Bad — a real description, unedited**

> Three `FINDING:` comments across `app/shared/src` flagged that `CloseArea`,
> `RetireContext` and `RetireValue` have no state field to record onto. Separately,
> twenty-nine `§5` derivations across all eleven `domain/*.md` context docs were typed
> `-> Result(_, XError)` even though `shared`'s code had already corrected every one of
> them — twenty-six drop `Result` entirely, and three had already narrowed it to
> `Result(_, Nil)` for a genuine invariant.

It hits every failure pattern in the checklist below. A reader learns two facts about
the repository and never learns what the change does.

**Good — the same content, as two pull requests**

Title: `Correct return types on 29 derivations in domain docs`

> **What changed**
> The eleven `domain/*.md` context documents describe 29 derivations as returning
> `Result`. The code in `shared` does not, and has not for some time. I updated the
> documents to match the code: 26 drop `Result` entirely, and three —
> `AssessPipeline`, `AssessReceivables`, `SumRecurring` — now read `Result(_, Nil)`.
>
> **Why**
> The context documents are the spec people write code against. While a document says
> an operation can fail and the code says it cannot, every reader either writes error
> handling that will never fire or stops trusting the documents. Those three
> `Result(_, Nil)` cases keep a `Result` because one thing really can fail: they refuse
> to add amounts in two different currencies.
>
> **How it works**
> Documentation only. No code changed.
>
> **What to check**
> That those three narrowed signatures are the right three. The other 26 are a
> mechanical deletion.
>
> **Risk**
> Nothing at runtime. If I misread a signature, a document is now wrong in a new way
> rather than the old way.

The three `FINDING:` comments become their own ticket, titled for the symptom:
`CloseArea, RetireContext and RetireValue have nowhere to write their result`.

---

## Check before you open the pull request

Seven patterns, all found in real pull request text. Run every one.

1. **No verb of change** — does the first sentence say what the change *does*, with a
   verb? Reporting the state of the repository is not a description.
2. **"Separately"** — the word means two pull requests. Split, or move the second topic
   to `## Not in this PR`.
3. **Undefined shorthand** — `§5`, `XError`. Would a reader outside this repository
   decode it? Define on first use or delete it. Never leave a placeholder that looks
   like a real identifier.
4. **Missing object** — "no state field to record onto" records *what* onto *what*?
   Every verb gets its object named.
5. **Agentless past perfect** — "had already been corrected" by whom, and in this change
   or an earlier one? Name the actor and the moment.
6. **Counts as the headline** — lead with what changed and let the count follow in the
   same sentence. Numerals above nine.
7. **Stacked subordination** — one subordinate clause per sentence. Break the rest into
   new sentences.
