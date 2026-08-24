# Glidewood — Product Document

*Working title. A browser-based, vibe-coded-in-spirit gliding squirrel exploration game set in a stylized forest.*

**Version:** 0.1 (Draft)
**Status:** Pre-production planning

---

## 1. Vision & Positioning

Glidewood is a cozy, browser-based 3D exploration game. The player controls a customizable gliding squirrel navigating a forest by launching from tree to tree, collecting materials, and using them to extend how far and how gracefully they can glide. Scattered through the forest are shops, puzzles, cafeterias, and social hubs.

It sits in the lineage of browser "vibe-coded" viral hits (Fly Pieter, VibeSail) but is structurally closer to a lightweight collectathon/metroidvania — it has real progression and an economy, which those reference titles deliberately avoided. That means it can't be shipped in an afternoon the way they were, but the same principles apply: low-poly/stylized art, no install, no heavy onboarding, ambient multiplayer, and cosmetic-only monetization.

**Design pillars:**
- **Glide feel is the product.** If the core movement isn't satisfying, nothing else matters.
- **Soft-gated open world.** Progression paces exploration without hard walls or loading screens.
- **Cosmetics, not power, are for sale.** Customization is core to the fantasy and the safest monetization surface.
- **Ship in phases, each one playable.** Every phase ends in something a real person can open in a browser and enjoy.

---

## 2. Core Gameplay Mechanics

### 2.1 Core loop
Glide → land on a tree → interact (collect / puzzle / shop / social) → accumulate materials → upgrade glide → reach previously-unreachable trees → repeat.

### 2.2 Glide mechanic
- Physics-lite model: gravity + forward velocity + a glide-ratio multiplier (distance traveled per unit of altitude lost)
- Steering via mouse-look or arrow keys, camera-relative
- Momentum matters — no instant direction changes, floaty and forgiving rather than twitchy
- Skill-expressive mechanics layered on top once the base feel is solid:
  - Wind currents near cliffs/canopy gaps (boost/lift)
  - A "flap" move to regain small amounts of height (limited uses per glide, refills on landing)
  - Seasonal/weather events affecting wind (future phase)
- Glide stats improve via upgrades: max distance, turn radius, flap charges, fall speed

### 2.3 World structure
- Forest organized into **zones** of increasing inter-tree distance, naturally gated by glide-stat requirements — no invisible walls, just "you physically can't make that gap yet"
- Most trees are scenery (glide-past, ambient); **10-15% are "destination" trees** with actual content — this ratio is a deliberate scope control, not a placeholder number, and should be revisited once level design is underway
- Landmarks (a central great tree, a waterfall, a lake) for player orientation in an otherwise repetitive canopy

### 2.4 Interactive elements
| Type | Function |
|---|---|
| Shop tree | Spend materials/currency on glide upgrades and cosmetics |
| Puzzle tree | Environmental puzzle gated by glide skill or an item; rewards rare materials |
| Cafeteria tree | Social hub, no mechanical function — pure hangout space, cosmetic flair opportunities |
| Customization tree | Barber-shop equivalent — try on/equip costumes, tail styles, colors |
| NPC squirrels (later phase) | Simple dialogue/quest givers, or ambient world flavor initially |

### 2.5 Customization
Costumes, tail patterns, glide-wing/cape designs, color palettes. Some earned via materials, some purchased with real money — cosmetic only, never power. This is both the emotional core of "it's *your* squirrel" and the primary monetization surface.

---

## 3. Progression & Economy

