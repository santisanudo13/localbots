# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Localbots is a locally-hosted alternative to Raidbots: a Node/Express server that wraps a
local SimulationCraft (`simc`) install with a plain HTML/JS/CSS frontend (no build step,
no framework). It sims a pasted WoW `/simc` export (or an Armory lookup) to produce DPS,
gear-upgrade ("Top Gear"), and full droptimizer reports.

## Commands

```bash
npm install     # install deps (just express)
npm start        # runs server/index.js, serves on http://localhost:4747
```

There is no build step, linter, or test suite configured — `public/` is served as static
files as-is and `server/` runs directly under Node's native ESM (`"type": "module"`).
Verify changes by running `npm start` and exercising the feature in a browser — see the
`local-server-verify` skill (`.claude/skills/local-server-verify/`) for the reliable way
to background the dev server in this environment and drive it with Playwright, including
a ready-to-paste sample character export. A `PostToolUse` hook (`.claude/settings.json`)
runs `node --check` on any `.js` file Edit/Write touches, as the only automated syntax
safety net given there is no linter.

`simc` must be resolvable (on PATH, or via `SIMC_PATH` env var) or the server refuses to
start (`server/index.js` calls `findSimc()` at boot). See README for installing simc
from source (needed for droptimizer accuracy/probing to work against a current build).

`scripts/generate-consumables.mjs <simc-profiles-dir>` regenerates
`data/season.json`'s consumable defaults from simc's own shipped profiles — run once per
new season (see "For maintainers: patch-day checklist" in README).

## Architecture

**No framework, no bundler.** Backend is a single Express app (`server/index.js`, ~1230
lines) that wires together a set of focused modules under `server/`; frontend is one
`public/app.js` (~3550 lines) doing DOM manipulation directly against `public/index.html`,
talking to the backend over plain JSON `fetch` + Server-Sent Events for live sim progress.

