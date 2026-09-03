// The per-patch item tables: names, slots, classes, and the budget/damage/armor
// curves wago ships as raw DB2 CSVs. Used to resolve item names/slots/quality
// (droptimizer.js, index.js) -- the tooltip stat computation this file used to
// also provide (itemStats()/effectContext(), and itemEffects.js's spell-effect
// rendering) was replaced by linking hovercards straight to Wowhead's own
// widget instead, so it and its now-unused scaling-curve machinery were removed.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.js';

export function loadItemTables(cacheDir) {
  const read = (name, cols) => {
    const p = join(cacheDir, `${name}.csv`);
    return existsSync(p) ? parseCsv(readFileSync(p, 'utf8'), cols) : null;
  };

  const rpp = read('RandPropPoints', ['ID', 'EpicF_0', 'EpicF_1', 'EpicF_2', 'EpicF_3', 'EpicF_4',
    'DamageReplaceStatF', 'DamageSecondaryF']);
  if (!rpp) return null;
  const budget = new Map(rpp.map((r) => [Number(r.ID),
    [+r.EpicF_0, +r.EpicF_1, +r.EpicF_2, +r.EpicF_3, +r.EpicF_4]]));
  // the separate budgets item effects scale against
  const damageBudget = new Map(rpp.map((r) => [Number(r.ID),
    { replaceStat: +r.DamageReplaceStatF, secondary: +r.DamageSecondaryF }]));

  const sparse = read('ItemSparse', [
    'ID', 'Display_lang', 'OverallQualityID', 'InventoryType', 'ItemDelay', 'DmgVariance',
    'StatPercentEditor_0', 'StatPercentEditor_1', 'StatPercentEditor_2',
    'StatPercentEditor_3', 'StatPercentEditor_4', 'StatPercentEditor_5',
    'StatModifier_bonusStat_0', 'StatModifier_bonusStat_1', 'StatModifier_bonusStat_2',
    'StatModifier_bonusStat_3', 'StatModifier_bonusStat_4', 'StatModifier_bonusStat_5',
    'Bonding', 'RequiredLevel', 'AllowableClass',
  ]);
  if (!sparse) return null;
  const items = new Map();
  for (const r of sparse) {
    const allocs = [];
    for (let i = 0; i < 6; i++) {
      const stat = Number(r[`StatModifier_bonusStat_${i}`]);
      const alloc = Number(r[`StatPercentEditor_${i}`]);
      if (stat >= 0 && alloc !== 0) allocs.push({ stat, alloc });
    }
    items.set(Number(r.ID), {
      name: r.Display_lang,
      quality: Number(r.OverallQualityID),
      invType: Number(r.InventoryType),
      delay: Number(r.ItemDelay),
      variance: Number(r.DmgVariance),
      bonding: Number(r.Bonding),
      requiredLevel: Number(r.RequiredLevel),
      allowableClass: Number(r.AllowableClass), // class bitmask, -1 = any class
      allocs,
    });
  }

  const cls = read('Item', ['ID', 'ClassID', 'SubclassID']);
  const classes = new Map((cls ?? []).map((r) => [Number(r.ID), { cls: Number(r.ClassID), sub: Number(r.SubclassID) }]));

  const dmgRow = (name) => {
    const rows = read(name, ['ItemLevel', 'Quality_4']);
    return rows ? new Map(rows.map((r) => [Number(r.ItemLevel), Number(r.Quality_4)])) : null;
  };
  const armorTotal = read('ItemArmorTotal', ['ItemLevel', 'Cloth', 'Leather', 'Mail', 'Plate']);
  const armorLoc = read('ArmorLocation', ['ID', 'Clothmodifier', 'Leathermodifier', 'Chainmodifier', 'Platemodifier', 'Modifier']);

  return {
    budget,
    damageBudget,
    items,
    classes,
    dmg1h: dmgRow('ItemDamageOneHand'),
    dmg2h: dmgRow('ItemDamageTwoHand'),
    armorTotal: armorTotal ? new Map(armorTotal.map((r) => [Number(r.ItemLevel),
      { 1: +r.Cloth, 2: +r.Leather, 3: +r.Mail, 4: +r.Plate }])) : null,
    // per armour class, keyed by Item.SubclassID (1 cloth .. 4 plate). The
    // generic Modifier column disagrees with the class-specific ones on several
    // slots -- shoulders read 0.13 there but 0.11 for plate -- so it is unused.
    armorLoc: armorLoc ? new Map(armorLoc.map((r) => [Number(r.ID), {
      1: +r.Clothmodifier, 2: +r.Leathermodifier, 3: +r.Chainmodifier, 4: +r.Platemodifier,
    }])) : null,
  };
}