### 3.1 Currencies
- **Soft currency (materials):** acorns, silk, bark, berries — earned through exploration and puzzles, spent on upgrades and some cosmetics
- **Hard currency (optional, real-money):** for premium cosmetics only. Decide early whether to have this at all vs. direct real-money cosmetic purchases (fewer moving parts, recommended for MVP — add a premium currency later only if there's a reason, e.g. bundling/sales).

### 3.2 Upgrade tree (illustrative, not final)
- Glide distance (5 tiers)
- Turn control / agility (3 tiers)
- Flap charges (3 tiers)
- Fall speed / control in dives (3 tiers)
- Cosmetic-linked stat flavor (optional): certain costumes could have flavor-only stat framing without actual power difference, to avoid "best costume = best stats" perception

### 3.3 Economy design principles
- No pay-to-win: every gameplay upgrade obtainable through play; money only buys cosmetics or time-savers with a low ceiling (if any)
- Rare materials gate the best upgrades behind actual skill/puzzle completion, not pure grind, to keep the loop interesting rather than idle
- Keep the economy small and legible at MVP — a handful of materials and upgrade tiers, expand only once the loop is proven fun

### 3.4 Anti-abuse considerations
Because there's a real economy (unlike the reference titles, which had none), server-side validation of material collection and currency spend is required from day one of persistence — see Security, §5.

---

## 4. Multiplayer & Social

- **MVP multiplayer is ambient/presence-only:** see other players' squirrels gliding through the same forest, rendered as simple meshes with interpolated positions over WebSockets. No authoritative interaction needed at this stage.
- **Cafeteria/social hubs** as a later-phase gathering point — low mechanical risk, high charm payoff
- **Future consideration:** light social features (waves/emotes, trading cosmetics) — deliberately deferred; each adds moderation and abuse-prevention surface area that isn't justified until the core game has retention

---

## 5. Technical Architecture

### 5.1 Frontend
- **Rendering:** Three.js, low-poly/stylized geometry
- **Shading:** `MeshToonMaterial` + inverted-hull outlines for the forest at MVP; custom GLSL shader (quantized lighting bands, rim light) reserved for the squirrel character once core loop is validated — see art notes below
- **State:** vanilla JS or a minimal state layer (avoid a heavy framework; prioritize iteration speed over structure at this stage, refactor once mechanics stabilize)
- **Networking client:** thin WebSocket client sending position/rotation at a fixed tick rate, interpolating remote players between updates

### 5.2 Backend
- **Runtime:** Node.js
- **Realtime layer:** WebSocket server (ws or Socket.io) for presence sync
- **Persistence:** Postgres (recommended over SQLite once there's a real economy and multiple concurrent writers — SQLite is fine for local dev/prototyping, not for production with concurrent players)
- **API:** a small REST or RPC layer for anything not realtime — auth, save/load, shop transactions, cosmetic inventory

### 5.3 Data model (illustrative)
```
Player
  id, display_name, created_at
  glide_stats { distance, agility, flap_charges, fall_control }
  materials { acorns, silk, bark, berries }
  currency_soft, currency_hard
  inventory_cosmetics[]
  equipped_cosmetics{}
  position_last_saved { zone_id, x, y, z }

Zone
  id, name, unlock_requirement (min glide_stats)

Tree
  id, zone_id, type (scenery | shop | puzzle | cafeteria | customization), position

Transaction (log, append-only)
  player_id, type (earn | spend), item, amount, source, timestamp
```
Keeping an append-only transaction log from day one makes economy debugging and anti-cheat auditing dramatically easier later — cheap to add now, expensive to retrofit.

### 5.4 Hosting
- Frontend: static hosting (Vercel/Netlify/Cloudflare Pages)
- Backend: a small VPS or Fly.io/Render app — needs to run a persistent WebSocket process, so a pure serverless platform is a poor fit for the realtime layer specifically (fine for the REST API)
- Database: managed Postgres (Neon, Supabase, RDS) over self-hosted, at least until scale or cost demands otherwise

---

## 6. Security

This matters more here than in the reference titles because there's a persistent economy and real-money purchases — a throwaway multiplayer toy and a game with player-owned progress have very different security bars.

### 6.1 Server authority
- **Never trust the client for anything economically meaningful.** Position/rotation broadcast can stay client-reported for presence (low stakes, cosmetic-only impact if spoofed), but material collection, currency balances, and upgrade purchases must be validated and mutated server-side only.
- Client sends *intents* ("I collected material X at location Y", "I want to buy upgrade Z"); server validates (is that plausible given last known position/time? does the player have enough currency?) before committing.

### 6.2 Auth & sessions
- Standard session/JWT-based auth; if supporting social login (Google/Apple), keep scope minimal (identity only)
- Rate-limit auth endpoints and any economy-mutating endpoint

### 6.3 Anti-cheat (proportionate, not paranoid)
- Sanity-check material collection rate against glide-stat-implied maximum speed/positions (catches obvious speed-hacking or teleport exploits)
- Log all economy transactions (see data model) for post-hoc auditing rather than trying to catch everything in real time at MVP
- Accept that a cozy single-digit-stakes game doesn't need enterprise anti-cheat — proportionate effort here, revisit if abuse actually appears

### 6.4 Payments
- Use Stripe (or similar) for all real-money transactions; never handle card data directly — this keeps PCI scope minimal (SAQ A)
- Cosmetic entitlements granted only after a verified webhook from the payment provider, never on client-reported "purchase successful"

### 6.5 General web hygiene
- Standard input validation/sanitization on all endpoints
- HTTPS everywhere, secure cookie flags
- Dependency scanning (npm audit / Dependabot) given the game will lean on Three.js and various npm packages

---

## 7. Developer Workflow

### 7.1 Repo structure (suggested)
```
/client        - Three.js frontend
/server        - Node backend (API + WebSocket)
/shared         - shared types/constants (e.g. upgrade tables, zone configs)
/docs           - this doc and future design docs
```
A monorepo keeps client/server/shared types in sync easily at this scale (solo or small team); split later only if team/deploy needs actually require it.

### 7.2 Branching & CI
- Trunk-based with short-lived feature branches; given expected team size, avoid heavyweight gitflow
- CI: lint + type-check + basic smoke test on PR; deploy previews for frontend (Vercel does this natively)
- Manual QA pass before merging anything touching the economy or glide feel — these are the two things that are easy to subtly break and hard to catch with automated tests

### 7.3 Local dev environment
- `docker-compose` for local Postgres so dev environment matches production database engine (avoids SQLite/Postgres behavior drift)
- Seed script for test player accounts with pre-filled materials/upgrades, to avoid re-grinding during manual testing
- Hot-reload frontend dev server (Vite) for fast iteration on the glide feel specifically — this loop needs to be as tight as possible since it's the most iterated-on system

### 7.4 Testing strategy
- **Glide physics:** mostly manual playtesting + a few deterministic unit tests on the pure math functions (glide-ratio calculation, upgrade effect application) — feel-based systems resist automated testing, don't over-invest here
- **Economy/backend:** integration tests on transaction validation, purchase flows, and the "can the client cheat this" cases specifically
- **Load/perf:** basic load test on the WebSocket server before any public launch moment (viral spikes are the whole point of this genre — Fly Pieter hit 26k concurrent within a week; being ready for a spike matters more than steady-state load)

---

## 8. Environments & Operations

| Environment | Purpose |
|---|---|
| Local | Individual dev machine, docker-compose Postgres, hot reload |
| Staging | Mirrors production config, used for pre-release testing and playtesting builds |
| Production | Live game |

- **Monitoring:** basic uptime + error tracking (Sentry) from day one; WebSocket connection count and concurrent-player count as key operational metrics, since load spikes are the expected failure mode for this genre
- **Logging:** structured logs on the backend, especially around economy transactions (ties back to the anti-cheat audit trail)
- **Documentation:** keep this doc as the living source of truth for design decisions; maintain a lightweight changelog of shipped features per phase; a short README per repo folder for onboarding (even if it's just future-you)
- **Backups:** automated Postgres backups once real player progress exists — losing player save data is a trust-breaking event for a game with economy/progression, unlike the throwaway reference titles

---

## 9. Phased Roadmap

### Phase 1 — Prove the glide (few days)
- One small forest area, basic glide physics, no persistence, no accounts
- Goal: does the movement feel good? This is the single go/no-go gate for the whole project.
- Deliverable: playable prototype, shareable link, no save state

### Phase 2 — Progression skeleton
- Material collection, one functioning shop, basic glide upgrades
- Player accounts + save/load (Postgres backend introduced here)
- Server-side validation of collection/purchases from the start (§6.1)
- Deliverable: a loop that persists across sessions

### Phase 3 — Multiplayer presence & first content
- WebSocket-based ambient multiplayer (see other squirrels glide)
- 2-3 puzzle trees
- First costume set + customization tree
- Deliverable: a version worth showing people / soft-launching

### Phase 4 — Expansion & polish
- Additional forest zones gated by upgraded glide stats
- Cafeteria/social spaces
- Expanded customization catalog
- Art pass: custom shader work on the squirrel (toon shading + rim light), refined outlines
- Deliverable: launch-ready build

### Phase 5 (post-launch, not yet scoped in detail)
- Additional social features (emotes, trading) — only if warranted by retention data
- Seasonal events / limited cosmetics
- Possible native wrapper (iOS/Android) if browser traction justifies it

---

## 10. Open Questions & Risks

- **Scope risk:** this is meaningfully more complex than the viral reference titles; the biggest risk is over-building before validating the core glide feel is fun. Phase 1's gate is there specifically to de-risk this.
- **Art pipeline:** low-poly is fast to build but "10-15% of trees are destination content" still implies meaningful level-design time — worth prototyping the actual production rate of one destination tree before estimating Phase 3/4 timelines.
- **Currency design:** whether to introduce a hard/premium currency at all, vs. direct cosmetic purchases, is still open — recommend deferring the decision until Phase 3 when real cosmetics exist to sell.
- **Viral spike readiness:** if this follows the genre's pattern and gets a traffic spike, the backend needs to survive it without a rewrite — worth a basic load test before any public push, not after.
- **Working title:** "Glidewood" is a placeholder — worth a naming pass before any public-facing launch.