**Wowhead hovercards, everywhere, off real item ids.** Any item, gem, enchant or
consumable shown anywhere in the UI (results tables, "Also compare" pickers, the
droptimizer's item lists, crafted-gear suggestions) renders through `itemTile()` /
`tileDataAttrs()` / `wowheadLinkedTile()` in `public/app.js`, which wrap an `<img>` in an
`<a data-wowhead="...">` — the public Wowhead widget only auto-attaches its tooltip to a
real anchor, never a bare `<img>`. The `data-wowhead` value always carries the item's own
`bonus_id`s (and, for droptimizer items, an explicit `ilvl=`) pulled straight from the
simc line that was actually simmed, so the hovercard shows the exact roll being discussed
instead of Wowhead's default/random one — see `bonusIdsFromLine()`/`craftedStatsFromLine()`
in `public/app.js`. Locale (`es:item=...` vs `item=...`) follows the app's own EN/ES
toggle. After any DOM update that adds new item tiles, call `paintItemIcons()` (fetches
icon files by id, batched) then `loadWowheadWidget().then(refreshWowheadLinks)`.

**The sim pipeline** (the core flow all three features — Quick Sim, Top Gear,
Droptimizer — funnel through):
1. `gearParser.js` parses a pasted `/simc` addon export into structured gear/character data.
2. `profileBuilder.js` (Quick Sim / Top Gear) or `droptimizer.js` (full droptimizer) turns
   that + user-chosen options into a simc input file, optionally as simc *profilesets* (one
   baseline + many cheap delta variants in a single simc process) for comparison modes.
3. `simRunner.js`'s `SimQueue` runs `simc` as a child process — **one sim at a time,
   server-wide**, queueing everyone else and reporting queue position — and streams
   progress back to the browser as SSE (`/api/sim/:id/events`).
4. Output is parsed back into a report and optionally persisted via `history.js`
   (`data/history/`) and rendered as a single self-contained HTML file by `report.js`
   ("Save report").

**Game data lives outside simc**, in `data/`:
- `data/season.json` — hand-maintained per season: upgrade tracks, crafted/Voidcore item
  levels, `upgradeSeasonId`. Read by `droptimizer.js`/`enhancements.js`.
- `data/patches.json` — the Live/PTR patch list; each patch has its own cached game-data
  set and season config.
- `data/cache/` — downloaded [wago.tools](https://wago.tools) DB2 CSVs (loot tables, item
  stats/effects, set bonuses), fetched/parsed by `wagoData.js`, `itemStats.js`,
  `itemEffects.js`. This is what "Refresh data" re-downloads; it's keyed per patch build
  so a simc rebuild invalidates and re-fetches it.
- `data/delve-loot.json` — delve loot pool, hand-maintained (no client DB lists it).

**Supporting modules**: `armory.js`/`blizzard.js` (character lookup, live Blizzard API or
keyless raider.io fallback), `itemIcons.js` (icon resolution), `talents.js`/`talentData.js`
(loadout parsing/decoding for the talent-build comparison feature), `setBonus.js`
(item-set / Minimum-Set-Bonus logic), `equippedResolver.js` (resolving "what's currently
equipped" for delta comparisons), `lootFilter.js`/`dropLevels.js` (which items are
obtainable by class/spec and at what item level per source), `simcProbe.js` (probes which
items the local simc build can actually simulate, since game data ships unreleased
content), `simcUpdater.js` (one-click simc rebuild for from-source installs), `status.js`
(the header's "behind GitHub" / "behind live game" indicator lights).

**Multiplayer note**: when shared (e.g. via Docker), the sim queue and `data/history/`
are shared across all users hitting the same server; each user's in-progress character
paste/settings live only in their own browser (not persisted server-side per-user).

## The droptimizer's "Sources" / "Items to Sim" UI (Raidbots-style)

This was rebuilt to match Raidbots' droptimizer instead of the original raw
per-instance/difficulty checkboxes:

- `server/droptimizer.js`'s `buildSourceTree()` attaches an `items` array to every raid
  boss / dungeon / crafted-gear entry (id, name, usable slots, per-difficulty drops where
  applicable — `itemsForUi()` for drops, `craftedRepresentatives()` for crafted, which
  collapses same-stat-template crafts to one representative per (class, subclass,
  invType, embellished) so a plate helm doesn't list six times).
- `public/app.js`'s `itemsToSimRow()` renders that list as icon + real Wowhead hover +
  a per-item checkbox (`data-exclitem`), exactly like Raidbots' "click any item to
  toggle inclusion". `collectDroptSelection()` reads every unchecked box into
  `selection.excludeItemIds`, and `buildDroptimizerInput()`'s `addItem`/`addCrafted` are
  the single choke point that honors it — so exclusion works identically across raids,
  M+, world boss, outdoor and crafted gear.
- A raid's item list shows the live ilvl(s) for whichever difficulty checkboxes are
  currently ticked (multiple at once shows e.g. `295 / 308`), recomputed on every
  difficulty toggle via `raidBossItemsHtml()` — see the delegated `change` listener in
  `renderDroptSources()`'s setup block. Unticking every difficulty on a raid disables and
  unchecks its items (nothing to simulate), rather than leaving them looking includable.
- **Crafted gear** is one master checkbox (`#dropt-crafted`) that disables the *entire*
  module — ilvl, "Preferred Stats", Voidcores, "Include embellished crafts" and its
  embellishment picker, and the item list — when off, instead of leaving sub-controls
  independently toggleable. "Preferred Stats" is a multi-select checkbox grid (one,
  several, or all stat combos; always keeps at least one ticked — there's no sensible
  "simulate nothing" state). An optional "Sparks available" number input plus a live
  `picked/budget` counter (`updateCraftedSparksStatus()`) warns — never auto-drops items —
  when more crafted items are ticked than the player can actually afford to craft (one
  Spark per new item, regardless of which stat combo is rolled).
- The 2-embellished-item equip cap (a game rule simc doesn't enforce) is checked in
  `buildDroptimizerInput()`'s crafted branch (`capOk()`/`equippedEmbSlots`) against what's
  currently equipped plus whatever a given profileset row would add — this is separate
  from, and unaffected by, the UI toggles above.

## Docs worth reading before large changes

- `README.md` — full user-facing feature docs, options reference, and the "For
  maintainers: patch-day checklist" (what must be updated by hand each WoW patch).
- `docs/ROADMAP.md` — planned droptimizer source additions and what was decided against.
- `docs/TODO.md` — open work items with more detail than the roadmap.
- `DOCKER.md` — server-deployment specifics (shared history, shutdown-button gating via
  `LOCALBOTS_ALLOW_SHUTDOWN`, patch-day rebuilds).

## Claude Code skills for this repo

- `.claude/skills/local-server-verify/` — how to reliably background the dev server in
  this sandboxed environment and drive it with Playwright to actually confirm a UI/backend
  change works (there's no test suite). Load before claiming a frontend/backend change is
  verified.
- `.claude/skills/patch-day-checklist/` — the "For maintainers: patch-day checklist" from
  this file's companion `README.md`, turned into a step-by-step skill for when a new WoW
  content patch drops.
