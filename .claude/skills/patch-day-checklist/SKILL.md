---
name: patch-day-checklist
description: Run through localbots' patch-day maintenance steps in order after a new WoW content patch drops (new season, new raid tier, mid-season loot changes). Use when the user says something like "patch dropped", "new season", "update for the new patch", or asks what needs updating after a game patch.
---

# Patch-day checklist

The full authoritative version of this lives in `README.md` under **"For
maintainers: patch-day checklist"** — read that section fresh each time
rather than trusting this summary blindly, since the README is what a human
maintainer edits directly and this skill can drift out of sync with it.

Work through these **in order** — later steps depend on earlier ones (simc
must know the new game data before "Refresh data" means anything; the season
config must be right before a droptimizer sim is trustworthy):

1. **Update simc.** The orange "Simc" light in the header (one click), or
   `git pull && ninja -C build simc` for a from-source install. Nothing else
   in this list works until simc actually speaks the new game data.
2. **Refresh data** in the Droptimizer tab (or `/api/refresh` under the
   hood) — re-downloads the wago.tools game tables pinned to the build simc
   now reports. Skip this and the loot database still describes the old patch.
3. **Tell the user to re-copy their character** — `/simc` in-game again.
   Talent trees change every patch; an old export gets rejected with an
   explanation rather than silently misbehaving.
4. **Update `data/season.json`** by hand — this is the one config file with
   no automated source:
   - Upgrade tracks / crafted cap / Voidforged levels: read exactly from
     `raidbots.com/static/data/live/bonuses.json`'s `upgrade` entries (track
     name, step, item level) — these are exact values, never guess them.
   - `upgradeSeasonId`: the `upgrade.seasonId` those same entries carry.
   - Raid / M+ / delve / world-boss drop levels: no clean source exists —
     derive from the previous season's track positions, then confirm against
     in-game tooltips.
   - M+ pool: join `MythicPlusSeasonTrackedMap` (newest `DisplaySeasonID`) to
     `MapChallengeMode` for dungeon names.
   - Delve pool (`data/delve-loot.json`): re-verify every season — delve loot
     is server-side and appears in no client data table.
5. **Regenerate consumable defaults**:
   `node scripts/generate-consumables.mjs ~/tools/simc-src/profiles/<SEASON>`
   once simc ships that season's profiles (e.g. `MID2`).
6. **`data/patches.json`**: the first entry is the live patch. When a PTR
   opens for the *next* patch, add a second entry with `ptr: true` plus its
   own season/consumables/delve files — simc reaches that data automatically
   once it exists.

Everything else (which journal group is the current season, which items the
local simc build can actually sim, which enchants carry no DPS effect) is
derived automatically — don't hand-edit around those.

After finishing, verify with the `local-server-verify` skill: paste a fresh
character export and confirm the Droptimizer's "Items to Sim" lists show the
new season's items with correct ilvls before calling the patch update done.
