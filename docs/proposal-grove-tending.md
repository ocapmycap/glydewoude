# Proposal — Grove tending

*Status: proposal for LAN-512. Nothing here is built, and nothing here is
decided until a human accepts it and it is folded into the product doc.*

## The ask

LAN-512 asks for a cozy mechanic in the spirit of farming in Stardew Valley.
It should be low stress, produce benefits, be something you come back to, let
the player customise their tree, squirrel, interface and play, and above all
be enjoyable.

## The pitch in one paragraph

**You plant acorns and grow your own trees.** Each player has a **home tree**,
their drey. Around it and scattered through the forest are **clearings**,
empty patches of ground where a sapling could go. You drop an acorn into a
clearing by landing on the clearing's marker stump. Over the next few
real-world hours it grows from seedling to sapling to young tree, and at every
stage it gives something back: a small harvest the first time you perch on it
each day, and once it is grown, **a new perch that exists only in your
forest**. The trees you grow change the routes you can fly. What you grow and
where you grow it customises your squirrel and your drey, and over time it
shapes the forest to fit how you like to glide.

It is farming where the tending is done by gliding. That is the reason for
choosing it over the alternatives below: the chore is the product's core verb
(§1, "glide feel is the product") rather than a menu sitting beside it.

## Why this fits Glidewood

| LAN-512 asks for | How grove tending answers |
|---|---|
| Low stress | Nothing wilts, dies or is lost. Missing a day costs nothing, and growth simply waits. |
| Produces benefits | Daily harvests of the existing four materials, plus a few grove-only ones used for cosmetics. |
| Repeatable | A daily rhythm (visit, harvest, replant) with no cap on how long you keep doing it. |
| Customise the tree | The drey is decorated with what the grove produces. |
| Customise the squirrel | Grove-only dyes and trims feed the §2.5 cosmetics. |
| Customise the interface | Seasonal HUD themes and a pressed-leaf journal, unlocked by what you have grown. |
| Customise the gameplay | Grown trees are new perches, so you build your own routes and run-mode chains. |
| Enjoyable | Tending means flying a route you designed yourself, which is the part of the game already proven fun. |

It also reuses what is already built:

- **Landing is already the interaction verb.** D-15 made collection happen on
  perch. Planting and harvesting are two more perch interactions, registered
  through `createInteractionRegistry` exactly as CLAUDE.md describes. No new
  proximity system is needed in the step loop.
- **The economy already has the right shape.** Acorns become the seed stock,
  which gives the most common material a second sink besides upgrades.
  Harvests are ledger intents that the server settles (D-17).
- **Run mode gets richer without changing.** A grown tree is a perch like any
  other, so a player who plants a line of trees across a gap has built a
  run-mode course. No scoring change is needed.

## How it plays

### The daily loop

1. Launch from the drey.
2. Fly a route past your plantings, landing on each one that is ready. Each
   ready planting gives a small harvest, once per real-world day.
3. Plant acorns in any empty clearing you land on.
4. On the way home, detour for the wild caches that are already in the game.
5. Back at the drey, spend grove materials on decorations and cosmetics.

A full tending round should take about five minutes of gliding. A player who
wants to do nothing but glide can ignore the grove entirely, and loses nothing
except the extras it produces.

### Growth

| Stage | Real time after planting | What it gives |
|---|---|---|
| Seedling | 0 | Nothing yet; a small marker you can see from the air |
| Sapling | ~4 h | A small daily harvest when you land on the clearing stump |
| Young tree | ~24 h | A real perch with a canopy, plus a larger daily harvest |
| Mature | ~3 days | Full height, and a chance of a rare grove material |

Growth runs on **wall-clock time since planting**, not on time spent playing.
That is the cozy-game convention: you come back tomorrow and it has grown. It
is also the only design the server can validate cheaply (see below).

There is no watering and no weeding. Those chores exist in farming games to
create a reason to come back every day, and in Stardew they come with a
penalty for skipping them. Here the daily harvest is the reason to come back,
and there is no penalty for skipping.

### Species

A handful of species, each planted from a different seed and each yielding
something different. This is illustrative, and the numbers are for tuning:

| Species | Planted from | Yields | Grown shape |
|---|---|---|---|
| Oak | acorns | acorns, bark | Tall, wide canopy: a forgiving perch |
| Birch | acorns + bark | bark, silk | Slender and tall: a high launch point |
| Berry bush-tree | berries | berries, **dye petals** | Short and wide: a low stepping stone |
| Willow | silk + acorns | silk, **soft fibre** | Drooping canopy: an easy catch from the side |

Species is where gameplay customisation comes from. A tall birch gains you
height for the next launch, and a squat berry tree is a safe bail-out
halfway across a gap. Choosing what to plant is choosing the shape of your
route.

### Grove-only materials and what they buy

