# Proposal — The drey and the tailor

*Status: proposal. Nothing here is built, and nothing here is decided until a
human accepts it and it is folded into the product doc. It sits beside
[`proposal-grove-tending.md`](proposal-grove-tending.md), and the two are meant
to be weighed together.*

## The ask

Brian, 2026-09-27, after calling Phase 1 passed and choosing to delay
multiplayer:

> "Can squirrels have their own nests (dreys?) they can decorate like little
> homes. Are there objects to collect to decorate these nests? Are there
> little clothes for the squirrels to wear? The squirrel could collect a lot
> of forest things so they can then go to a tailor (some other woodland
> animal) and get custom clothes made."

## The pitch in one paragraph

**You find things, you keep them, and they end up somewhere you can see
them.** Scattered through the forest are **keepsakes**: single, named objects
such as a blue jay feather, a snail shell, a hiker's lost button or a
pressed violet. Each one is found in one kind of place. You carry keepsakes
home to your **drey**, a nest in a tree of your own, and set them out as
decoration. Some keepsakes, together with the silk and bark you already
collect, go to **the tailor**, a magpie who keeps a workshop in her
domed nest and makes clothes to order. The capes, scarves and goggles she makes
are visible on your squirrel in flight.

## The problem this solves

Gliding is proven fun (Phase 1). What the game lacks is a reason to fly
*somewhere in particular*.

Today, landing on a tree banks acorns, bark, silk or berries (D-15). Those
are currencies. Forty acorns and forty-three acorns feel the same, and no one
remembers where they found acorn number 41. A currency tells you to fly
*more*. It never tells you to fly *there*.

