# 01 — Anchor purchases to a shop the server checks

Status: ready-for-agent

## The problem

`client/src/sim/shop.js` builds a purchase intent carrying `treeId` and
`atPosition`, and its header says that is so the server can check it:

> Being perched at the shop is part of the claim. D-27 anchors a collection to
> a position the server can recompute; a purchase carries the tree it was made
> at for the same reason — buying a tier from mid-air, or from the spawn perch
> on the other side of the forest, is not something the server should have to
> take on trust.
>
> — `client/src/sim/shop.js:15`

That is not true. The anchor is built and then dropped on the floor:

- `client/src/net/api.js:141` sends `{ upgrade: upgradeKey }` and nothing else.
  `treeId` and `atPosition` never leave the browser.
- `server/src/domain/economy.js:116` checks the tier, the price and the
  balance. It never looks at where the player was standing, and never loads the
  tree.

So "you must be perched at a shop" is enforced by the client alone — by
`createShopLedger`'s `openTree` being non-null. Product doc §6.1 is explicit
that a rule the client alone enforces is not enforced.

## Why it matters, and why it is not urgent

Nothing here creates materials. The debit in `economy.purchase()` is atomic and
server-side, and the price comes from the server's own catalogue (D-25), so a
forged purchase still costs exactly what the real one costs. The exposure is
narrower: a player can buy from anywhere — mid-glide, from the spawn perch,
without ever having found a shop.

That matters for one reason, and it is a design reason rather than a security
one. Finding a shop in the treeline is the navigation half of the Phase 2 loop
(D-28), and the mauve canopy exists to make that findable. A purchase that
works from the spawn branch deletes that half of the loop for anyone who
notices.

It is also a comment that lies about a security property, which is the kind of
thing that gets believed later.

## What to do

**1. Send the anchor.** `api.purchase()` takes the intent rather than just the
key, and posts `{ upgrade, treeId, position }`. The intent already carries
both — `client/src/sim/shop.js` sets `atPosition` to the shop's perch.

**2. Check it server-side**, in `economy.purchase()`:

- Load the tree from the world the server already regenerates for the player's
  seed — `worldCache.forSeed(player.worldSeed)` at
  `server/src/domain/economy.js:20`. The tree's `type` is right there.
- Refuse when the tree is not `TREE_TYPES.SHOP`, and when the claimed position
  is further from that tree than `config.validation.claimRadius`.
- Apply the same travel bound collection uses. `checkReachable` is already
  exported on its own at `server/src/domain/validation.js:40`, so this is
  reuse, not a second implementation of the rule.
- On success, write the position anchor the way `collect()` does, so a purchase
  does not leave a stale anchor for the next collection to be measured against
  (D-27).

**3. New refusal reasons** in `server/src/http/respond.js`'s
`STATUS_BY_REASON`. `not_at_shop` → 422 fits the existing shape alongside
`not_at_cache`. `implausible_travel` already exists and can be reused.

**4. Handle the refusal in the panel.** `refusalText()` in
`client/src/ui/shop-panel.js` needs a line for `not_at_shop`. It should not
normally be reachable — the panel only renders while a shop is open — so
something plain like "You are not at the counter."

**5. Fix the comment.** Once this lands, `client/src/sim/shop.js:15` becomes
true. If any of it is deliberately left out, edit that paragraph to say what is
actually checked.

## Verification

- Unit tests in `server/test/cheating.test.js`, which is where the existing
  anti-cheat cases live: a purchase claimed at a scenery tree is refused; one
  claimed at a shop the player could not have reached in the elapsed time is
  refused; one made while genuinely perched at a shop succeeds.
- A client test in `client/test/sync.test.js` asserting the anchor is actually
  on the wire — the existing "sends no price with a purchase" test is the model
  for the shape.
- `npm run verify`.

## Notes

Worth deciding while implementing: whether a refused-for-position purchase
should clear the intent or retry. D-30 puts every 4xx in the "answer, clear it"
bucket, and there is no reason for this one to be different — but it is worth
being deliberate rather than inheriting it by accident.