Two new materials, dye petals and soft fibre, come only from the grove and
buy only cosmetics. That keeps them out of the upgrade economy, so the grove
cannot become a faster path to glide stats than exploration (§3.3, "rare
materials gate the best upgrades behind actual skill… not pure grind").

- **Squirrel:** dyed fur palettes, tail patterns, woven cape trims (§2.5).
- **Drey:** lanterns, leaf bunting, a moss roof, a hammock, a pressed-flower
  wall. Visible to other players once Phase 3 presence exists.
- **Interface:** HUD themes (spring blossom, autumn, night) and a **grove
  journal**, a pressed-leaf page for every species you have grown to maturity.
  This is the collection-book pleasure that cozy games lean on.

## Rules that keep it cozy

These are the parts of the proposal worth defending in review.

1. **Nothing is ever lost.** No wilting, no pests, no decay, no stealing. A
   planting left alone for a month is simply ready.
2. **No timers on screen.** A planting shows its stage by how it looks, never
   as a countdown. Countdowns create the "I must log in at 3:40" pressure the
   issue is asking us to avoid.
3. **Harvests do not pile up.** A ready planting holds one day's harvest and
   stops there. Coming back after a week is not punished, and it does not pay
   out a week's worth either, so there is no reason to feel you should have
   come back sooner.
4. **The grove is never required.** Every upgrade stays reachable through
   exploration and puzzles alone. The grove speeds up cosmetics and adds
   perches. It never gates the main progression.
5. **No leaderboard, no comparison.** Run mode set the same rule for the same
   reason.

## How it fits the architecture

This section is a sketch, to show the idea can be built without bending
CLAUDE.md. It is not an implementation plan.

- **Clearings are seed-derived, in `/shared`.** Like trees (D-3) and caches
  (D-16), a clearing is a point derived from the world seed, placed in gaps
  worldgen already leaves. Both sides compute the same list, and the server
  stores no world geometry (D-22).
- **Only plantings are stored.** A row per planting holds `player_id`,
  `clearing_id`, `species`, `planted_at` and `last_harvested_on`. Stage is
  never stored. It is `growthStage(species, plantedAt, now)`, a pure function
  in `/shared` that the server evaluates against its own clock. This is the
  reason growth is based on wall-clock time: the server needs nothing but a
  timestamp to check a claim.
- **Planting and harvesting are intents.** The client raises
  `grove:plant` and `grove:harvest` intents, and the server checks the
  clearing, the stage and the once-a-day rule and settles the ledger (§6.1,
  D-17). A client that lies about growth gets nothing, because growth is
  never the client's claim.
- **Grown trees join the world as an overlay.** `createSimulation` receives
  the seeded world plus the player's grown plantings, turned into ordinary
  tree records. Landing, glide and run code do not change. They already
  accept whatever trees they are given.
- **Handlers follow the registry rules.** A new `TREE_TYPES.CLEARING` gets a
  handler that emits `grove:*` events and does not touch the DOM or the
  glider.

## Risks and tensions

- **Planted trees can bypass zone gating.** §2.3 gates zones by the gaps you
  cannot yet cross. If you can plant a stepping stone into any gap, the glide
  upgrades stop mattering. Proposed mitigation: clearings exist only inside
  the zones you can already reach, and grown trees are shorter than the
  zone's own trees, so they give you a new route but not new reach. This
  needs a playtest.
- **It is a personal forest in a shared world.** Once Phase 3 presence
  arrives, other players' squirrels will perch on trees you cannot see. Two
  options: plantings stay private (simplest, and recommended), or everyone's
  grown trees are visible but only the owner can harvest them. Deciding
  between these belongs to Phase 3.
- **Real-time growth invites clock abuse.** It does not work here, because
  the server's clock decides growth. It is still worth a test when this is
  built.
- **Scope.** This is a new system, not a tweak: a table, a migration, new
  shared functions, a handler, new meshes and a UI surface. It belongs after
  Phase 3 (cosmetics and the customization tree have to exist for the grove
  to have anything to buy). Nothing about it should jump ahead of the current
  roadmap.

## Alternatives considered

- **Foraging rounds.** Wild caches respawn daily and you fly a route to
  collect them. This is the lightest option, but it is just the existing
  cache system on a timer. It gives no customisation and no sense of
  ownership.
- **Drey building alone.** Decorate a home tree with found materials. This
  is good for customisation and is included above, but on its own it has no
  repeatable loop beyond "collect more".
- **Birdwatching or a photo journal.** Spot and photograph forest creatures.
  It is charming and very low stress, but it produces no benefit the
  economy can use and adds a camera mode to a game whose camera is tuned for
  flight. It is a good candidate to add to the grove journal later.
- **Pollination runs.** Fly through blossoms to pollinate them. This
  conflicts with D-15 (no mid-air collection) and makes the tending twitchy
  rather than calm.

Grove tending folds in the best part of each of these: the routes from
foraging, the home from drey building, and the collection book from
birdwatching.

## Questions for a human

1. Is a player-grown forest the direction you want? That is the product call
   this proposal is really asking you to make.
2. Should plantings be private to each player, or shared?
3. Where does this go on the roadmap? The proposal assumes it comes after
   Phase 3's cosmetics, and not sooner.
4. Are two grove-only cosmetic materials acceptable, given §3.3 asks for a
   small economy at MVP?
