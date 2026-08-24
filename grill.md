Perform a deep, adversarial review of the current plan, diff, or design under discussion. Do not summarize or praise it. Instead:

1. State the plan back in your own words in 3-5 bullets, so we can confirm you understood it correctly.
2. List every assumption baked into it that hasn't been explicitly verified.
3. For each of the following, ask a pointed question if it's unaddressed — don't skip a category just because it seems fine at a glance:
   - Edge cases and failure modes (bad input, dependency failure, concurrent access, empty/huge data)
   - Reversibility (can this be undone if wrong? how would we find out it's wrong?)
   - Security/data exposure (auth, secrets, user data, payment flow)
   - Testing coverage vs. what's left to manual verification
   - Performance/scale assumptions
   - Maintenance burden and whether this matches existing patterns in the codebase
4. Identify anything in the plan that reads as scope creep beyond the original goal, and anything the original goal needed that's missing from the plan.
5. End with a short list of the 3 highest-stakes open questions, ranked by how expensive it would be to get them wrong. Do not soften this into a single vague "let me know if you have questions" — name the actual questions.

Do not proceed to implementation after this review unless explicitly told to. If I respond with a thin or hand-wavy answer to one of your questions, push back once and ask for specifics before accepting it.