A keepsake is different. "The blue feather on top of Rookery Spire" is a
destination, a memory and, once it is on the drey wall, a trophy. That is the
pleasure a collection gives in [Animal Crossing](https://en.wikipedia.org/wiki/Animal_Crossing)'s
museum or [A Short Hike](https://en.wikipedia.org/wiki/A_Short_Hike)'s
feathers: every item has a story about where it came from.

## How it plays

### Keepsakes

- **Named and singular.** You find each keepsake once and keep it. It is an
  object, never a stack of currency.
- **Found by place.** Each kind has a habitat that tells you where to look:
  feathers on the tallest trees, shells near the water, mushrooms on low
  mossy stumps, lost human things along the old footpath. Knowing the forest
  becomes the skill.
- **Rarity follows reach.** D-18 already biases rare materials toward hard
  trees. Keepsakes use the same rule: the rarest ones sit on towering trees,
  behind skims, or at the end of a puzzle ring course.
- **Some show only sometimes** (a later addition, if day and night are
  built): fireflies' glass jar at dusk, a dew-covered web at dawn.
- **A field journal** records every kind you have found, with a silhouette
  for the ones you haven't. A blank silhouette is a quiet invitation to go
  looking, not a checklist with a counter.

Illustrative starting set, about 20 kinds:

| Group | Examples | Where |
|---|---|---|
| Feathers | jay, owl, woodpecker, heron | Tall and towering trees |
| Shells and stones | snail shell, river pebble, geode | Water's edge, low perches |
| Plants | pressed violet, four-leaf clover, pine cone | Clearings, stumps |
| Lost things | button, marble, thimble, key | Along the footpath |
| Rare | golden acorn, amber with a beetle inside | Puzzle rewards, towering trees |

### The drey

- **One per player**, in a home tree you choose early on from a small set.
  The game already draws dreys in destination canopies (LAN-524), so the mesh
  has a starting point.
- **Decoration slots, not free placement.** The drey has a fixed set of
  places where things can go: the rim, the wall inside, a shelf, a hanging
  point, the roof. Each keepsake fits one kind of slot. Slots keep the art
  and the UI small, and an arrangement of five feathers still feels like
  yours.
- **Home is a launch point.** The drey sits on a real perch, so going home is
  a glide, and every outing starts from it.
- **Nothing to maintain.** The drey never gets messy, cold or damaged.

### The tailor

- **A magpie** (name to be chosen; Brian's choice, 2026-09-27). Magpies are
  known for collecting bright, odd things, so a magpie who cares about your
  lost buttons and blue feathers explains itself. Her own nest can show off
  her hoard, which hints at keepsakes the player hasn't found yet.
- **She works in silk and bark,** two of the four existing materials, so the
  tailor gives them a use beyond upgrades.
- **She lives at a fixed tree** you have to glide to. Her tree is a
  destination tree of a new type, registered through the interaction registry
  as CLAUDE.md describes.
- **Clothes are made to order.** A garment is a pattern plus what you bring.
  A cape needs silk plus one feather, and the feather decides the colour and
  trim. The same pattern made with an owl feather and with a jay feather gives
  two different capes. That is where "custom" comes from, with no colour
  picker.
- **Four garments to start:** cape, scarf, goggles, acorn-cap hat. Each shows
  clearly in the chase camera's view during flight, since flight is where the
  player sees their squirrel most.
- **Clothes are cosmetic only.** A cape never changes glide stats. Upgrades
  stay with the shop (product doc §1, "cosmetics, not power").

### The loop

1. Launch from the drey.
2. Glide toward a place where a keepsake you're missing might be found.
3. Pick up materials on the way, as today.
4. Stop at the tailor to order a garment, or collect one.
5. Fly home and set out what you found.

## Rules that keep it cozy

1. **Nothing is ever lost.** Keepsakes don't break, clothes don't wear out,
   and nobody can steal from your drey.
2. **No timers.** A garment is ready as soon as you order it. A wait adds
   pressure without adding fun.
3. **Every keepsake can be found without paying.** Keepsakes are the
   trophies, and a trophy that can be bought stops meaning anything.
4. **No comparison.** No drey ratings and no leaderboards, the same rule as
   run mode.

## How it fits the architecture

A sketch to show the idea fits CLAUDE.md, not an implementation plan.

- **Keepsake placement is seed-derived, in `/shared`**, like caches (D-16).
  Both sides compute the same list from the world seed, and the server keeps
  no world geometry (D-22).
- **Picking up a keepsake is an intent.** The client raises
  `keepsake:found`, and the server checks the player is where the keepsake is
  and hasn't found it already, then records it (§6.1, D-17). The client
  never decides what it owns.
- **Storage is small.** One row per found keepsake (`player_id`,
  `keepsake_id`, `found_at`), one row per drey slot, and one per owned
  garment. No JSON blobs (D-23).
- **The tailor is a registry handler** on a new `TREE_TYPES.TAILOR`. It
  emits `tailor:opened` and `tailor:closed`, and the order UI lives in
  `client/src/ui/`, as the shop does.
- **The drey interior is a separate view**, not a place in the 3D forest.
  Landing on your home tree opens it. That keeps it out of the glide loop
  and the render budget.

## Risks and tensions

- **Clothes on a moving squirrel are the hardest art.** The squirrel is a
  procedural mesh in `client/src/render/squirrel.js`, and it bends between a
  gliding pose and a clinging pose. A cape has to follow both without
  poking through. Mitigation: start with the hat and the goggles, which sit
  on the head and don't bend.
- **Twenty keepsakes means twenty small models.** They can be tiny and
  low-poly, and most are simple shapes (feather, shell, button). It is still
  real art time, and the product doc already warns about art production rate
  (§10).
- **It changes what can be sold.** The product doc plans to sell cosmetics
  for real money (§2.5). If clothes come from things you find, a bought
  garment competes with an earned one. Selling *patterns* but not keepsakes
  keeps the trophies honest, but that is a decision for later.
- **It reorders the roadmap.** Customization was planned for Phases 3 and 4.
  This proposal pulls it forward and replaces the doc's "customization tree"
  with the tailor.

## How it relates to grove tending

The two proposals share one drey: this proposal's drey is grove tending's
home tree (decided 2026-09-27). They would work together. Grove
tending gives a daily reason to return, and keepsakes and the tailor give
the reason to explore. If only one is built first, this one is smaller: it
needs no real-time growth, no new perches, and it doesn't risk bypassing
zone gating.

## Decisions (all four answered 2026-09-27)

1. ~~Who is the tailor?~~ **Decided: a magpie** (Brian, 2026-09-27). The
   first draft proposed a spider, for the tie to silk.
2. ~~Slots or free placement in the drey?~~ **Decided: fixed slots for now**
   (Brian, 2026-09-27). Free placement can come later on top of them.
3. ~~Is this drey grove tending's home tree?~~ **Decided: yes, they are the
   same drey** (Brian, 2026-09-27). Whichever proposal is built first builds
   it, and the other adds to it.
4. ~~Which comes first: keepsakes or the tailor?~~ **Decided: keepsakes and
   the journal first** (Brian, 2026-09-27). They give flights a purpose on
   their own, and the tailor needs keepsakes before she has anything to work
   with.
