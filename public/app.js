const $ = (id) => document.getElementById(id);

let currentJobId = null;
let eventSource = null;
let mode = 'quick';
let gearItems = []; // last parsed bag/vault items, indexes match checkboxes
let catalystSlots = null; // slot -> {id, name}, this class's real tier piece (from /api/gear)
let searchItems = []; // items added via "Item search" — { name, id, ilvl, targetIlvl, slot, section: 'Search', line }
let equippedEnchGemBySlot = {}; // slot -> {enchantId, gemIds}, what every candidate for that slot is actually simmed with
let itemSets = []; // detected item sets from /api/gear
let setMinimums = {}; // setId -> chosen minimum bonus (0/2/4)
let season = null; // upgrade tracks + voidcore info from the patch's season config

// ---------- header: running/queued sims, from any page (Docker/shared-server aware) ----------
// Polled rather than pushed over SSE -- it's one small flat list, and every
// sim (yours or, on a shared server, someone else's) needs to show up here
// regardless of which page of the app you're currently on.
async function refreshSimChips() {
  const el = $('sim-chips');
  if (!el) return;
  let jobs = [];
  try {
    jobs = (await (await fetch('/api/queue')).json()).jobs ?? [];
  } catch {
    return; // offline blip -- keep whatever was last shown rather than blank it
  }
  el.innerHTML = jobs.map((j) => {
    const detail = j.status === 'running'
      ? (j.percent != null ? `${j.percent}%` : (lang === 'es' ? 'en curso' : 'running'))
      : (lang === 'es' ? `#${j.position} en cola` : `#${j.position} queued`);
    return `<span class="sim-chip ${j.status}" data-job="${esc(j.id)}" title="${esc(j.label)}">
      <span class="dot"></span>${esc(j.label)} · ${esc(detail)}
    </span>`;
  }).join('');
}
if (!document.getElementById('sim-chips')?.dataset.chipsBound) {
  document.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.sim-chip');
    if (!chip) return;
    const id = chip.dataset.job;
    const label = chip.title;
    const msg = lang === 'es' ? `¿Parar "${label}"?` : `Stop "${label}"?`;
    if (!confirm(msg)) return;
    fetch(`/api/sim/${id}/cancel`, { method: 'POST' }).then(refreshSimChips);
  });
}
refreshSimChips();
setInterval(refreshSimChips, 3000);

// ---------- patch switch (Live / PTR) ----------
let patch = localStorage.getItem('localbots-patch') ?? 'live';
let patchDefs = [];

// ---------- language switch (item/set/loot names) ----------
// English is always cached; Spanish is downloaded the first time it's
// selected and "Refresh data" is hit, same as a brand-new patch — see
// server/index.js's getPatch(). This never changes the sim math, only which
// language item/set/instance names come back in.
const LANGS = [{ id: 'en', label: 'EN' }, { id: 'es', label: 'ES' }];
let lang = localStorage.getItem('localbots-lang') ?? 'en';

// ---------- UI text translation (separate from the item/set/loot game-data
// text above, which comes from wago.tools per patch) ----------
// Every static label/hint/button/header in the app, keyed by a stable id.
// `tr(key)` looks it up for the current language; `applyI18n()` walks the DOM
// once (and again on every language switch) filling in textContent for
// [data-i18n], the `title` attribute for [data-i18n-title], and `placeholder`
// for [data-i18n-placeholder].
const I18N = {
  en: {
    tagline: 'your hardware, your sims',
    'nav.newSim': 'New sim', 'nav.history': 'History',
    'quicknav.label': 'Quick Nav:', 'quicknav.character': 'Character', 'quicknav.fight': 'Fight',
    'quicknav.buffs': 'Buffs', 'quicknav.consumables': 'Consumables', 'quicknav.gear': 'Gear',
    'quicknav.loot': 'Loot sources',
    'tab.quick': 'Quick Sim', 'tab.topgear': 'Top Gear', 'tab.droptimizer': 'Droptimizer', 'tab.statweights': 'Stat Weights',
    'h2.character': 'Character',
    'src.addon': 'SimC Addon', 'src.armory': 'Armory',
    'src.addonHint': 'In game: type <code>/simc</code>, copy the text (Ctrl+C / Cmd+C), paste it below.',
    'src.addonPlaceholder': "# Paste your /simc addon export here\nwarrior=\"Yourname\"\nlevel=90\nspec=fury\n...",
    'src.armoryHint': 'Look the character up by name — no addon needed. Gear comes from the last public scan of the character, so anything swapped in the last few minutes may be missing; the addon export is always exact.',
    'src.region': 'Region', 'src.realm': 'Realm', 'src.character': 'Character', 'src.import': 'Import',
    'h2.fight': 'Fight',
    'fight.style': 'Fight style',
    'fight.style.patchwerk': 'Patchwerk (single target, raid boss)',
    'fight.style.dungeonslice': 'DungeonSlice (M+ style packs)',
    'fight.style.hectic': 'HecticAddCleave (heavy add cleave)',
    'fight.style.dummy': 'Training dummy (stand still & pump)',
    'fight.enemies': 'Enemies', 'fight.enemiesFixed': 'set by the fight style',
    'fight.length': 'Fight length (seconds)',
    'fight.precision': 'Precision',
    'fight.precision.fast': 'Fast (target error 0.5%)',
    'fight.precision.normal': 'Normal (target error 0.2%)',
    'fight.precision.high': 'High (target error 0.1%)',
    'fight.precision.extreme': 'Extreme (target error 0.05%, Raidbots Smart Sim grade)',
    'fight.precision.fixed': 'Fixed iterations…',
    'fight.iterations': 'Iterations',
    'h2.buffs': 'Raid buffs', 'buffs.allOn': 'Everything on', 'buffs.allOff': 'Everything off',
    'buff.bloodlust': 'Bloodlust / Heroism', 'buff.arcaneIntellect': 'Arcane Intellect',
    'buff.battleShout': 'Battle Shout', 'buff.markOfTheWild': 'Mark of the Wild',
    'buff.pwFortitude': 'PW: Fortitude', 'buff.mysticTouch': 'Mystic Touch',
    'buff.chaosBrand': 'Chaos Brand', 'buff.skyfury': 'Skyfury', 'buff.huntersMark': "Hunter's Mark",
    'h2.consumables': 'Consumables', 'consumable.flask': 'Flask', 'consumable.food': 'Food',
    'consumable.potion': 'Potion', 'consumable.augmentation': 'Augment rune', 'consumable.weaponOil': 'Weapon oil',
    'h2.filterSlot': 'Filter Sim by Slot',
    'gear.filterHint': 'Click one or more slots to tick only their items below; click a highlighted slot again to drop it, or clear them all to show every slot.',
    'h2.itemSearch': 'Item search',
    'gear.searchHint': "Add any item by name at any item level — not limited to what's in your bags.",
    'gear.searchPlaceholder': 'Search for an item…',
    'h2.itemsToCompare': 'Items to compare',
    'gear.itemsHint': 'Gear found in your bags (and vault choices) inside the export. Each ticked item is simmed in place of what you have equipped.',
    'gear.all': 'All', 'gear.none': 'None',
    'gear.maxUpgrade': 'Highest affordable upgrade',
    'gear.maxUpgradeTitle': "Sets each item's sim level to the highest step its own track's crests can afford (20 crests per step), read from upgrade_currencies= in your export",
    'gear.catalyst': 'Catalyze selected items',
    'gear.catalystTitle': "Adds a 'Catalyzed' section below with the real tier piece each looted (non-crafted) item in a tier slot becomes when run through the Catalyst — tick the ones you want compared, same as any other item",
    'h2.itemSets': 'Item sets',
    'gear.setsHint': 'Minimum set bonus to keep — suggestions that would break it are hidden.',
    'gear.trackUpgrades': 'Track upgrades (equipped gear)', 'gear.trackUpgradesSub': 'what is each upgrade worth?',
    'gear.upgradeTo': 'Upgrade to',
    'track.step2': '2/6 of its track', 'track.step3': '3/6 of its track', 'track.step4': '4/6 of its track',
    'track.step5': '5/6 of its track', 'track.step6': '6/6 — fully upgraded',
    'gear.voidcores': '+ Voidcores (weapons & trinkets)',
    'gear.trackUpgradesHint': 'Each item sims alone (plus one "all together" row). Item levels come from your export; the track is guessed from the level — untick anything that looks off.',
    'h2.alsoCompare': 'Also compare',
    'sets.equipped': 'equipped', 'sets.owned': 'owned',
    'sets.anyTitle': 'No set bonus protected — every suggestion is shown, even ones that break it',
    'sets.hideBelowTitle': 'Hide suggestions that would drop below the {n}-piece bonus',
    'sets.any': 'Any', 'sets.setN': '{n} set',
    'loadout.active': 'Active — the baseline', 'loadout.simThis': 'sim this',
    'loadout.couldNotRead': 'Could not read this build:', 'loadout.unknown': 'unknown',
    'loadout.remove': 'Remove', 'loadout.added': '(added)',
    'loadout.addBuild': 'Add a build', 'loadout.pasteHint': 'Paste a talent string (in-game export, Wowhead, Archon…)',
    'loadout.namePlaceholder': 'Name (optional)', 'loadout.stringPlaceholder': 'Paste the talent string here',
    'loadout.addBuildBtn': 'Add build',
    'loadout.invalidString': 'That does not look like a talent string — copy the whole thing.',
    'loadout.noSaved': 'No saved loadouts in this export — save one in game and re-copy /simc.',
    'loadout.cantDraw': "Builds still sim — they just can't be drawn.",
    'loadout.hero': 'hero',
    'enchSlot.weapon': 'Weapon (dual-wielders sim every MH × OH combination)',
    'enchSlot.chest': 'Chest', 'enchSlot.head': 'Head', 'enchSlot.feet': 'Feet', 'enchSlot.legs': 'Legs',
    'enchSlot.ring': 'Rings (every pair combination)',
    'compare.consumables': 'Consumables', 'compare.enchants': 'Enchants', 'compare.gems': 'Gems',
    'compare.omniumFolio': 'Omnium Folio', 'compare.talentBuilds': 'Talent builds',
    'compare.weaponOil': 'Weapon oil', 'compare.flask': 'Flask', 'compare.food': 'Food', 'compare.potion': 'Potion',
    'compare.noDpsEnchant': "no DPS-affecting {cat} enchant this season — this season's only give tertiary stats",
    'compare.statGems': 'Stat gems (whole setup swapped per gem)',
    'compare.eversongDiamonds': 'Eversong Diamonds (swapped in your diamond socket)',
    'compare.folioHint': 'Every rune that can move DPS, one row at a time{skipped}. Needs the omnium_talents line from a current /simc export.',
    'compare.folioSkipped': ' ({n} defensive row{s} left out — healing, absorbs and movement speed)',
    'compare.talentsPlaceholder': 'Paste your /simc export — your in-game builds appear here.',
    'h2.lootSources': 'Loot sources', 'dropt.includeAll': 'Include everything',
    'dropt.refresh': 'Refresh data', 'dropt.refreshTitle': 'Re-download game data from wago.tools (updates with game patches)',
    'dropt.upgradeItems': 'Upgrade items to',
    'dropt.upgradeItemsTitle': 'Sim every item upgraded within its own track (e.g. a Mythic raid drop at Myth 4/6). World boss / outdoor items are unaffected.',
    'dropt.asDropped': 'As dropped (no upgrades)',
    'dropt.voidcoreTitle': 'Ascendant Voidcores: only fully upgraded (6/6) Hero and Myth track weapons and trinkets — Hero → 285, Myth → 298',
    'dropt.applyVoidcores': 'Apply Voidcores (whenever possible)',
    'dropt.tierTitle': "An item put into a tier slot would break your set bonus and read as a big loss. With this on, those rows keep the bonus — the Catalyst turns a drop into your tier piece while keeping its own stats, sockets and effects — so the row shows the stat difference on its own.",
    'dropt.keepTier': 'Keep my tier set bonus (as if catalysed)',
    'dropt.offspecTitle': "Also sim items whose primary stat isn't yours (e.g. Intellect pieces on an Agility spec) — armor type and weapon proficiency are still enforced",
    'dropt.offspec': 'Include off-spec items',
    'dropt.scanHint': 'Full scans sim hundreds of items — the Fast precision preset is recommended; expect several minutes.',
    'sim.button': 'Sim it', 'sim.cancel': 'Cancel',
    'sim.compareGear': 'Compare gear', 'sim.runDroptimizer': 'Run droptimizer', 'sim.calcStatWeights': 'Calc stat weights',
    'lang.enTitle': 'Item, set and loot names in English (always available)',
    'lang.esTitle': 'Item, set and loot names in Spanish -- the first time you pick this, hit “Refresh data” to download it',
    'slot.head': 'head', 'slot.neck': 'neck', 'slot.shoulder': 'shoulder', 'slot.back': 'back', 'slot.chest': 'chest',
    'slot.wrist': 'wrist', 'slot.hands': 'hands', 'slot.waist': 'waist', 'slot.legs': 'legs', 'slot.feet': 'feet',
    'slot.finger1': 'finger 1', 'slot.finger2': 'finger 2', 'slot.trinket1': 'trinket 1', 'slot.trinket2': 'trinket 2',
    'slot.mainHand': 'main hand', 'slot.offHand': 'off hand', 'slot.weapons': 'weapons',
    'filter.all': 'All', 'filter.allSlots': 'All slots', 'filter.consumables': 'Consumables', 'filter.enchants': 'Enchants',
    'filter.gems': 'Gems', 'filter.omniumFolio': 'Omnium Folio', 'filter.talentLoadouts': 'Talent loadouts',
    'filter.loadout': 'Loadout', 'filter.rings': 'Rings', 'filter.trinkets': 'Trinkets', 'filter.weapon': 'Weapon',
    'filter.upgrades': 'Upgrades', 'filter.equipped': 'Equipped', 'filter.bags': 'Bags', 'filter.catalyzed': 'Catalyzed',
    'filter.search': 'Search', 'filter.row': 'Row', 'bucket.talentBuild': 'Talent build', 'bucket.enchant': 'Enchant',
    'h2.simHistory': 'Sim history',
    'history.hint': 'Every finished sim is saved here automatically. Click one to view its results again on the right.',
    'results.backToSetup': '← Back to setup',
    'progress.simulating': 'Simulating…',
    'results.baselineDps': 'baseline DPS (equipped gear)', 'results.filterItems': 'Filter items…',
    'results.yourTopGear': 'Your Top Gear', 'results.bestSetup': 'Best setup',
    'results.highlightedHint': 'Highlighted slots beat what you have equipped — enchant & gems shown for the rest carry over to every candidate in that slot in Details.',
    'th.item': 'Item', 'th.source': 'Source', 'th.dps': 'DPS', 'th.change': 'Change', 'th.vsEquipped': 'vs equipped',
    'h2.statWeights': 'Stat weights', 'th.stat': 'Stat', 'th.dpsPerPoint': 'DPS per point', 'th.relativeToTop': 'Relative to top stat',
    'h2.damageBreakdown': 'Damage breakdown', 'th.ability': 'Ability', 'th.casts': 'Casts', 'th.share': 'Share',
    'h2.buffUptimes': 'Buff uptimes', 'th.buff': 'Buff', 'th.uptime': 'Uptime',
    'empty.hit': 'Paste your character, pick a fight, hit <strong data-i18n="sim.button">Sim it</strong>.',
    'empty.resultsHint': 'Results appear here with DPS, damage breakdown, and buff uptimes.',
    'footer.runsLocally': 'Localbots runs entirely on this machine', 'footer.github': 'Localbots on GitHub',
    'footer.saveReport': 'Save report',
    'footer.saveReportTitle': 'Save this result as one HTML file you can send to someone — it opens in any browser',
    'footer.shutdown': 'Shut down server',
    'status.appOk': 'Localbots up to date', 'status.appOutdated': 'Localbots update available',
    'status.appUnknown': 'Localbots — can’t check',
    'status.simcOk': 'Simc up to date', 'status.simcOutdatedClick': 'Simc outdated — click to update',
    'status.simcOutdated': 'Simc outdated', 'status.simcUnknown': 'Simc — can’t check',
    'status.simcUpdateFailed': 'Simc update failed', 'status.simcUpdating': 'Simc updating…',
    'status.simcStillOutdated': 'Simc still outdated',
  },
  es: {
    tagline: 'tu hardware, tus simulaciones',
    'nav.newSim': 'Nueva sim', 'nav.history': 'Historial',
    'quicknav.label': 'Navegación rápida:', 'quicknav.character': 'Personaje', 'quicknav.fight': 'Combate',
    'quicknav.buffs': 'Mejoras', 'quicknav.consumables': 'Consumibles', 'quicknav.gear': 'Equipo',
    'quicknav.loot': 'Fuentes de botín',
    'tab.quick': 'Sim rápida', 'tab.topgear': 'Mejor equipo', 'tab.droptimizer': 'Droptimizer', 'tab.statweights': 'Peso de stats',
    'h2.character': 'Personaje',
    'src.addon': 'Addon SimC', 'src.armory': 'Armería',
    'src.addonHint': 'En el juego: escribe <code>/simc</code>, copia el texto (Ctrl+C / Cmd+C) y pégalo abajo.',
    'src.addonPlaceholder': "# Pega aquí tu export del addon /simc\nwarrior=\"Tunombre\"\nlevel=90\nspec=fury\n...",
    'src.armoryHint': 'Busca el personaje por nombre — no hace falta el addon. El equipo viene del último escaneo público del personaje, así que algo cambiado en los últimos minutos puede faltar; el export del addon siempre es exacto.',
    'src.region': 'Región', 'src.realm': 'Reino', 'src.character': 'Personaje', 'src.import': 'Importar',
    'h2.fight': 'Combate',
    'fight.style': 'Estilo de combate',
    'fight.style.patchwerk': 'Patchwerk (un objetivo, jefe de banda)',
    'fight.style.dungeonslice': 'DungeonSlice (estilo M+ con grupos)',
    'fight.style.hectic': 'HecticAddCleave (oleadas intensas de secuaces)',
    'fight.style.dummy': 'Muñeco de entrenamiento (quieto y a pegar)',
    'fight.enemies': 'Enemigos', 'fight.enemiesFixed': 'fijado por el estilo de combate',
    'fight.length': 'Duración del combate (segundos)',
    'fight.precision': 'Precisión',
    'fight.precision.fast': 'Rápida (error objetivo 0.5%)',
    'fight.precision.normal': 'Normal (error objetivo 0.2%)',
    'fight.precision.high': 'Alta (error objetivo 0.1%)',
    'fight.precision.extreme': 'Extrema (error objetivo 0.05%, nivel Smart Sim de Raidbots)',
    'fight.precision.fixed': 'Iteraciones fijas…',
    'fight.iterations': 'Iteraciones',
    'h2.buffs': 'Mejoras de banda', 'buffs.allOn': 'Todo activado', 'buffs.allOff': 'Todo desactivado',
    'buff.bloodlust': 'Ansia de sangre / Heroísmo', 'buff.arcaneIntellect': 'Intelecto arcano',
    'buff.battleShout': 'Grito de guerra', 'buff.markOfTheWild': 'Marca de la salvaje',
    'buff.pwFortitude': 'PS: Fortaleza', 'buff.mysticTouch': 'Toque místico',
    'buff.chaosBrand': 'Marca del caos', 'buff.skyfury': 'Furia celeste', 'buff.huntersMark': 'Marca de caza',
    'h2.consumables': 'Consumibles', 'consumable.flask': 'Frasco', 'consumable.food': 'Comida',
    'consumable.potion': 'Poción', 'consumable.augmentation': 'Runa de aumento', 'consumable.weaponOil': 'Aceite de arma',
    'h2.filterSlot': 'Filtrar sim por ranura',
    'gear.filterHint': 'Haz clic en una o varias ranuras para marcar solo sus objetos abajo; haz clic de nuevo en una ranura resaltada para quitarla, o límpialas todas para mostrar todas las ranuras.',
    'h2.itemSearch': 'Buscar objeto',
    'gear.searchHint': 'Añade cualquier objeto por nombre a cualquier nivel de objeto — no limitado a lo que llevas en las bolsas.',
    'gear.searchPlaceholder': 'Buscar un objeto…',
    'h2.itemsToCompare': 'Objetos a comparar',
    'gear.itemsHint': 'Equipo encontrado en tus bolsas (y elecciones de la bóveda) dentro del export. Cada objeto marcado se simula en lugar de lo que llevas equipado.',
    'gear.all': 'Todos', 'gear.none': 'Ninguno',
    'gear.maxUpgrade': 'Mayor mejora asequible',
    'gear.maxUpgradeTitle': 'Fija el nivel de sim de cada objeto al mayor paso que sus cristas puedan pagar (20 cristas por paso), leído de upgrade_currencies= en tu export',
    'gear.catalyst': 'Catalizar objetos seleccionados',
    'gear.catalystTitle': "Añade una sección 'Catalizado' abajo con la pieza real de conjunto en la que se convierte cada objeto looteado (no crafteado) de una ranura de conjunto al pasar por el Catalizador — marca los que quieras comparar, igual que cualquier otro objeto",
    'h2.itemSets': 'Conjuntos de objetos',
    'gear.setsHint': 'Bonificación mínima de conjunto a mantener — las sugerencias que la romperían se ocultan.',
    'gear.trackUpgrades': 'Mejoras de camino (equipo actual)', 'gear.trackUpgradesSub': '¿cuánto vale cada mejora?',
    'gear.upgradeTo': 'Mejorar a',
    'track.step2': '2/6 de su camino', 'track.step3': '3/6 de su camino', 'track.step4': '4/6 de su camino',
    'track.step5': '5/6 de su camino', 'track.step6': '6/6 — totalmente mejorado',
    'gear.voidcores': '+ Núcleos del Vacío (armas y abalorios)',
    'gear.trackUpgradesHint': 'Cada objeto se simula solo (más una fila "todos juntos"). Los niveles de objeto vienen de tu export; el camino se adivina por el nivel — desmarca lo que parezca incorrecto.',
    'h2.alsoCompare': 'También comparar',
    'sets.equipped': 'equipado', 'sets.owned': 'en propiedad',
    'sets.anyTitle': 'Ninguna bonificación de conjunto protegida — se muestra cualquier sugerencia, aunque la rompa',
    'sets.hideBelowTitle': 'Oculta sugerencias que bajen de la bonificación de {n} piezas',
    'sets.any': 'Cualquiera', 'sets.setN': '{n} piezas',
    'loadout.active': 'Activa — la base', 'loadout.simThis': 'simular esta',
    'loadout.couldNotRead': 'No se pudo leer esta build:', 'loadout.unknown': 'desconocido',
    'loadout.remove': 'Quitar', 'loadout.added': '(añadida)',
    'loadout.addBuild': 'Añadir una build', 'loadout.pasteHint': 'Pega una cadena de talentos (export del juego, Wowhead, Archon…)',
    'loadout.namePlaceholder': 'Nombre (opcional)', 'loadout.stringPlaceholder': 'Pega aquí la cadena de talentos',
    'loadout.addBuildBtn': 'Añadir build',
    'loadout.invalidString': 'Eso no parece una cadena de talentos — copia el texto completo.',
    'loadout.noSaved': 'No hay builds guardadas en este export — guarda una en el juego y vuelve a copiar /simc.',
    'loadout.cantDraw': 'Las builds se simulan igual — solo no se pueden dibujar.',
    'loadout.hero': 'heroica',
    'enchSlot.weapon': 'Arma (a dos manos simula cada combinación de mano principal × secundaria)',
    'enchSlot.chest': 'Pecho', 'enchSlot.head': 'Cabeza', 'enchSlot.feet': 'Pies', 'enchSlot.legs': 'Piernas',
    'enchSlot.ring': 'Anillos (cada combinación de par)',
    'compare.consumables': 'Consumibles', 'compare.enchants': 'Encantamientos', 'compare.gems': 'Gemas',
    'compare.omniumFolio': 'Folio Omnium', 'compare.talentBuilds': 'Builds de talentos',
    'compare.weaponOil': 'Aceite de arma', 'compare.flask': 'Frasco', 'compare.food': 'Comida', 'compare.potion': 'Poción',
    'compare.noDpsEnchant': 'ningún encantamiento de {cat} afecta al DPS esta temporada — este slot solo da estadísticas terciarias',
    'compare.statGems': 'Gemas de estadística (todo el setup intercambiado por gema)',
    'compare.eversongDiamonds': 'Diamantes de Canción Eterna (intercambiados en tu engarce de diamante)',
    'compare.folioHint': 'Cada runa que puede mover el DPS, una fila a la vez{skipped}. Necesita la línea omnium_talents de un export /simc actual.',
    'compare.folioSkipped': ' ({n} fila{s} defensiva{s} omitida{s} — curación, absorciones y velocidad de movimiento)',
    'compare.talentsPlaceholder': 'Pega tu export /simc — tus builds del juego aparecerán aquí.',
    'h2.lootSources': 'Fuentes de botín', 'dropt.includeAll': 'Incluir todo',
    'dropt.refresh': 'Actualizar datos', 'dropt.refreshTitle': 'Vuelve a descargar los datos del juego desde wago.tools (se actualiza con los parches)',
    'dropt.upgradeItems': 'Mejorar objetos a',
    'dropt.upgradeItemsTitle': 'Simula cada objeto mejorado dentro de su propio camino (p. ej. un drop de banda Mítica a Mítico 4/6). Los objetos de jefe mundial / exteriores no se ven afectados.',
    'dropt.asDropped': 'Tal como cae (sin mejoras)',
    'dropt.voidcoreTitle': 'Núcleos del Vacío Ascendentes: solo armas y abalorios de camino Héroe y Mítico totalmente mejorados (6/6) — Héroe → 285, Mítico → 298',
    'dropt.applyVoidcores': 'Aplicar Núcleos del Vacío (cuando sea posible)',
    'dropt.tierTitle': 'Un objeto puesto en una ranura de conjunto rompería tu bonificación de conjunto y se leería como una gran pérdida. Con esto activado, esas filas mantienen la bonificación — el Catalizador convierte un drop en tu pieza de conjunto manteniendo sus propias estadísticas, engarces y efectos — así que la fila muestra la diferencia de estadísticas por sí sola.',
    'dropt.keepTier': 'Mantener mi bonificación de conjunto (como si catalizado)',
    'dropt.offspecTitle': 'Simula también objetos cuya estadística principal no es la tuya (p. ej. piezas de Intelecto en una especialización de Agilidad) — el tipo de armadura y la competencia con el arma se siguen respetando',
    'dropt.offspec': 'Incluir objetos fuera de especialización',
    'dropt.scanHint': 'Los escaneos completos simulan cientos de objetos — se recomienda la precisión Rápida; espera varios minutos.',
    'sim.button': 'Simular', 'sim.cancel': 'Cancelar',
    'sim.compareGear': 'Comparar equipo', 'sim.runDroptimizer': 'Ejecutar droptimizer', 'sim.calcStatWeights': 'Calcular pesos',
    'lang.enTitle': 'Nombres de objetos, conjuntos y botín en inglés (siempre disponible)',
    'lang.esTitle': 'Nombres de objetos, conjuntos y botín en español -- la primera vez que elijas esto, pulsa "Actualizar datos" para descargarlo',
    'slot.head': 'cabeza', 'slot.neck': 'cuello', 'slot.shoulder': 'hombros', 'slot.back': 'espalda', 'slot.chest': 'pecho',
    'slot.wrist': 'muñeca', 'slot.hands': 'manos', 'slot.waist': 'cintura', 'slot.legs': 'piernas', 'slot.feet': 'pies',
    'slot.finger1': 'anillo 1', 'slot.finger2': 'anillo 2', 'slot.trinket1': 'abalorio 1', 'slot.trinket2': 'abalorio 2',
    'slot.mainHand': 'mano principal', 'slot.offHand': 'mano secundaria', 'slot.weapons': 'armas',
    'filter.all': 'Todos', 'filter.allSlots': 'Todas las ranuras', 'filter.consumables': 'Consumibles', 'filter.enchants': 'Encantamientos',
    'filter.gems': 'Gemas', 'filter.omniumFolio': 'Folio Omnium', 'filter.talentLoadouts': 'Configuraciones de talentos',
    'filter.loadout': 'Configuración', 'filter.rings': 'Anillos', 'filter.trinkets': 'Abalorios', 'filter.weapon': 'Arma',
    'filter.upgrades': 'Mejoras', 'filter.equipped': 'Equipado', 'filter.bags': 'Bolsas', 'filter.catalyzed': 'Catalizado',
    'filter.search': 'Búsqueda', 'filter.row': 'Fila', 'bucket.talentBuild': 'Configuración de talentos', 'bucket.enchant': 'Encantamiento',
    'h2.simHistory': 'Historial de sims',
    'history.hint': 'Cada sim terminada se guarda aquí automáticamente. Haz clic en una para ver sus resultados de nuevo a la derecha.',
    'results.backToSetup': '← Volver a la configuración',
    'progress.simulating': 'Simulando…',
    'results.baselineDps': 'DPS base (equipo equipado)', 'results.filterItems': 'Filtrar objetos…',
    'results.yourTopGear': 'Tu mejor equipo', 'results.bestSetup': 'Mejor combinación',
    'results.highlightedHint': 'Las ranuras resaltadas superan lo que llevas equipado — el encantamiento y las gemas mostrados para el resto se aplican a todos los candidatos de esa ranura en Detalles.',
    'th.item': 'Objeto', 'th.source': 'Origen', 'th.dps': 'DPS', 'th.change': 'Cambio', 'th.vsEquipped': 'vs equipado',
    'h2.statWeights': 'Peso de estadísticas', 'th.stat': 'Estadística', 'th.dpsPerPoint': 'DPS por punto', 'th.relativeToTop': 'Relativo a la mejor',
    'h2.damageBreakdown': 'Desglose de daño', 'th.ability': 'Habilidad', 'th.casts': 'Usos', 'th.share': 'Porcentaje',
    'h2.buffUptimes': 'Tiempo activo de mejoras', 'th.buff': 'Mejora', 'th.uptime': 'Tiempo activo',
    'empty.hit': 'Pega tu personaje, elige un combate, pulsa <strong data-i18n="sim.button">Simular</strong>.',
    'empty.resultsHint': 'Los resultados aparecerán aquí con DPS, desglose de daño y tiempo activo de mejoras.',
    'footer.runsLocally': 'Localbots corre enteramente en esta máquina', 'footer.github': 'Localbots en GitHub',
    'footer.saveReport': 'Guardar informe',
    'footer.saveReportTitle': 'Guarda este resultado como un archivo HTML que puedes enviar a alguien — se abre en cualquier navegador',
    'footer.shutdown': 'Apagar servidor',
    'status.appOk': 'Localbots actualizado', 'status.appOutdated': 'Actualización de Localbots disponible',
    'status.appUnknown': 'Localbots — no se puede comprobar',
    'status.simcOk': 'Simc actualizado', 'status.simcOutdatedClick': 'Simc desactualizado — clic para actualizar',
    'status.simcOutdated': 'Simc desactualizado', 'status.simcUnknown': 'Simc — no se puede comprobar',
    'status.simcUpdateFailed': 'Falló la actualización de Simc', 'status.simcUpdating': 'Actualizando Simc…',
    'status.simcStillOutdated': 'Simc sigue desactualizado',
  },
};

function tr(key) { return I18N[lang]?.[key] ?? I18N.en[key] ?? key; }

function applyI18n(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n;
    // an element with element children (e.g. the empty-state's <strong>) needs
    // its markup preserved, not just its text -- those store real HTML
    if (el.children.length) el.innerHTML = tr(key);
    else el.textContent = tr(key);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = tr(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = tr(el.dataset.i18nPlaceholder); });
}
applyI18n();

function renderLangSwitch() {
  const el = $('lang-switch');
  if (!el) return;
  el.innerHTML = LANGS.map((l) => `
    <button class="lang-btn ${l.id === lang ? 'active' : ''}" data-langid="${esc(l.id)}"
      title="${l.id === 'en'
        ? esc(tr('lang.enTitle'))
        : esc(tr('lang.esTitle'))}">${esc(l.label)}</button>`).join('');
  el.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.langid === lang) return;
      lang = btn.dataset.langid;
      localStorage.setItem('localbots-lang', lang);
      renderLangSwitch();
      applyI18n(); // whole interface, not just item/set/loot game-data text
      $('sim-button').textContent = simLabel(mode);
      // language-specific state is stale now, same as a patch switch
      enchantNameCache.clear();
      equippedItems = null;
      delete $('tu-list').dataset.rendered;
      droptTree = null;
      await reloadSeason();
      if (mode === 'topgear') {
        refreshGearList();
        if ($('track-upgrades-toggle').checked) loadEquippedItems();
      }
      if (mode === 'droptimizer') refreshDroptimizer();
    });
  });
}

async function reloadSeason() {
  try {
    season = await (await fetch(`/api/season?patch=${encodeURIComponent(patch)}&lang=${encodeURIComponent(lang)}`)).json();
    renderCompareGroups();
  } catch { /* unreachable server is reported by the status chips */ }
}

async function initPatches() {
  try {
    patchDefs = (await (await fetch('/api/patches')).json()).patches ?? [];
  } catch { patchDefs = []; }
  const cur = patchDefs.find((d) => d.id === patch);
  if (!cur || !cur.available) {
    patch = (patchDefs.find((d) => d.available) ?? patchDefs[0])?.id ?? 'live';
  }
  renderPatchSwitch();
  renderLangSwitch();
  await reloadSeason();
}
initPatches();

function renderPatchSwitch() {
  const el = $('patch-switch');
  if (!el) return;
  if (patchDefs.length < 2) { el.innerHTML = ''; return; }
  el.innerHTML = patchDefs.map((d) => `
    <button class="patch-btn ${d.id === patch ? 'active' : ''}" data-patchid="${esc(d.id)}"
      ${d.available ? '' : 'disabled'}
      title="${d.available
        ? (d.ptr ? 'Sim against the test-realm (PTR) data — numbers are provisional until release' : 'Sim against the live game')
        : esc(d.reason ?? 'unavailable')}">${esc(d.label)}</button>`).join('');
  el.querySelectorAll('.patch-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.disabled || btn.dataset.patchid === patch) return;
      patch = btn.dataset.patchid;
      localStorage.setItem('localbots-patch', patch);
      renderPatchSwitch();
      // patch-specific state is stale now
      equippedItems = null;
      delete $('tu-list').dataset.rendered;
      droptTree = null;
      await reloadSeason();
      if (mode === 'topgear') {
        refreshGearList();
        if ($('track-upgrades-toggle').checked) loadEquippedItems();
      }
      if (mode === 'droptimizer') refreshDroptimizer();
    });
  });
}

// ---------- "Also compare" pickers ----------
// Each group: header checkbox + expandable panel of options (all on by
// default, All/None buttons). Selections narrow what gets simmed.
const SLOT_TITLE_KEYS = {
  weapon: 'enchSlot.weapon', chest: 'enchSlot.chest', head: 'enchSlot.head',
  feet: 'enchSlot.feet', legs: 'enchSlot.legs', ring: 'enchSlot.ring',
};

function renderCompareGroups() {
  const groups = [];

  // Same look as an equipped item's enchant/gem subline in the live report
  // (see enchGemSubline): a small icon + name, wrapped in a real Wowhead
  // tooltip link when an item id is already known. Gems/diamonds/consumables
  // all carry a real item id up front (the server resolves consumables' via
  // /api/season -- see consumableItemIdsFor); enchants don't (an id-less row
  // renders icon-less plain text first, then warmCompareEnchantWowhead
  // patches in the icon + link once resolved -- the ".cg-opt-text" span is
  // what that looks for and replaces).
  const optionRow = (group, cat, key, label, itemId) => {
    const inner = itemId
      ? wowheadLinkedTile(itemId, label)
      : `<span class="cg-opt-text">${esc(label)}</span>`;
    return `<label class="cg-opt"><input type="checkbox" data-cgroup="${group}" data-cat="${cat}" data-key="${esc(String(key))}" checked> ${inner}</label>`;
  };

  // consumables
  const cons = [];
  for (const [cat, choices] of Object.entries(season.consumableOptions ?? {})) {
    if (cat.startsWith('_') || !Array.isArray(choices)) continue;
    const consLabelKey = { temporary_enchant: 'compare.weaponOil', flask: 'compare.flask', food: 'compare.food', potion: 'compare.potion' }[cat];
    cons.push(`<div class="cg-slot-head">${esc(consLabelKey ? tr(consLabelKey) : cat[0].toUpperCase() + cat.slice(1))}</div>`);
    cons.push(...choices.map((c) => optionRow('consumables', cat, c.value, c.label, c.id)));
  }
  groups.push(['consumables', tr('compare.consumables'), cons.join('')]);

  // enchants — options measured as having no DPS effect are left out
  const ench = [];
  for (const [cat, choices] of Object.entries(season.enchantOptions ?? {})) {
    if (cat.startsWith('_') || !Array.isArray(choices)) continue;
    const usable = choices.filter((c) => c.dps !== false);
    ench.push(`<div class="cg-slot-head">${esc(SLOT_TITLE_KEYS[cat] ? tr(SLOT_TITLE_KEYS[cat]) : cat)}</div>`);
    const catLabelRaw = SLOT_TITLE_KEYS[cat] ? tr(SLOT_TITLE_KEYS[cat]).replace(/\s*\(.*\)$/, '') : cat;
    const catLabel = catLabelRaw.charAt(0).toLowerCase() + catLabelRaw.slice(1);
    ench.push(usable.length
      ? usable.map((c) => optionRow('enchants', cat, c.id, c.label)).join('')
      : `<div class="cg-opt hint-inline">${esc(tr('compare.noDpsEnchant').replace('{cat}', catLabel))}</div>`);
  }
  groups.push(['enchants', tr('compare.enchants'), ench.join('')]);

  // gems + diamonds
  const gems = [`<div class="cg-slot-head">${esc(tr('compare.statGems'))}</div>`];
  gems.push(...(season.gemOptions ?? []).map((g) => optionRow('gems', 'gems', g.id, g.label, g.id)));
  gems.push(`<div class="cg-slot-head">${esc(tr('compare.eversongDiamonds'))}</div>`);
  gems.push(...(season.diamondOptions?.options ?? []).map((d) => optionRow('gems', 'diamonds', d.id, d.label, d.id)));
  groups.push(['gems', tr('compare.gems'), gems.join('')]);

  // folio (no picker — the runes are always cheap to sim)
  const folioRows = (season.omniumFolio?.rows ?? []).filter((r) => r.choices.some((c) => c.dps !== false));
  const folioSkipped = (season.omniumFolio?.rows ?? []).length - folioRows.length;
  const skippedText = folioSkipped
    ? tr('compare.folioSkipped').replace(/\{n\}/g, folioSkipped).replace(/\{s\}/g, folioSkipped === 1 ? '' : 's')
    : '';
  groups.push(['folio', tr('compare.omniumFolio'),
    `<p class="hint">${esc(tr('compare.folioHint').replace('{skipped}', skippedText))}</p>`]);

  // talent builds (cards come from the pasted export, filled by refreshGearList)
  groups.push(['talents', tr('compare.talentBuilds'),
    `<div id="talent-loadout-options"><p class="hint">${esc(tr('compare.talentsPlaceholder'))}</p></div>`]);

  $('compare-groups').innerHTML = groups.map(([id, title, body]) => `
    <div class="compare-group" data-group="${id}">
      <label class="cg-head"><input type="checkbox" id="compare-${id}"> ${title}
        <span class="hint-inline cg-count" data-count="${id}"></span></label>
      <div class="cg-panel hidden">
        <div class="gear-toolbar">
          <button class="mini cg-all" data-target="${id}">${esc(tr('gear.all'))}</button>
          <button class="mini cg-none" data-target="${id}">${esc(tr('gear.none'))}</button>
        </div>
        <div class="cg-options">${body}</div>
      </div>
    </div>`).join('');

  document.querySelectorAll('.compare-group').forEach((el) => {
    const head = el.querySelector('.cg-head input');
    head.addEventListener('change', () => {
      el.querySelector('.cg-panel').classList.toggle('hidden', !head.checked);
      updateCompareCounts();
    });
  });
  document.querySelectorAll('.cg-all, .cg-none').forEach((btn) => {
    btn.addEventListener('click', () => {
      const on = btn.classList.contains('cg-all');
      document.querySelectorAll(`input[data-cgroup="${btn.dataset.target}"]`)
        .forEach((cb) => { cb.checked = on; });
      updateCompareCounts();
    });
  });
  document.querySelectorAll('input[data-cgroup]').forEach((cb) => {
    cb.addEventListener('change', updateCompareCounts);
  });
  updateCompareCounts();
  // gems/diamonds/consumables already carry a real item id (see optionRow
  // above), so their icons/tooltip links are ready as soon as the icon batch
  // + widget script themselves are; enchants need their real id resolved
  // first (no item id of their own -- see warmCompareEnchantWowhead)
  paintItemIcons($('compare-groups'));
  loadWowheadWidget().then(refreshWowheadLinks);
  warmCompareEnchantWowhead();
}

// Enchant options have no item id of their own to link Wowhead's widget off
// straight away (unlike gems/diamonds -- see optionRow), so every enchant
// row renders with a plain <span> first and this resolves the real scroll-
// item id (or failing that, the granted spell) the same way an equipped
// item's enchant subline does, then swaps each span for a linked <a> --
// preserving the existing checkbox elements (and whatever the user has
// already ticked/unticked) rather than re-rendering the whole panel.
async function warmCompareEnchantWowhead() {
  const ids = [];
  for (const choices of Object.values(season.enchantOptions ?? {})) {
    if (!Array.isArray(choices)) continue;
    for (const c of choices) if (c.dps !== false) ids.push(c.id);
  }
  if (!ids.length) return;
  let anyLink = false;
  try {
    const r = await fetch(`/api/enchant-names?ids=${ids.join(',')}&patch=${encodeURIComponent(patch)}&lang=${encodeURIComponent(lang)}`);
    const j = await r.json();
    for (const id of ids) {
      if (j.itemIds?.[id]) { enchantItemIdCache.set(id, j.itemIds[id]); anyLink = true; }
      if (j.spellIds?.[id]) { enchantSpellIdCache.set(id, j.spellIds[id]); anyLink = true; }
    }
  } catch {
    return;
  }
  if (!anyLink) return;
  await loadWowheadWidget();
  document.querySelectorAll('#compare-groups input[data-cgroup="enchants"]').forEach((cb) => {
    const id = Number(cb.dataset.key);
    const itemId = enchantItemIdCache.get(id);
    const spellId = enchantSpellIdCache.get(id);
    const entity = itemId ? `item=${itemId}` : spellId ? `spell=${spellId}` : null;
    const span = cb.parentElement.querySelector('.cg-opt-text');
    if (!entity || !span) return;
    const name = span.textContent.trim();
    // no per-enchant icon exists in the game data (see ENCHANT_ICON_URL) --
    // same generic scroll icon the report's own enchant subline uses
    const whHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
    const whId = lang === 'es' ? `es:${entity}` : entity;
    const a = document.createElement('a');
    a.className = 'cg-opt-link enchgem-item';
    a.href = `https://${whHost}/${entity}`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('data-wowhead', whId);
    a.innerHTML = `<img class="mini-icon" alt="" src="${ENCHANT_ICON_URL}"> ${esc(name)}`;
    span.replaceWith(a);
  });
  refreshWowheadLinks();
}

function selectedOptions(group) {
  const out = {};
  document.querySelectorAll(`input[data-cgroup="${group}"]`).forEach((cb) => {
    out[cb.dataset.cat] ??= []; // an all-unchecked category means "none", not "all"
    if (cb.checked) {
      const key = cb.dataset.key;
      // loadout keys are names, not ids — never numeric-coerce them
      // (a loadout literally named "2" must stay the string "2")
      out[cb.dataset.cat].push(cb.dataset.cat === 'loadouts' || isNaN(Number(key)) ? key : Number(key));
    }
  });
  return out;
}

// Talent builds as cards: each shows its class + spec tree at a glance
// (the picked nodes lit up), its hero tree, and a checkbox to sim it.
// The active build is the baseline, so it has no checkbox.
let customLoadouts = JSON.parse(localStorage.getItem('localbots-talents') ?? '[]');

function saveCustomLoadouts() {
  localStorage.setItem('localbots-talents', JSON.stringify(customLoadouts));
}

// one dot per talent node, laid out on the tree's own grid
function talentTreeSvg(nodes, lit) {
  if (!nodes.length) return '';
  const maxCol = Math.max(...nodes.map((n) => n.col));
  const maxRow = Math.max(...nodes.map((n) => n.row));
  const step = 7, pad = 4, r = 2.1;
  const w = (maxCol - 1) * step + pad * 2;
  const h = (maxRow - 1) * step + pad * 2;
  const dots = nodes.map((n) => {
    const on = lit.has(n.node);
    return `<circle cx="${((n.col - 1) * step + pad).toFixed(1)}" cy="${((n.row - 1) * step + pad).toFixed(1)}" r="${on ? r + 0.5 : r}"
      class="${on ? 'tn-on' : 'tn-off'}"><title>${esc(n.name ?? '')}</title></circle>`;
  }).join('');
  const scale = 1.12; // two trees + padding must fit the narrow input column
  return `<svg class="talent-mini" viewBox="0 0 ${w} ${h}" width="${(w * scale).toFixed(0)}" height="${(h * scale).toFixed(0)}">${dots}</svg>`;
}

function renderLoadoutOptions(talents) {
  const el = $('talent-loadout-options');
  if (!el) return;
  const prev = new Map([...el.querySelectorAll('input[data-cgroup]')].map((cb) => [cb.dataset.key, cb.checked]));

  if (!talents?.available) {
    // no trait tables (binary-only simc) — fall back to a plain list
    const list = (talents?.loadouts ?? []).filter((l) => !l.isActive);
    el.innerHTML = (talents?.reason ? `<p class="hint">${esc(talents.reason)} ${tr('loadout.cantDraw')}</p>` : '')
      + (list.length
        ? list.map((l) => `<label class="cg-opt"><input type="checkbox" data-cgroup="talents" data-cat="loadouts" data-key="${esc(l.name)}" ${(prev.get(l.name) ?? true) ? 'checked' : ''}> ${esc(prettyLoadout(l.name))}</label>`).join('')
        : `<p class="hint">${tr('loadout.noSaved')}</p>`);
    bindLoadoutInputs(el);
    return;
  }

  const layout = talents.layout ?? [];
  const classNodes = layout.filter((n) => n.tree === 1);
  const specNodes = layout.filter((n) => n.tree === 2);

  const card = (l) => {
    const lit = new Set(l.selectedNodes ?? []);
    const head = l.isActive
      ? `<span class="tl-active">${tr('loadout.active')}</span>`
      : `<label class="tl-pick"><input type="checkbox" data-cgroup="talents" data-cat="loadouts" data-key="${esc(l.name)}" ${(prev.get(l.name) ?? true) ? 'checked' : ''}> ${tr('loadout.simThis')}</label>`;
    if (!l.valid) {
      return `<div class="talent-card invalid">
        <div class="tl-name">${esc(prettyLoadout(l.name))}</div>
        <p class="hint">${tr('loadout.couldNotRead')} ${esc(l.error ?? tr('loadout.unknown'))}</p>
        ${l.custom ? `<button class="mini tl-del" data-del="${esc(l.name)}">${tr('loadout.remove')}</button>` : ''}</div>`;
    }
    return `<div class="talent-card">
      <div class="tl-name">${esc(prettyLoadout(l.name))}${l.custom ? ` <span class="hint-inline">${tr('loadout.added')}</span>` : ''}</div>
      <div class="tl-trees">${talentTreeSvg(classNodes, lit)}${talentTreeSvg(specNodes, lit)}</div>
      <div class="tl-meta">${l.heroName ? `<strong>${esc(l.heroName)}</strong> · ` : ''}${l.counts.class}/${l.counts.spec} + ${l.counts.hero} ${tr('loadout.hero')}</div>
      <div class="tl-foot">${head}${l.custom ? `<button class="mini tl-del" data-del="${esc(l.name)}">${tr('loadout.remove')}</button>` : ''}</div>
    </div>`;
  };

  el.innerHTML = `<div class="talent-cards">
      ${talents.loadouts.map(card).join('')}
      <div class="talent-card add-card">
        <div class="tl-name">${tr('loadout.addBuild')}</div>
        <p class="hint">${tr('loadout.pasteHint')}</p>
        <input type="text" id="tl-new-name" placeholder="${esc(tr('loadout.namePlaceholder'))}">
        <textarea id="tl-new-str" rows="2" placeholder="${esc(tr('loadout.stringPlaceholder'))}"></textarea>
        <button class="mini" id="tl-add">${tr('loadout.addBuildBtn')}</button>
        <p class="hint hidden" id="tl-add-error"></p>
      </div>
    </div>`;
  bindLoadoutInputs(el);

  $('tl-add')?.addEventListener('click', () => {
    const str = $('tl-new-str').value.trim();
    const err = $('tl-add-error');
    if (!/^[A-Za-z0-9+/]+$/.test(str)) {
      err.textContent = tr('loadout.invalidString');
      err.classList.remove('hidden');
      return;
    }
    let name = $('tl-new-name').value.trim() || `Added build ${customLoadouts.length + 1}`;
    const taken = new Set(talents.loadouts.map((l) => l.name));
    while (taken.has(name)) name += ' (2)';
    customLoadouts.push({ name, talents: str });
    saveCustomLoadouts();
    refreshGearList();
  });
  el.querySelectorAll('.tl-del').forEach((btn) => {
    btn.addEventListener('click', () => {
      customLoadouts = customLoadouts.filter((c) => c.name !== btn.dataset.del);
      saveCustomLoadouts();
      refreshGearList();
    });
  });
}

function bindLoadoutInputs(el) {
  el.querySelectorAll('input[data-cgroup]').forEach((cb) => cb.addEventListener('change', updateCompareCounts));
  updateCompareCounts();
}

function prettyLoadout(name) {
  return String(name).replace(/^Class Codex:\s*/, '');
}

// rough variant-count preview so long runs don't surprise anyone
function updateCompareCounts() {
  const folioCount = (season?.omniumFolio?.rows ?? [])
    .filter((r) => r.choices.some((c) => c.dps !== false))
    .reduce((n, r) => n + r.choices.filter((c) => c.dps !== false).length, 0);
  const counts = { consumables: 0, enchants: 0, gems: 0, folio: folioCount, talents: 0 };
  counts.talents = (selectedOptions('talents').loadouts ?? []).length;
  const consSel = selectedOptions('consumables');
  counts.consumables = Object.values(consSel).reduce((n, a) => n + a.length, 0);
  const enchSel = selectedOptions('enchants');
  for (const [cat, arr] of Object.entries(enchSel)) {
    if (cat === 'weapon') counts.enchants += arr.length * arr.length; // MH x OH worst case
    else if (cat === 'ring') counts.enchants += (arr.length * (arr.length + 1)) / 2;
    else counts.enchants += arr.length;
  }
  const gemSel = selectedOptions('gems');
  counts.gems = (gemSel.gems?.length ?? 0) + (gemSel.diamonds?.length ?? 0);
  for (const [id, n] of Object.entries(counts)) {
    const el = document.querySelector(`.cg-count[data-count="${id}"]`);
    if (el) el.textContent = $(`compare-${id}`)?.checked ? `≈ ${n} sims` : '';
  }
}

const TRACK_TAG = { Adventurer: 'A', Veteran: 'V', Champion: 'C', Hero: 'H', Myth: 'M' };

// The item's track as the short tag shown next to its name (e.g. "(H)").
// Decoded server-side from the item's own bonus id — never inferred from item
// level, which is ambiguous (321 is both Hero 6/6 and Myth 2/6).
function trackTagFor(item) {
  return item.track ? TRACK_TAG[item.track] ?? null : null;
}

const TRACK_SCHEME = [['Veteran', 'v'], ['Champion', 'c'], ['Hero', 'h'], ['Myth', 'm']];

// The V/C/H/M scheme shown after an item's name, with its own track lit up and
// the rest dimmed. Takes the decoded track; a row without one (crafted gear,
// last season's) shows nothing rather than a guess.
// A result row only carries the track name and the ilvl it landed on, not
// the step index gear-list items get from the server -- but the season's
// per-track ilvl list IS the step index, so a lookup is all that's needed.
function trackStepFor(track, ilvl) {
  const steps = season?.tracks?.[track];
  const idx = steps ? steps.indexOf(Number(ilvl)) : -1;
  return idx >= 0 ? { track, trackStep: idx + 1, trackMax: steps.length } : null;
}

function trackSchemeFor(track) {
  if (!track || !TRACK_SCHEME.some(([name]) => name === track)) return '';
  const letters = TRACK_SCHEME.map(([name, cls]) =>
    `<span class="track-tag tier-${cls}${name === track ? '' : ' dim'}">${cls.toUpperCase()}</span>`).join('');
  return `<span class="track-scheme" title="Upgrade track: ${track}">${letters}</span>`;
}

// Upgrade levels this specific item can actually reach.
// Crafted items (marked by crafted_stats= in the export): max craft, then
// Voidcore for weapons/trinkets. Dropped items: steps within the item's own
// track only (never a higher track's levels), then the Myth Voidcore level
// for weapons/trinkets.
function upgradeOptionsFor(item) {
  if (!season || !item.ilvl) return [];
  const isVoidcoreSlot = season.voidcore?.slots?.includes(item.slot);
  const opts = [];

  if (item.crafted) {
    const maxCraft = season.crafted?.maxIlvl;
    if (maxCraft && maxCraft > item.ilvl) opts.push({ ilvl: maxCraft, label: `${maxCraft} — max craft` });
    const vc = season.voidcore?.craftedIlvl;
    if (isVoidcoreSlot && vc && vc > item.ilvl) opts.push({ ilvl: vc, label: `${vc} — Voidcore (crafted)` });
    return opts;
  }

  // the item's own track cap (6/6) is always called out, whether or not the
  // crests parsed from upgrade_currencies= can afford it yet
  const ownTrack = trackInfo(item);
  const trackCap = ownTrack ? season.tracks[ownTrack.track].at(-1) : null;
  const maxAffordable = maxAffordableIlvlFor(item);
  const steps = ownTrack ? season.tracks[ownTrack.track].filter((ilvl) => ilvl > item.ilvl) : [];
  opts.push(...steps.sort((a, b) => a - b).map((ilvl) => {
    const tags = [];
    if (ilvl === maxAffordable) tags.push('max affordable');
    if (ilvl === trackCap) tags.push(`${ownTrack.track} 6/6`);
    return { ilvl, label: tags.length ? `${ilvl} — ${tags.join(', ')}` : String(ilvl) };
  }));
  const vc = season.voidcore?.mythIlvl;
  if (isVoidcoreSlot && vc && vc > item.ilvl) {
    opts.push({ ilvl: vc, label: `${vc} — Voidcore (Myth 6/6)` });
  }
  return opts;
}

// The highest ilvl this item's own track can reach given the crests parsed
// from the pasted export's upgrade_currencies= line, at upgradeCrestCost per
// step. Returns null when no track/crests are known or nothing is affordable.
function maxAffordableIlvlFor(item) {
  // Server-priced ladder when we have it. decodeTrack already gives the fallback
  // below the item's real track, so what this adds is the COST side: ranks that
  // are FREE under this character's slot watermark, and tiers halved by an
  // account-wide achievement. Without it every rank is priced at the full 20.
  const priced = crestPrices?.bySlot?.[item.slot];
  if (priced && priced.ilvl === item.ilvl) {
    const wallet = crestPrices.tiers?.[priced.track];
    let spent = 0, target = null;
    for (const r of [...priced.free, ...priced.paid]) {
      const cost = r.cost ?? 0;
      if (spent + cost > (wallet?.balance ?? 0)) break;
      spent += cost; target = r.ilvl;
    }
    return target && target > item.ilvl ? target : null;
  }
  if (!season?.tracks || !season.upgradeCrests || item.crafted || !item.ilvl) return null;
  const info = trackInfo(item);
  if (!info) return null;
  const crestId = season.upgradeCrests[info.track];
  if (!crestId) return null;
  const cost = season.upgradeCrestCost || 20;
  const wallet = crestWalletFromProfile($('profile').value);
  const afford = Math.floor((wallet.get(crestId) ?? 0) / cost);
  if (afford <= 0) return null;
  const track = season.tracks[info.track];
  const target = track[Math.min(track.length - 1, info.stepIdx + afford)];
  return target > item.ilvl ? target : null;
}

// Priced upgrade ladder for the pasted character, from /api/crests. Null until
// fetched, which is why maxAffordableIlvlFor keeps a standalone fallback.
let crestPrices = null;

async function refreshCrestPrices() {
  const profile = $('profile').value.trim();
  if (!profile) { crestPrices = null; return; }
  try {
    const d = await api('/api/crests', { profile });
    crestPrices = { ...d, bySlot: Object.fromEntries(d.items.map((i) => [i.slot, i])) };
  } catch { crestPrices = null; }
  renderCrestSummary();
}

function crestCostBadge(cost) {
  if (cost === 0) return '<span class="cost-badge free">free</span>';
  if (cost < (season?.upgradeCrestCost ?? 20)) return `<span class="cost-badge half">${cost}</span>`;
  return `<span class="cost-badge">${cost}</span>`;
}

// Balances, what is free right now, and which discounts are active -- the two
// discounts are the least obvious part of the system and the easiest to waste.
function renderCrestSummary() {
  const el = $('crest-summary');
  if (!el) return;
  if (!crestPrices?.hasWatermarks) { el.classList.add('hidden'); return; }
  const tiers = Object.entries(crestPrices.tiers).filter(([, t]) => t.balance);
  const free = crestPrices.items.filter((i) => i.free.length);
  const ach = crestPrices.achievements ?? [];
  const earned = ach.filter((a) => a.earned);
  const next = ach.filter((a) => !a.earned && a.short.length)
                  .sort((a, b) => a.short.length - b.short.length)[0];
  el.classList.remove('hidden');
  el.innerHTML = `
    <div class="crest-tiers">${tiers.map(([track, t]) => `
      <div class="crest-tier${t.ranks ? '' : ' spent'}">
        <span class="ct-name">${esc(track)}</span>
        <span class="ct-bal">${t.balance}</span>
        <span class="ct-sub">${t.perRank}/rank${t.discounted ? ' <span class="ct-off">half</span>' : ''}</span>
        <span class="ct-sub">${t.ranks} rank${t.ranks === 1 ? '' : 's'}</span>
      </div>`).join('')}</div>
    ${free.length ? `<p class="crest-free"><strong>Free right now.</strong> These sit below a level you
      have already reached in that slot, so they cost no crests:
      ${free.map((i) => `${esc(i.slot)} ${i.ilvl}&rarr;${i.free[i.free.length - 1].ilvl}`).join(' &middot; ')}</p>` : ''}
    ${earned.length ? `<p class="crest-ach"><strong>Half price:</strong>
      ${earned.map((a) => esc(a.track)).join(', ')} &mdash; you hold the "Outgrow" achievement, so those
      ranks cost ${crestPrices.tiers[earned[0].track].perRank} instead of ${season?.upgradeCrestCost ?? 20},
      on every character.</p>` : ''}
    ${next ? `<p class="crest-ach"><strong>Next discount:</strong> ${esc(next.track)} halves once every slot
      reaches <strong>${next.cap}</strong> account-wide &mdash; ${next.short.length} still short
      (${next.short.slice(0, 5).map((sh) => `${esc(sh.slot)} ${sh.account}`).join(', ')}${next.short.length > 5 ? ', …' : ''}).
      It is permanent and applies to every character.</p>` : ''}`;
}

// ---------- boot ----------
// Header status bar: is this Localbots checkout behind GitHub, and is the
// local simc build behind the live game version?
fetch('/api/status')
  .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
  .then(renderStatus)
  .catch(() => {
    setChip('status-app', 'unknown', tr('status.appUnknown'),
      'Could not run the update check. If you just updated Localbots, restart the server.');
    setChip('status-simc', 'unknown', tr('status.simcUnknown'),
      'Could not run the update check. If you just updated Localbots, restart the server.');
  });

function setChip(id, state, text, tooltip) {
  const chip = $(id);
  chip.querySelector('.dot').className = `dot dot-${state}`;
  chip.querySelector('.chip-text').textContent = text;
  chip.title = tooltip;
}

function renderStatus(s) {
  // a shared server hides the shutdown button (see LOCALBOTS_ALLOW_SHUTDOWN)
  if (s.allowShutdown === false) $('shutdown-button').classList.add('hidden');
  const app = s.app ?? {};
  if (app.state === 'ok') {
    setChip('status-app', 'ok', tr('status.appOk'),
      `You are on the latest version (${app.local}).`);
  } else if (app.state === 'outdated') {
    setChip('status-app', 'outdated', tr('status.appOutdated'),
      'A newer version is on GitHub. To update: open a terminal in the localbots folder, ' +
      'run "git pull", then restart the server.');
  } else {
    setChip('status-app', 'unknown', tr('status.appUnknown'),
      `Could not reach GitHub to compare versions (${app.reason ?? 'no network?'}).`);
  }
  const simc = s.simc ?? {};
  simcChipClickable = false;
  if (simc.state === 'ok') {
    setChip('status-simc', 'ok', tr('status.simcOk'),
      `${s.simcVersion ?? 'simc'} — matches the live game (${simc.liveGame}).`);
  } else if (simc.state === 'outdated') {
    if (simc.updatable) {
      simcChipClickable = true;
      setChip('status-simc', 'outdated', tr('status.simcOutdatedClick'),
        `The game updated to ${simc.liveGame}, but your simc is built for ${simc.simcGame}. ` +
        'Click to pull the latest simc and rebuild it right here (a minute or two; sims wait meanwhile).');
    } else {
      setChip('status-simc', 'outdated', tr('status.simcOutdated'),
        `The game updated to ${simc.liveGame}, but your simc is built for ${simc.simcGame}. ` +
        'Rebuild/redownload simc (see the README) to sim the latest patch.');
    }
  } else {
    setChip('status-simc', 'unknown', tr('status.simcUnknown'),
      `${s.simcVersion ?? 'simc'} — could not fetch the live game version (${simc.reason ?? 'no network?'}).`);
  }
  $('status-simc').classList.toggle('clickable', simcChipClickable);
}

// ---------- one-click simc update ----------
let simcChipClickable = false;
let simcUpdating = false;

$('status-simc').addEventListener('click', async () => {
  if (!simcChipClickable || simcUpdating) return;
  if (!confirm('Update SimulationCraft now? It takes a minute or two, and sims wait until it finishes.')) return;
  simcUpdating = true;
  simcChipClickable = false;
  $('status-simc').classList.remove('clickable');
  try {
    const resp = await fetch('/api/simc/update', { method: 'POST' });
    const body = await resp.json();
    if (!resp.ok) {
      setChip('status-simc', 'outdated', tr('status.simcUpdateFailed'), body.error ?? 'unknown error');
      simcUpdating = false;
      return;
    }
  } catch {
    setChip('status-simc', 'outdated', tr('status.simcUpdateFailed'), 'Could not reach the server.');
    simcUpdating = false;
    return;
  }
  setChip('status-simc', 'unknown', tr('status.simcUpdating'), 'Pulling the latest simc source.');
  pollSimcUpdate();
});

async function pollSimcUpdate() {
  let st;
  try {
    st = await (await fetch('/api/simc/update/status')).json();
  } catch {
    setTimeout(pollSimcUpdate, 3000);
    return;
  }
  if (st.running) {
    const pct = st.progress ? ` ${Math.round((st.progress.done / st.progress.total) * 100)}%` : '';
    setChip('status-simc', 'unknown', `${tr('status.simcUpdating')}${pct}`, st.step ?? 'working');
    setTimeout(pollSimcUpdate, 2000);
    return;
  }
  simcUpdating = false;
  if (st.error) {
    setChip('status-simc', 'outdated', tr('status.simcUpdateFailed'),
      `${st.error} — you can update manually instead (see the README).`);
    return;
  }
  // done — re-check the light and the patch list against the fresh build
  // (a simc update can gain or lose PTR data, changing patch availability)
  initPatches();
  try {
    const s = await (await fetch('/api/status')).json();
    renderStatus(s);
    if (s.simc?.state === 'outdated') {
      setChip('status-simc', 'outdated', tr('status.simcStillOutdated'),
        `You now have the latest simc, but simc itself has not shipped data for game build ${s.simc.liveGame} yet — ` +
        'it usually catches up within a day or two. Click to try again later.');
    }
  } catch { /* next page load re-checks */ }
}

// ---------- views (setup / history / results) ----------
// Raidbots-style flow: the sim options live on one full-width scrolling page
// (setup), and hitting Sim it navigates away to a dedicated results page --
// not a side-by-side panel. "History" is its own page the same way; clicking
// a saved entry opens it in the results view, same as a fresh run's report.
let view = 'setup';
function showView(next) {
  view = next;
  document.querySelector('.input-panel').classList.toggle('hidden', view !== 'setup');
  $('quick-nav').classList.toggle('hidden', view !== 'setup');
  // the running-sim chips/status/cancel button stay visible from any page
  // (History included) -- only the "Sim it" button itself is setup-only.
  $('sim-button').classList.toggle('hidden', view !== 'setup');
  $('history-panel').classList.toggle('hidden', view !== 'history');
  $('results-panel').classList.toggle('hidden', view !== 'results');
  const activePage = view === 'history' ? 'history' : 'sim'; // setup & results both map to the "New sim" tab
  document.querySelectorAll('.page-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.page === activePage));
  if (view === 'results') {
    // same identity block as the setup screen's Armory import, so the
    // character stays visually anchored across the setup -> results jump
    $('results-char-card').innerHTML = $('char-card').classList.contains('hidden') ? '' : $('char-card').innerHTML;
  }
  window.scrollTo({ top: 0 });
}

document.querySelectorAll('.page-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page; // "sim" | "history"
    showView(page === 'sim' ? 'setup' : page);
    if (page === 'history') loadHistory();
  });
});

$('back-to-setup').addEventListener('click', () => showView('setup'));

async function loadHistory() {
  $('history-list').innerHTML = '<p class="empty">Loading…</p>';
  let body;
  try {
    const resp = await fetch('/api/history');
    if (!resp.ok) throw new Error();
    body = await resp.json();
  } catch {
    $('history-list').innerHTML =
      '<p class="empty">Could not load the history — if you just updated Localbots, restart the server.</p>';
    return;
  }
  const entries = body.entries ?? [];
  if (!entries.length) {
    $('history-list').innerHTML =
      '<p class="empty">No saved sims yet — every sim that finishes lands here automatically.</p>';
    return;
  }
  $('history-list').innerHTML = entries.map(historyRow).join('');
}

function historyRow(e) {
  const when = new Date(e.savedAt).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const headline = e.dps != null
    ? `${Math.round(e.dps).toLocaleString()} <span class="he-unit">${e.mode === 'quick' ? 'DPS' : 'baseline DPS'}</span>`
    : '?';
  const settings = [
    e.player ? `${e.player.name} · ${prettySpec(e.player.spec)}` : null,
    e.fightStyle,
    e.targets ? `${e.targets} target${e.targets > 1 ? 's' : ''}` : null,
    e.fightLength ? `${Math.round(e.fightLength)}s` : null,
    e.compared ? `${e.compared} item${e.compared === 1 ? '' : 's'} compared` : null,
  ].filter(Boolean).join(' · ');
  const best = e.best && e.compared
    ? `<div class="he-best ${e.best.delta > 0 ? 'delta-pos' : 'delta-zero'}">best: ${e.best.delta > 0 ? '+' : ''}${Math.round(e.best.delta).toLocaleString()} DPS — ${esc(e.best.name ?? '?')}</div>`
    : '';
  return `<div class="history-entry" data-hist="${esc(e.id)}">
    <div class="he-top">
      <span class="he-dps">${headline}</span>
      <span class="source-tag">${esc(e.modeLabel ?? e.mode)}</span>
      ${e.patchLabel ? `<span class="source-tag ptr-tag">${esc(e.patchLabel)}</span>` : ''}
      <span class="he-when">${esc(when)}</span>
      <button class="mini he-delete" data-histdel="${esc(e.id)}" title="Delete this saved sim">✕</button>
    </div>
    <div class="he-sub hint">${esc(settings)}</div>
    ${best}
  </div>`;
}

function prettySpec(spec) {
  return String(spec ?? '').replace(/_/g, ' ');
}

$('history-list').addEventListener('click', async (ev) => {
  const del = ev.target.closest('[data-histdel]');
  if (del) {
    ev.stopPropagation();
    await fetch(`/api/history/${del.dataset.histdel}`, { method: 'DELETE' }).catch(() => {});
    loadHistory();
    return;
  }
  const row = ev.target.closest('[data-hist]');
  if (row) viewHistoryEntry(row.dataset.hist);
});

async function viewHistoryEntry(id) {
  let entry;
  try {
    const resp = await fetch(`/api/history/${id}`);
    if (!resp.ok) throw new Error();
    entry = await resp.json();
  } catch {
    return;
  }
  document.querySelectorAll('.history-entry').forEach((el) =>
    el.classList.toggle('active', el.dataset.hist === id));
  showView('results');
  $('empty-state').classList.add('hidden');
  $('progress-area').classList.add('hidden');
  $('results-area').classList.add('hidden');
  $('topgear-area').classList.add('hidden');
  craftedSparksBudget = entry.options?.craftedSparksBudget ?? null;
  craftedOwnedIds = new Set(entry.options?.craftedOwnedIds ?? []);
  if (entry.result.topgear) renderTopGear(entry.result);
  else renderResult(entry.result);
  const banner = $('history-banner');
  banner.textContent = `Saved ${entry.modeLabel ?? 'sim'} from ${new Date(entry.savedAt).toLocaleString()}`;
  banner.classList.remove('hidden');
  setReportId(entry.id);
}

// restore last session
const saved = JSON.parse(localStorage.getItem('localbots') ?? '{}');
if (saved.profile) $('profile').value = saved.profile;
if (saved.options) restoreOptions(saved.options);
applyEnemiesVisibility();

$('precision').addEventListener('change', () => {
  $('iterations-label').classList.toggle('hidden', $('precision').value !== 'iterations');
});
// The target count only means something for Patchwerk / Training Dummy (N
// stationary targets). DungeonSlice runs a fixed scripted route and
// HecticAddCleave is 1 boss + scripted add waves — simc sets their targets
// itself, so we hide the field there (matching Raidbots).
function applyEnemiesVisibility() {
  const editable = $('fight-style').value === 'Patchwerk' || $('fight-style').value === 'Dummy';
  $('num-enemies').classList.toggle('hidden', !editable);
  $('enemies-fixed').classList.toggle('hidden', editable);
}
$('fight-style').addEventListener('change', () => {
  const style = $('fight-style').value;
  applyEnemiesVisibility();
  // Defaults that match Raidbots: 5 min Patchwerk, 6 min DungeonSlice, long dummy parse
  $('fight-length').value = style === 'Dummy' ? 600 : style === 'DungeonSlice' ? 360 : 300;
});

$('sim-button').addEventListener('click', startSim);
$('cancel-button').addEventListener('click', cancelSim);

// Raidbots-style presets: flip every raid buff and consumable at once,
// so matching an "everything off" Raidbots run is one click.
function setAllBuffsConsumables(on) {
  document.querySelectorAll('#buffs input, #consumables input')
    .forEach((cb) => { cb.checked = on; });
}
$('preset-all-on').addEventListener('click', () => setAllBuffsConsumables(true));
$('preset-all-off').addEventListener('click', () => setAllBuffsConsumables(false));

// ---------- tabs ----------
const SIM_LABEL_KEYS = { quick: 'sim.button', topgear: 'sim.compareGear', droptimizer: 'sim.runDroptimizer', statweights: 'sim.calcStatWeights' };
function simLabel(m) { return tr(SIM_LABEL_KEYS[m] ?? 'sim.button'); }
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('gear-section').classList.toggle('hidden', mode !== 'topgear');
    $('dropt-section').classList.toggle('hidden', mode !== 'droptimizer');
    $('quick-nav-gear').classList.toggle('hidden', mode !== 'topgear');
    $('quick-nav-loot').classList.toggle('hidden', mode !== 'droptimizer');
    $('sim-button').textContent = simLabel(mode);
    $('sim-bar-status').textContent = '';
    if (mode === 'topgear') refreshGearList();
    if (mode === 'droptimizer') refreshDroptimizer();
  });
});

let gearRefreshTimer = null;
$('profile').addEventListener('input', () => {
  equippedItems = null; // character changed — resolved ilvls are stale
  delete $('tu-list').dataset.rendered;
  if (mode !== 'topgear') return;
  clearTimeout(gearRefreshTimer);
  gearRefreshTimer = setTimeout(() => {
    refreshGearList();
    if ($('track-upgrades-toggle').checked) loadEquippedItems();
  }, 400);
});

$('gear-all').addEventListener('click', () => setAllGear(true));
$('gear-none').addEventListener('click', () => setAllGear(false));
$('gear-max-upgrade').addEventListener('click', applyMaxAffordableUpgrades);
$('gear-catalyst-toggle').addEventListener('change', refreshGearList);

// ---------- Item search: add any item by name, at any item level ----------
let searchDebounce = null;
let searchSeq = 0; // guards against a slow older request overwriting a newer one's results
$('item-search-input').addEventListener('input', () => {
  const q = $('item-search-input').value.trim();
  clearTimeout(searchDebounce);
  if (q.length < 2) { $('item-search-results').classList.add('hidden'); return; }
  searchDebounce = setTimeout(() => runItemSearch(q), 300);
});

async function runItemSearch(q) {
  const seq = ++searchSeq;
  let body;
  try {
    const resp = await fetch(`/api/item-search?patch=${encodeURIComponent(patch)}&lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, profile: $('profile').value }),
    });
    body = await resp.json();
  } catch {
    return;
  }
  if (seq !== searchSeq) return; // a newer search has since started
  const results = $('item-search-results');
  results.classList.remove('hidden');
  if (!body.items?.length) {
    results.innerHTML = '<p class="empty">No matching items.</p>';
    return;
  }
  results.innerHTML = body.items.map((it) => `
    <button type="button" class="search-result" data-search-add="${it.id}">
      <span class="gear-icon-row">${itemTile(it.id, { name: it.name, slot: prettySlot(it.slot), quality: it.quality })}
        <span>${esc(it.name)} <span class="hint-inline">(${esc(prettySlot(it.slot))})</span></span></span>
    </button>`).join('')
    + (body.truncated ? '<p class="hint">More matches than shown — narrow your search.</p>' : '');
  paintItemIcons(results);
  loadWowheadWidget().then(refreshWowheadLinks); // search rows carry data-wowhead too, same as any other item icon
  results.querySelectorAll('button.search-result').forEach((btn, idx) => {
    btn.addEventListener('click', () => addSearchItem(body.items[idx]));
  });
}

// Adds a found item to the gear list's own "Search" section, defaulting to
// this season's top track step (its ilvl-select then offers every other
// season step, or "custom…" for any number — see seasonLadder/ilvlControl).
function addSearchItem(it) {
  const ladder = seasonLadder();
  const ilvl = ladder.at(-1)?.ilvl ?? season?.maxIlvl ?? 400;
  searchItems.push({
    _searchKey: `${it.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: it.name, id: it.id, ilvl, targetIlvl: null, slot: it.slot, section: 'Search',
    line: `${it.slot}=,id=${it.id},ilevel=${ilvl}`,
  });
  $('item-search-input').value = '';
  $('item-search-results').classList.add('hidden');
  refreshGearList();
}
$('gear-slot-filter').addEventListener('click', (e) => {
  const chip = e.target.closest('button.chip');
  if (!chip) return;
  chip.classList.toggle('active');
  const slots = [...$('gear-slot-filter').querySelectorAll('button.chip.active')].map((c) => c.dataset.slot);
  if (slots.length) soloGearSlots(slots); else setAllGear(true);
});

// Voidcore toggle is only meaningful on fully upgraded (6/6) items
$('dropt-upgrade').addEventListener('change', () => {
  const at66 = $('dropt-upgrade').value === '5';
  $('dropt-voidcore').disabled = !at66;
  $('dropt-voidcore-label').classList.toggle('disabled-label', !at66);
  if (!at66) $('dropt-voidcore').checked = false;
});

function setAllGear(checked) {
  // equipped items are locked on (see refreshGearList) — always the baseline
  // everything else is compared against, never a real toggle
  document.querySelectorAll('#gear-list input:not(:disabled)').forEach((cb) => { cb.checked = checked; });
  updateGearCount();
}

// Tick only the "Items to compare" rows in the given slots, untick the rest —
// used by both the per-item slot button (one slot) and the "Filter Sim by
// Slot" multi-select above the list (one or more), which stay in sync.
function soloGearSlots(slots) {
  const wanted = new Set(slots);
  document.querySelectorAll('#gear-list input[data-gear-index]:not(:disabled)').forEach((cb) => {
    const it = gearItems[Number(cb.dataset.gearIndex)];
    cb.checked = !!it && wanted.has(it.slot);
  });
  updateGearCount();
}

const SLOT_ORDER = ['head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist',
  'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2', 'main_hand', 'off_hand'];

function populateGearSlotFilter() {
  const row = $('gear-slot-filter');
  const present = new Set(gearItems.map((it) => it.slot));
  const slots = SLOT_ORDER.filter((s) => present.has(s));
  const prevActive = new Set([...row.querySelectorAll('button.chip.active')].map((c) => c.dataset.slot));
  row.innerHTML = slots.map((s) => `<button type="button" class="chip${prevActive.has(s) ? ' active' : ''}"
    data-slot="${esc(s)}">${esc(prettySlot(s))}</button>`).join('');
}

// upgrade_currencies=c:1792:16/c:3443:13/... (see server/gearParser.js for the
// equivalent equipped-item id parsing) — a comment line the addon writes once
// near the bottom of the export, id:amount pairs prefixed c: (currency) or i: (item).
function crestWalletFromProfile(text) {
  const m = text.match(/^\s*#?\s*upgrade_currencies=(\S+)/m);
  const wallet = new Map();
  if (!m) return wallet;
  for (const part of m[1].split('/')) {
    const [, id, amount] = part.match(/^c:(\d+):(\d+)$/) ?? [];
    if (id) wallet.set(Number(id), Number(amount));
  }
  return wallet;
}

// An item's place on its track, as decoded from its bonus id by the server
// (see decodeTrack in server/index.js). Item levels are shared between tracks
// -- 321 is Hero 6/6 AND Myth 2/6, 308 is Champion 6/6 AND Hero 2/6 -- so
// there is nothing to work out here: either the item told us, or we do not
// offer upgrades for it.
function trackInfo(item) {
  if (!item?.track || item.stepIdx == null) return null;
  if (!season?.tracks?.[item.track]) return null;
  return { track: item.track, stepIdx: item.stepIdx };
}

// Sets every ALREADY-SELECTED item (equipped gear is always selected/locked,
// same as any bag item someone ticked themselves) to the highest step its own
// track's crests can still afford — crest cost per step and the currency id
// for each track come from data/season.json's upgradeCrests (hand-confirmed
// against a live export). Never ticks a box on its own: that would silently
// add items to what gets simmed that the user never chose to include.
function applyMaxAffordableUpgrades() {
  let changed = 0;
  gearItems.forEach((item, i) => {
    const box = document.querySelector(`#gear-list input[data-gear-index="${i}"]`);
    if (!box?.checked) return;
    item.targetIlvl = maxAffordableIlvlFor(item);
    const sel = document.querySelector(`#gear-list select.ilvl-select[data-gear-index="${i}"]`);
    if (sel && [...sel.options].some((o) => o.value === String(item.targetIlvl ?? ''))) {
      sel.value = String(item.targetIlvl ?? '');
    }
    if (item.targetIlvl) changed++;
  });
  updateGearCount();
  $('gear-count').textContent += changed
    ? ` · ${changed} selected item${changed === 1 ? '' : 's'} set to their highest affordable step`
    : ' · nothing selected that your crests can upgrade further';
}

function updateGearCount() {
  const boxes = [...document.querySelectorAll('#gear-list input')];
  $('gear-count').textContent = boxes.length
    ? `${boxes.filter((b) => b.checked).length} of ${boxes.length} selected`
    : '';
  // mirrored into the sticky sim bar so the running total stays visible no
  // matter how far down this (now full-page) gear list the user has scrolled
  if (mode === 'topgear') $('sim-bar-status').textContent = $('gear-count').textContent;
}

// One synthetic "Catalyzed" candidate per non-crafted item that's in a
// catalyst-eligible slot: the real tier piece it becomes, carrying the
// looted item's own stats over via redirected_base_stats= (see
// profileBuilder.js). Skips items with no known ilvl (nothing to redirect
// from) and items that already ARE the tier piece.
function catalystEntriesFor(sourceItems) {
  if (!catalystSlots) return [];
  const out = [];
  for (const item of sourceItems) {
    if (item.crafted) continue;
    const target = catalystSlots[item.slot];
    const ilvl = item.targetIlvl ?? item.ilvl;
    if (!target || !ilvl || target.id === item.id) continue;
    out.push({
      name: target.name ?? `${item.name} (catalyzed)`,
      id: target.id,
      ilvl,
      targetIlvl: null,
      slot: item.slot,
      section: 'Catalyzed',
      catalystFrom: item.name,
      line: `${item.slot}=,id=${target.id},ilevel=${ilvl},redirected_base_stats=${item.id}`,
    });
  }
  return out;
}

async function refreshGearList() {
  refreshCrestPrices();   // priced ladder for the affordable-upgrade button and summary
  const profile = $('profile').value;
  gearItems = [];
  if (!profile.trim()) {
    $('gear-list').innerHTML = '<p class="empty">Paste your /simc export above first.</p>';
    updateGearCount();
    return;
  }
  try {
    const resp = await fetch('/api/gear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, patch, lang, customLoadouts }),
    });
    const body = await resp.json();
    // equipped items come after bag/vault ones, so the "Equipped" group in
    // the list renders below "Bags" — same checkbox+ilvl-select UI, used to
    // compare "what would upgrading what I already have get me".
    gearItems = [...(body.items ?? []), ...(body.equippedGear ?? [])];
    catalystSlots = body.catalystSlots ?? null;
    // "Catalyzed" is a synthetic section: one extra candidate per ticked-
    // eligible looted item, simmed as the real tier piece it becomes (see
    // catalystEntriesFor) — appended so it renders as its own gear-list group
    // via the same bySection logic below, and gets real indices into
    // gearItems so submitting/ticking it works exactly like any other item.
    if ($('gear-catalyst-toggle')?.checked) {
      gearItems = [...gearItems, ...catalystEntriesFor(gearItems)];
    }
    // items added via "Item search" live outside the export entirely, so
    // they're kept in their own array (searchItems) and merged back in here
    // on every refresh, same appended-with-real-indices treatment as Catalyzed
    gearItems = [...gearItems, ...searchItems];
    itemSets = body.itemSets ?? [];
    // every candidate is simmed with the enchant/gems already on that slot
    // (see droptimizer.js) rather than whatever the bag item itself carries,
    // so the tooltip should show that carried-over enchant/gems too, not the
    // (usually empty) ones on the dropped item's own line
    equippedEnchGemBySlot = {};
    for (const eq of body.equippedGear ?? []) {
      const line = String(eq.line ?? '');
      equippedEnchGemBySlot[eq.slot] = {
        enchantId: Number(line.match(/enchant_id=(\d+)/)?.[1]) || null,
        gemIds: (line.match(/gem_id=([\d/]+)/)?.[1] ?? '').split('/').filter((g) => g && g !== '0'),
      };
    }
    renderItemSets();
    renderLoadoutOptions(body.talents ?? { available: false, loadouts: body.loadouts ?? [] });
  } catch {
    $('gear-list').innerHTML = '<p class="empty">Could not reach the server.</p>';
    return;
  }
  if (!gearItems.length) {
    $('gear-list').innerHTML =
      '<p class="empty">No bag items found in this export. Make sure you copied the WHOLE ' +
      '/simc text — the addon lists bag gear at the bottom as comment lines.</p>';
    updateGearCount();
    return;
  }
  // Raidbots-style: one block per SLOT (not per bags/equipped/etc. section),
  // each a grid of clickable item cards -- the section still shows as a small
  // label on the card since unlike Raidbots we also track Catalyzed/Search
  // as distinct synthetic sources worth calling out.
  const bySlot = {};
  gearItems.forEach((item, i) => { (bySlot[item.slot] ??= []).push({ item, i }); });
  const slots = SLOT_ORDER.filter((s) => bySlot[s]);
  // equipped always leads its slot's list -- it's the fixed baseline, so it
  // reads naturally as "here's what you have, here's what could replace it"
  for (const slot of slots) {
    bySlot[slot].sort((a, b) => (b.item.section === 'Equipped') - (a.item.section === 'Equipped'));
  }
  // Raidbots-style: one COLUMN per slot (Head | Neck | Shoulders | ...),
  // each slot's items stacked vertically underneath its heading -- #gear-list
  // itself is the multi-column grid, not each slot's own item list.
  $('gear-list').innerHTML = slots.map((slot) => `
    <div class="gear-slot-block">
      <h3 class="gear-slot-heading">${esc(prettySlot(slot))} (${bySlot[slot].length})</h3>
      <div class="gear-slot-grid">
        ${bySlot[slot].map(({ item, i }) => {
          const info = {
            name: item.name, ilvl: item.targetIlvl ?? item.ilvl, slot: prettySlot(item.slot),
            statSource: Number(String(item.line ?? '').match(/redirected_base_stats=(\d+)/)?.[1]) || null,
            source: item.section, quality: item.quality, craftingQuality: item.craftingQuality,
            craftedStats: item.craftedStats,
            bonusIds: bonusIdsFromLine(item.line),
            enchantId: equippedEnchGemBySlot[item.slot]?.enchantId,
            gemIds: equippedEnchGemBySlot[item.slot]?.gemIds,
            ...(trackInfo(item)
              ? { track: item.track, trackStep: item.stepIdx + 1, trackMax: season.tracks[item.track].length }
              : {}),
          };
          // The sim always simmed your equipped gear as the baseline anyway
          // (buildInput never touches it, buildTopGearInput skips a no-op
          // "replace X with X" candidate for an un-upgraded one — see its
          // skippedAsWorn) — so an equipped item is always ticked and locked
          // rather than offering a toggle that either does nothing or would
          // silently drop the baseline everything else compares against.
          const equipped = item.section === 'Equipped';
          return `
      <label class="gear-card${equipped ? ' locked' : ''}" ${equipped ? 'title="Currently equipped — always simmed as the baseline every candidate is compared against"' : ''}>
        <input type="checkbox" class="gear-card-check" data-gear-index="${i}" ${equipped ? 'checked disabled' : ''}>
        <span class="gear-card-icon" ${tileDataAttrs(item.id, info)}>${itemTileWithBadge(item.id, info, item)}</span>
        <span class="gear-card-body">
          <span class="gear-card-name">${esc(item.name)}${trackTagFor(item) ? ` <span class="track-tag tier-${trackTagFor(item).toLowerCase()}">(${trackTagFor(item)})</span>` : ''}</span>
          ${item.section !== 'Bags' ? `<span class="gear-card-section">${esc(item.section)}${equipped ? ' · locked' : ''}</span>` : ''}
          ${ilvlControl(item, i)}
        </span>
        ${item.section === 'Search'
          ? `<button type="button" class="search-remove" data-search-key="${esc(item._searchKey)}" title="Remove from the list">✕</button>` : ''}
      </label>`;
        }).join('')}
      </div>
    </div>`).join('');
  paintItemIcons($('gear-list'));
  document.querySelectorAll('#gear-list input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', updateGearCount);
  });
  document.querySelectorAll('#gear-list button.search-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      searchItems = searchItems.filter((it) => it._searchKey !== btn.dataset.searchKey);
      refreshGearList();
    });
  });
  populateGearSlotFilter();
  document.querySelectorAll('#gear-list select.ilvl-select').forEach((sel) => {
    sel.addEventListener('click', (e) => e.preventDefault()); // don't toggle the row checkbox
    sel.addEventListener('change', () => {
      const i = Number(sel.dataset.gearIndex);
      if (sel.value === 'custom') {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'ilvl-custom';
        input.min = 100; input.max = 500;
        input.value = gearItems[i].targetIlvl ?? gearItems[i].ilvl ?? 289;
        input.dataset.gearIndex = i;
        input.addEventListener('click', (e) => e.preventDefault());
        input.addEventListener('input', () => {
          gearItems[i].targetIlvl = Number(input.value) || null;
        });
        sel.replaceWith(input);
        input.focus();
        gearItems[i].targetIlvl = Number(input.value);
      } else {
        gearItems[i].targetIlvl = Number(sel.value) || null;
      }
    });
  });
  updateGearCount();
}

const SLOT_KEYS = {
  head: 'slot.head', neck: 'slot.neck', shoulder: 'slot.shoulder', back: 'slot.back', chest: 'slot.chest',
  wrist: 'slot.wrist', hands: 'slot.hands', waist: 'slot.waist', legs: 'slot.legs', feet: 'slot.feet',
  finger1: 'slot.finger1', finger2: 'slot.finger2', trinket1: 'slot.trinket1', trinket2: 'slot.trinket2',
  main_hand: 'slot.mainHand', off_hand: 'slot.offHand', weapons: 'slot.weapons',
};
function prettySlot(slot) {
  const key = SLOT_KEYS[slot];
  if (key && I18N[lang]?.[key]) return tr(key);
  return slot.replace(/_/g, ' ').replace(/(finger|trinket)([12])/, '$1 $2');
}

// ---------- track upgrades (equipped gear) ----------
let equippedItems = null; // resolved from simc via /api/gear resolveIlvls

$('track-upgrades-toggle').addEventListener('change', async () => {
  const on = $('track-upgrades-toggle').checked;
  $('track-upgrades-panel').classList.toggle('hidden', !on);
  if (on && !equippedItems) await loadEquippedItems();
});
$('tu-step').addEventListener('change', () => {
  const at66 = $('tu-step').value === '5';
  $('tu-voidcore').disabled = !at66;
  $('tu-voidcore-label').classList.toggle('disabled-label', !at66);
  if (!at66) $('tu-voidcore').checked = false;
  renderEquippedList();
});
$('tu-voidcore').addEventListener('change', renderEquippedList);
$('tu-all').addEventListener('click', () => setAllTu(true));
$('tu-none').addEventListener('click', () => setAllTu(false));
function setAllTu(on) {
  document.querySelectorAll('#tu-list input:not(:disabled)').forEach((cb) => { cb.checked = on; });
}

async function loadEquippedItems() {
  $('tu-status').textContent = 'Resolving item levels via simc…';
  try {
    const r = await (await fetch('/api/gear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: $('profile').value, resolveIlvls: true, patch, lang }),
    })).json();
    equippedItems = r.equippedItems ?? null;
    $('tu-status').textContent = r.equippedItemsError ? `Failed: ${r.equippedItemsError}` : '';
  } catch {
    $('tu-status').textContent = 'Could not reach the server.';
  }
  renderEquippedList();
}

function tuTarget(item) {
  if (!item.track || !season?.tracks) return null;
  const steps = season.tracks[item.track];
  if (!steps) return null;
  const idx = item.stepIdx ?? steps.indexOf(item.ilvl);
  if (idx < 0) return null;
  let target = steps[Math.max(idx, Number($('tu-step').value))];
  if ($('tu-voidcore').checked && $('tu-step').value === '5'
      && season.voidcore?.slots?.includes(item.slot)) {
    if (item.track === 'Myth' && season.voidcore.mythIlvl) target = season.voidcore.mythIlvl;
    if (item.track === 'Hero' && season.voidcore.heroIlvl) target = season.voidcore.heroIlvl;
  }
  return target > item.ilvl ? target : null;
}

function renderEquippedList() {
  if (!equippedItems) { $('tu-list').innerHTML = ''; return; }
  const prevChecked = new Set([...document.querySelectorAll('#tu-list input:checked')].map((cb) => cb.dataset.tuslot));
  const first = prevChecked.size === 0 && !$('tu-list').dataset.rendered;
  $('tu-list').innerHTML = equippedItems.map((it) => {
    const target = tuTarget(it);
    const upgradable = target !== null;
    const checked = upgradable && (first || prevChecked.has(it.slot));
    // trackSource 'none' = the item carries no upgrade track from this season,
    // so it is a leftover from an earlier season and cannot be upgraded at all
    const why = upgradable ? ` → ${target}`
      : it.trackSource === 'none' ? ' (older season — not upgradable)'
        : it.track ? ' (maxed)' : ' (no track)';
    return `<label class="cg-opt ${upgradable ? '' : 'disabled-label'}">
      <input type="checkbox" data-tuslot="${esc(it.slot)}" ${checked ? 'checked' : ''} ${upgradable ? '' : 'disabled'}>
      <span class="gear-icon-row">${itemTile(it.id, {
        name: it.name, ilvl: it.ilvl, slot: prettySlot(it.slot),
        statSource: it.statSource ?? null,
        source: it.track ? `${it.track}${it.stepIdx != null ? ` ${it.stepIdx + 1}/6` : ''}` : null,
        bonusIds: bonusIdsFromLine(it.line),
      })}<span>${esc(it.name)} <span class="hint-inline">${it.ilvl}${why}${it.track ? ` · ${it.track}${it.stepIdx != null ? ` ${it.stepIdx + 1}/6` : ''}${it.trackSource === 'guessed' ? ' (guessed)' : ''}` : ''}</span></span>
    </span></label>`;
  }).join('');
  $('tu-list').dataset.rendered = '1';
  paintItemIcons($('tu-list'));
}

// ---------- droptimizer ----------
let droptTree = null;
let droptPoll = null;
let raidByInstance = {}; // instanceId -> raid tree entry, for live ilvl updates on diff toggle

$('dropt-all').addEventListener('click', () => setAllDropt(true));
$('dropt-none').addEventListener('click', () => setAllDropt(false));
$('dropt-refresh').addEventListener('click', async () => {
  await fetch('/api/data/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patch, lang }),
  });
  refreshDroptimizer();
});

function setAllDropt(on) {
  document.querySelectorAll('#dropt-sources input[type="checkbox"]').forEach((cb) => {
    if (cb.disabled) return;
    cb.checked = on;
    // raid difficulty / crafted-master checkboxes drive a live re-render
    // (ilvl display, item enable state) that only runs off a 'change' event
    if (cb.dataset.raid || cb.id === 'dropt-crafted' || cb.id === 'dropt-crafted-emb') {
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
}

async function refreshDroptimizer() {
  clearTimeout(droptPoll);
  const profile = $('profile').value;
  if (!profile.trim()) {
    $('dropt-status').textContent = 'Paste your /simc export above first.';
    $('dropt-sources').innerHTML = '';
    return;
  }
  let r;
  try {
    r = await (await fetch('/api/droptimizer/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile, patch, lang }),
    })).json();
  } catch {
    $('dropt-status').textContent = 'Could not reach the server.';
    return;
  }
  if (r.error) {
    $('dropt-status').textContent = r.error;
    $('dropt-sources').innerHTML = '';
    return;
  }
  if (r.needsData || r.status?.refresh?.running) {
    const step = r.status?.refresh?.running
      ? `Downloading game data: ${r.status.refresh.step ?? '…'}`
      : r.status?.cache?.buildMismatch
        ? 'Your cached game data is from the wrong game build — hit "Refresh data" to re-download the right one (~60 MB).'
        : r.status?.cache?.downloadedAt
          ? 'Localbots was updated and needs fresh game data — hit "Refresh data" (~60 MB from wago.tools).'
          : 'Game data not downloaded yet — hit "Refresh data" (one-time, ~60 MB from wago.tools).';
    $('dropt-status').textContent = step;
    $('dropt-sources').innerHTML = '';
    if (r.status?.refresh?.running) droptPoll = setTimeout(refreshDroptimizer, 2500);
    return;
  }

  const probe = r.status.probe;
  if (!probe.ready) {
    $('dropt-status').textContent = probe.error
      ? `Item check failed: ${probe.error}`
      : 'One-time check: finding which items your simc build can sim… (~30s)';
    if (!probe.error) droptPoll = setTimeout(refreshDroptimizer, 3000);
    if (!droptTree) $('dropt-sources').innerHTML = '';
    if (!probe.error && !droptTree) return;
    if (!probe.ready && !probe.error) return;
  } else {
    const age = r.status.cache?.downloadedAt
      ? `game data from ${new Date(r.status.cache.downloadedAt).toLocaleDateString()}`
      : '';
    $('dropt-status').textContent = `Filtering loot for ${r.spec.key.replace('_', ' ')} · ${age}`;
  }

  droptTree = r.tree;
  renderTierToggle(r.tierSet);
  renderDroptSources(r.tree, r.season, r.crafted);
}

// The "keep my tier set bonus" toggle only makes sense for a character who is
// wearing a set, so it stays hidden until one is detected.
function renderTierToggle(tierSet) {
  const row = $('dropt-tier-row');
  if (!row) return;
  const active = tierSet?.active ?? [];
  row.classList.toggle('hidden', !active.length);
  if (!active.length) { $('dropt-tier').checked = false; return; }
  $('dropt-tier-note').textContent =
    `${tierSet.name} — ${tierSet.equipped} pieces (${active.map((n) => `${n}pc`).join(' + ')})`;
}

// the six unordered combinations of the four selectable secondaries
const CRAFT_PAIRS = [
  ['32/36', 'Crit + Haste'], ['32/49', 'Crit + Mastery'], ['32/40', 'Crit + Vers'],
  ['36/49', 'Haste + Mastery'], ['36/40', 'Haste + Vers'], ['49/40', 'Mastery + Vers'],
];

// Raidbots-style "Items to Sim" list: every item a boss can actually drop
// for this class/spec, shown with its own icon + real Wowhead hover, each
// one individually togglable out of the sim (data-exclitem, read back by
// collectDroptSelection). Checked by default, same as the source itself.
function itemsToSimRow(items, ilvlForItem = null, disabled = false) {
  if (!items?.length) return '';
  return `<div class="dropt-items">${items.map((it) => {
    const ilvl = ilvlForItem ? ilvlForItem(it) : null;
    // "Already crafted this season" is detected server-side from the
    // player's own equipped/bagged gear (see ownedCraftedItemIds in
    // droptimizer.js) -- a recraft (same item, different stats) costs no
    // Spark, unlike a brand-new one. Purely informational here; read back
    // via it.owned for the Sparks budget math and the Best Setup / Your Top
    // Gear "recraft" badge.
    const owned = it.owned ? `
      <span class="dropt-owned" title="${lang === 'es' ? 'Ya lo tienes crafteado esta temporada (equipado o en las bolsas, a un ilvl de esta season) — un recraft no gasta chispas' : "You already have this crafted THIS season (equipped or in your bags, at a this-season ilvl) — a recraft costs no Spark"}">
        ${lang === 'es' ? '♻️ ya lo tienes' : '♻️ already made'}
      </span>` : '';
    return `<span class="dropt-item" title="${esc(it.name)}">
      <input type="checkbox" data-exclitem="${it.id}" data-sparkcost="${it.sparkCost ?? 2}" data-owned="${it.owned ? 1 : 0}" ${disabled ? 'disabled' : 'checked'}>
      ${dropItemTile(it.id, it.name, ilvl)}${owned}
    </span>`;
  }).join('')}</div>`;
}

// Like wowheadLinkedTile, but also pins the hovercard/link to an exact item
// level (Raidbots does the same with its own &ilvl= param) -- without it
// Wowhead shows some default roll instead of what this difficulty actually
// drops, and it never changes when you flip a raid's difficulty checkboxes.
function dropItemTile(itemId, label, ilvlInfo) {
  const whHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
  const ilvlParam = ilvlInfo?.param ? `ilvl=${Number(ilvlInfo.param)}` : '';
  const wowhead = (lang === 'es' ? `es:item=${Number(itemId)}` : `item=${Number(itemId)}`) + (ilvlParam ? `&${ilvlParam}` : '');
  const href = `https://${whHost}/item=${Number(itemId)}${ilvlParam ? `?${ilvlParam}` : ''}`;
  const tile = itemTile(itemId, { mini: true, noLink: true });
  return `<a class="cg-opt-link enchgem-item" href="${href}" data-wowhead="${wowhead}" target="_blank" rel="noopener">${tile} ${esc(label)}${ilvlInfo?.display ? ` <span class="hint-inline">(${esc(ilvlInfo.display)})</span>` : ''}</a>`;
}

// Per-boss item list for one raid, respecting whichever difficulties are
// currently checked -- multiple checked difficulties show every distinct
// ilvl they'd drop (e.g. "295 / 308"), and toggling a difficulty updates
// this immediately instead of only affecting what gets simmed. The Wowhead
// hovercard itself can only pin one ilvl, so it uses the first checked
// difficulty's.
function raidBossItemsHtml(raid, checkedDiffs) {
  // With no difficulty checked, nothing from this raid gets simmed -- grey
  // out and untick every item instead of leaving them looking included.
  const none = !checkedDiffs.length;
  return raid.bosses.filter((b) => b.items?.length).map((boss) => {
    const ilvlForItem = (it) => {
      if (!it.drops) return null;
      const vals = [...new Set(checkedDiffs.map((d) => it.drops[d]?.ilvl).filter(Boolean))];
      if (!vals.length) return null;
      return { display: vals.join(' / '), param: vals[0] };
    };
    return `<div class="dropt-row boss-items-row">
      <span class="hint-inline">${esc(boss.name)}</span>${itemsToSimRow(boss.items, ilvlForItem, none)}</div>`;
  }).join('');
}

// Raid drop levels climb through the instance, so each boss gets its own row.
// Shown collapsed: it exists to be checked against the adventure guide.
function bossLevelTable(raid, diffs) {
  const bosses = (raid.bosses ?? []).filter((b) => b.drops);
  if (!bosses.length) return '';
  const rows = bosses.map((b) => `<tr><td>${esc(b.name)}</td>${diffs.map((d) => {
    const drop = b.drops[d];
    if (!drop) return '<td>—</td>';
    return `<td title="${esc(drop.track)} ${drop.step}/${drop.max}">${drop.ilvl}
      <span class="hint-inline">${drop.step}/${drop.max}</span></td>`;
  }).join('')}</tr>`).join('');
  return `<details class="dropt-row boss-levels"><summary>Drop levels per boss</summary>
    <div class="boss-levels-scroll"><table>
    <thead><tr><th></th>${diffs.map((d) => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${rows}</tbody></table></div></details>`;
}

function renderDroptSources(tree, season, craftedCfg) {
  const html = [];
  const hidden = []; // unreleased sources (in game data, not in simc yet)
  const avail = (list) => list.filter((s) => (s.available ? true : (hidden.push(s.name), false)));

  const groupHeader = (title, on = true) =>
    `<h3><label><input type="checkbox" class="group-toggle" ${on ? 'checked' : ''}> ${title}</label></h3>`;

  const raids = avail(tree.raids);
  raidByInstance = {};
  if (raids.length) {
    html.push(`<div class="dropt-group" data-group="raids">${groupHeader('Raids')}`);
    const diffs = Object.keys(season.raidDifficulties);
    html.push(`<div class="dropt-row diff-toggle-row"><span class="hint-inline">All raids:</span>
      ${diffs.map((d) => `<button class="mini diff-toggle" data-difftoggle="${d}">${d}</button>`).join('')}</div>`);
    for (const raid of raids) {
      raidByInstance[raid.instanceId] = raid;
      html.push(`<div class="raid-block" data-raidid="${raid.instanceId}">
      <div class="dropt-row">
        <span class="src-name">${esc(raid.name)} <span class="hint-inline">${raid.usable} items</span></span>
        <span class="diff-boxes">${diffs.map((d) => `
          <label><input type="checkbox" data-raid="${raid.instanceId}" data-diff="${d}"
            ${d === 'Heroic' ? 'checked' : ''}> ${d}</label>`).join('')}
        </span></div>`);
      html.push(bossLevelTable(raid, diffs));
      html.push(`<div class="raid-items">${raidBossItemsHtml(raid, ['Heroic'])}</div></div>`);
    }
    html.push('</div>');
  }

  const dungeons = avail(tree.dungeons);
  if (dungeons.length) {
    const keys = Object.keys(season.mythicPlus.endOfDungeon);
    html.push(`<div class="dropt-group" data-group="dungeons">${groupHeader('Mythic+')}
      <div class="dropt-row">
        <label>Key level
          <select id="dropt-keylevel">${keys.map((k) => `<option value="${k}" ${k === '10' ? 'selected' : ''}>${k === '0' ? 'M0' : '+' + k}</option>`).join('')}</select>
        </label>
        <label><input type="radio" name="dropt-reward" value="end"> End of dungeon</label>
        <label><input type="radio" name="dropt-reward" value="vault" checked> Great Vault</label>
      </div>`);
    for (const d of dungeons) {
      html.push(`<div class="dropt-row">
        <label><input type="checkbox" data-dungeon="${d.instanceId}" checked>
          ${esc(d.name)} <span class="hint-inline">${d.usable} items</span></label>
        ${itemsToSimRow(d.bosses.flatMap((b) => b.items ?? []))}</div>`);
    }
    html.push('</div>');
  }

  const worldBosses = avail(tree.worldBosses);
  if (worldBosses.length) {
    const wb = worldBosses[0];
    html.push(`<div class="dropt-group" data-group="worldboss">${groupHeader('World bosses')}
      <div class="dropt-row">
        <label><input type="checkbox" id="dropt-wb" checked>
          ${esc(wb.name)} <span class="hint-inline">${wb.usable} items</span></label>
        <label>ilvl <input type="number" id="dropt-wb-ilvl" value="${season.worldBossIlvl}" min="200" max="320"></label>
      </div></div>`);
  }

  const outdoor = avail(tree.outdoor);
  if (outdoor.length) {
    html.push(`<div class="dropt-group" data-group="outdoor">${groupHeader('Outdoor / events')}`);
    html.push(`<div class="dropt-row"><label>ilvl <input type="number" id="dropt-outdoor-ilvl" value="${season.outdoorIlvl}" min="200" max="320"></label></div>`);
    for (const o of outdoor) {
      html.push(`<div class="dropt-row">
        <label><input type="checkbox" data-outdoor="${o.instanceId}" checked>
          ${esc(o.name)} <span class="hint-inline">${o.usable} items</span></label></div>`);
    }
    html.push('</div>');
  }

  // register crafted with avail() before the hint below so an unavailable
  // crafted source is listed as "not yet released" instead of vanishing
  const crafted = avail(tree.crafted ?? []);

  if (hidden.length) {
    html.push(`<p class="hint">Not yet released (found in game data, but not live): ${hidden.map(esc).join(', ')} — these appear automatically once the patch drops and simc is updated.</p>`);
  }

  if (crafted.length) {
    const craftedItems = crafted.flatMap((c) => c.bosses.flatMap((b) => b.items ?? []));
    html.push(`<div class="dropt-group" data-group="crafted">
      <h3><label><input type="checkbox" id="dropt-crafted">
        Crafted gear <span class="hint-inline">${crafted[0].usable} craftable items</span></label></h3>
      <div class="dropt-row">
        <label>ilvl <input type="number" id="dropt-crafted-ilvl" disabled value="${craftedCfg?.maxIlvl ?? 285}" min="200" max="320"></label>
        <label title="How many Sparks (or equivalent crafting currency) you actually have -- crafting a new item spends one, regardless of which stat combo you pick at the table. Leave blank if you don't want to track it.">
          Sparks available <input type="number" id="dropt-crafted-sparks" disabled min="0" placeholder="?">
        </label>
        <span class="hint-inline" id="crafted-sparks-status"></span>
      </div>
      <div class="dropt-row" id="crafted-pairs">
        <span class="hint-inline">Preferred Stats:</span>
        ${CRAFT_PAIRS.map(([pair, label]) => `
          <label><input type="checkbox" data-pair="${pair}" disabled checked> ${label}</label>`).join('')}
      </div>
      <div class="dropt-row">
        <label title="Crafted weapons and trinkets at max craft can take an Ascendant Voidcore">
          <input type="checkbox" id="dropt-crafted-voidcore" disabled>
          Apply Voidcores <span class="hint-inline">weapons &amp; trinkets → ${craftedCfg?.voidcoreIlvl ?? 295}</span></label>
        <label title="A few crafted designs carry a built-in embellishment effect — simc simulates it">
          <input type="checkbox" id="dropt-crafted-emb" disabled checked>
          Include embellished crafts</label>
      </div>
      ${(craftedCfg?.embellishments?.length ?? 0) ? `
      <div class="cg-slot-head">Embellishments — which craft-time effect is worth the most?</div>
      <div class="dropt-row" id="crafted-emb-picker">
        ${craftedCfg.embellishments.map((o) => `
          <label><input type="checkbox" data-embkey="${esc(o.key)}" disabled checked> ${esc(o.label)}</label>`).join('')}
      </div>
      <p class="hint">Each ticked embellishment is simmed on a crafted piece — once, and
        doubled (×2) where two copies stack. Only 2 embellished items can be worn at a
        time; rows respect what your character already has equipped.</p>` : ''}
      <p class="hint">Click any row or item to toggle inclusion in the sim — same-slot crafts
        share stats, so one item stands in per combo you picked above.</p>
      ${itemsToSimRow(craftedItems, null, true)}
    </div>`);
  }

  html.push(`<div class="dropt-group" data-group="delves">${groupHeader('Delves')}`);
  if (tree.delves.length) {
    html.push(`<div class="dropt-row">
      <label><input type="checkbox" id="dropt-delves-champion" checked>
        Champion track <span class="hint-inline">high Bountiful Coffers · ${season.delveTracks?.Champion ?? 250} · ${tree.delves[0].usable} items</span></label>
    </div>
    <div class="dropt-row">
      <label><input type="checkbox" id="dropt-delves-hero" checked>
        Hero track <span class="hint-inline">Trovehunter's Bounty / Great Vault · ${season.delveTracks?.Hero ?? 259}</span></label>
    </div>
    <p class="hint">Pool datamined from game data (same as Raidbots' unverified list) — edit data/delve-loot.json if you see items that don't drop.</p>`);
  } else {
    html.push('<p class="hint">Delve loot pools are not in the game\'s client data — add items to <code>data/delve-loot.json</code> and hit Refresh data to enable this source.</p>');
  }
  html.push('</div>');

  $('dropt-sources').innerHTML = html.join('');
  paintItemIcons($('dropt-sources'));
  loadWowheadWidget().then(refreshWowheadLinks);
  updateCraftedSparksStatus();

  // Group on/off toggles: on checks everything in the section, off unchecks it.
  document.querySelectorAll('#dropt-sources .group-toggle').forEach((toggle) => {
    toggle.addEventListener('change', () => {
      const group = toggle.closest('.dropt-group');
      group.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        if (cb === toggle) return;
        cb.checked = toggle.checked;
        if (cb.dataset.raid) cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  });

  // Click anywhere on an item row (icon/name) to toggle it, same as Raidbots
  // — except the Wowhead link itself, which should still navigate on click.
  // Delegated (rather than bound per-row) so it keeps working after a raid's
  // item list is regenerated on a difficulty toggle, below.
  if (!$('dropt-sources').dataset.itemClickBound) {
    $('dropt-sources').dataset.itemClickBound = '1';
    $('dropt-sources').addEventListener('click', (ev) => {
      const row = ev.target.closest('.dropt-item');
      if (!row || ev.target.closest('a') || ev.target.matches('input')) return;
      const cb = row.querySelector('input[data-exclitem]');
      if (cb && !cb.disabled) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });

    // A raid's item list shows the ilvl(s) of whichever difficulties are
    // checked, and its Wowhead hovercards are pinned to that ilvl -- both
    // need refreshing the moment a difficulty checkbox flips, otherwise they
    // keep showing whatever was checked when the list was first drawn.
    $('dropt-sources').addEventListener('change', (ev) => {
      const cb = ev.target.closest('input[data-raid]');
      if (!cb) return;
      const raid = raidByInstance[cb.dataset.raid];
      const block = $('dropt-sources').querySelector(`.raid-block[data-raidid="${cb.dataset.raid}"] .raid-items`);
      if (!raid || !block) return;
      const checkedDiffs = [...document.querySelectorAll(`#dropt-sources input[data-raid="${cb.dataset.raid}"]:checked`)]
        .map((c) => c.dataset.diff);
      block.innerHTML = raidBossItemsHtml(raid, checkedDiffs);
      paintItemIcons(block);
      loadWowheadWidget().then(refreshWowheadLinks);
    });

    // "Crafted gear" master toggle: disable the WHOLE group along with it --
    // ilvl, Preferred Stats, Voidcores, embellishments and the item list --
    // instead of leaving every sub-control still tickable while the source
    // itself is off (same idea as a raid with no difficulty checked).
    $('dropt-sources').addEventListener('change', (ev) => {
      if (ev.target.id !== 'dropt-crafted') return;
      const on = ev.target.checked;
      document.querySelectorAll('[data-group="crafted"] input, [data-group="crafted"] select')
        .forEach((el) => {
          if (el === ev.target) return;
          el.disabled = !on;
        });
      document.querySelectorAll('[data-group="crafted"] input[data-exclitem]').forEach((cb) => {
        cb.checked = on;
      });
      // Re-enabling respects whatever "Include embellished crafts" was left
      // at, rather than force-enabling its picker too.
      if (on) $('dropt-crafted-emb').dispatchEvent(new Event('change', { bubbles: true }));
    });

    // "Include embellished crafts" gates the picker below it: with it off,
    // no embellishment options should stay selected either.
    $('dropt-sources').addEventListener('change', (ev) => {
      if (ev.target.id !== 'dropt-crafted-emb') return;
      const craftedOn = $('dropt-crafted')?.checked;
      const on = ev.target.checked && craftedOn;
      document.querySelectorAll('#crafted-emb-picker input[data-embkey]').forEach((cb) => {
        cb.disabled = !on;
        cb.checked = on;
      });
    });

    // Crafting a new item spends one Spark (or equivalent currency) no matter
    // which stat combo you roll at the table -- so the budget is the count of
    // distinct crafted items ticked, not multiplied by how many stat combos
    // are selected above. Purely informational: it warns rather than silently
    // dropping items, since which ones to cut is the player's call.
    $('dropt-sources').addEventListener('change', (ev) => {
      if (!ev.target.matches('#dropt-crafted-sparks') && !ev.target.matches('[data-group="crafted"] input[data-exclitem]')
        && ev.target.id !== 'dropt-crafted') return;
      updateCraftedSparksStatus();
    });

    // "Preferred Stats" must always keep at least one combo ticked -- there's
    // no sensible "sim nothing" state here, so refuse to uncheck the last one.
    $('dropt-sources').addEventListener('change', (ev) => {
      if (!ev.target.matches('#crafted-pairs input[data-pair]')) return;
      const boxes = [...document.querySelectorAll('#crafted-pairs input[data-pair]')];
      if (!boxes.some((cb) => cb.checked)) ev.target.checked = true;
    });
  }

  // Difficulty column toggles: flip one difficulty across all raids.
  document.querySelectorAll('#dropt-sources .diff-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const boxes = [...document.querySelectorAll(`#dropt-sources input[data-raid][data-diff="${btn.dataset.difftoggle}"]`)];
      const turnOn = boxes.some((cb) => !cb.checked);
      boxes.forEach((cb) => {
        cb.checked = turnOn;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  });
}

// Crafting a new item spends one Spark (or the season's equivalent crafting
// currency), same as simming it for comparison spends none -- so whatever
// count of DISTINCT crafted items is ticked here is what you'd actually need
// to be able to craft. Warns instead of capping automatically: which items
// to drop if you're over budget is a judgment call only the player can make.
function updateCraftedSparksStatus() {
  const status = $('crafted-sparks-status');
  if (!status) return;
  const sparks = $('dropt-crafted-sparks')?.value;
  if (!$('dropt-crafted')?.checked || sparks === '' || sparks == null) { status.textContent = ''; return; }
  const budget = Number(sparks) || 0;
  // A normal piece costs 2 Sparks (of Tides), a two-hander 4 -- so the
  // budget check sums real cost, not a flat "1 item = 1 Spark" count.
  // Already-crafted items (auto-detected server-side, data-owned) are free
  // to recraft, so they don't count here.
  const cost = [...document.querySelectorAll('[data-group="crafted"] input[data-exclitem]:checked')]
    .filter((cb) => cb.dataset.owned !== '1')
    .reduce((n, cb) => n + (Number(cb.dataset.sparkcost) || 2), 0);
  status.textContent = `${cost}/${budget} Sparks needed`;
  status.classList.toggle('over-budget', cost > budget);
  status.title = cost > budget
    ? 'You have fewer Sparks than the crafted items selected need — untick some in the list below, or you won\'t actually be able to craft all the winners this suggests. (Recrafting an item you already made this season for different stats doesn\'t cost another Spark.)'
    : '';
}

function collectDroptSelection() {
  const selection = { raids: {}, dungeons: null, worldBoss: null, outdoor: null, delves: null };
  document.querySelectorAll('#dropt-sources input[data-raid]:checked').forEach((cb) => {
    (selection.raids[cb.dataset.raid] ??= []).push(cb.dataset.diff);
  });
  const dungeonIds = [...document.querySelectorAll('#dropt-sources input[data-dungeon]:checked')]
    .map((cb) => cb.dataset.dungeon);
  if (dungeonIds.length) {
    selection.dungeons = {
      instanceIds: dungeonIds,
      keyLevel: $('dropt-keylevel')?.value ?? '10',
      reward: document.querySelector('input[name="dropt-reward"]:checked')?.value ?? 'vault',
    };
  }
  if ($('dropt-wb')?.checked) {
    selection.worldBoss = { enabled: true, ilvl: Number($('dropt-wb-ilvl')?.value) || undefined };
  }
  const outdoorIds = [...document.querySelectorAll('#dropt-sources input[data-outdoor]:checked')]
    .map((cb) => cb.dataset.outdoor);
  if (outdoorIds.length) {
    selection.outdoor = { instanceIds: outdoorIds, ilvl: Number($('dropt-outdoor-ilvl')?.value) || undefined };
  }
  const delveChamp = $('dropt-delves-champion')?.checked;
  const delveHero = $('dropt-delves-hero')?.checked;
  if (delveChamp || delveHero) {
    selection.delves = { champion: !!delveChamp, hero: !!delveHero };
  }
  if ($('dropt-crafted')?.checked) {
    selection.crafted = {
      enabled: true,
      ilvl: Number($('dropt-crafted-ilvl')?.value) || undefined,
      statPairs: [...document.querySelectorAll('#crafted-pairs input:checked')].map((cb) => cb.dataset.pair),
      voidcores: !!$('dropt-crafted-voidcore')?.checked,
      embellishments: !!$('dropt-crafted-emb')?.checked,
      embellishmentSel: [...document.querySelectorAll('#crafted-emb-picker input:checked')].map((cb) => cb.dataset.embkey),
    };
  }
  selection.excludeItemIds = [...document.querySelectorAll('#dropt-sources input[data-exclitem]:not(:checked)')]
    .map((cb) => cb.dataset.exclitem);
  selection.offspec = !!$('dropt-offspec')?.checked;
  selection.keepTierBonus = !!($('dropt-tier')?.checked && !$('dropt-tier-row')?.classList.contains('hidden'));
  selection.upgradeTo = Number($('dropt-upgrade')?.value) || 0;
  selection.voidcores = !!($('dropt-voidcore')?.checked && !$('dropt-voidcore')?.disabled);
  return selection;
}

// Raidbots-style "Minimum Set Bonus" pickers. Default: protect the bonus
// tier the character already has equipped (4pc -> 4, 2pc -> 2).
function renderItemSets() {
  $('itemsets-section').classList.toggle('hidden', !itemSets.length);
  setMinimums = {};
  if (!itemSets.length) { $('itemsets-list').innerHTML = ''; return; }
  $('itemsets-list').innerHTML = itemSets.map((s) => {
    const thresholds = [0, 2, 4].filter((t) => t === 0 || t <= s.size);
    const def = s.equipped >= 4 ? 4 : s.equipped >= 2 ? 2 : 0;
    setMinimums[s.setId] = def;
    return `<div class="dropt-row">
      <span class="src-name">${esc(s.name)} <span class="hint-inline">${s.equipped} ${tr('sets.equipped')} · ${s.owned} ${tr('sets.owned')}</span></span>
      <span class="diff-boxes">${thresholds.map((t) => `
        <button class="mini setmin ${t === def ? 'active' : ''}" data-set="${s.setId}" data-min="${t}"
          title="${t === 0 ? tr('sets.anyTitle') : tr('sets.hideBelowTitle').replace('{n}', t)}">${t === 0 ? tr('sets.any') : tr('sets.setN').replace('{n}', t)}</button>`).join('')}
      </span></div>`;
  }).join('');
  document.querySelectorAll('#itemsets-list .setmin').forEach((btn) => {
    btn.addEventListener('click', () => {
      setMinimums[btn.dataset.set] = Number(btn.dataset.min);
      document.querySelectorAll(`#itemsets-list .setmin[data-set="${btn.dataset.set}"]`)
        .forEach((b) => b.classList.toggle('active', b === btn));
    });
  });
}

// Every step of every upgrade track this season, deduped by item level and
// sorted — the same ladder Raidbots' Item Search offers ("Only Seasonal Item
// Levels"): a searched item has no track of its own to read steps from, so
// instead of guessing one, every level anyone could actually be simming at
// this season is on offer, plus a free "custom…" entry for anything else.
function seasonLadder() {
  if (!season?.tracks) return [];
  const labelByIlvl = new Map();
  for (const [track, ilvls] of Object.entries(season.tracks)) {
    ilvls.forEach((ilvl, idx) => {
      if (!labelByIlvl.has(ilvl)) labelByIlvl.set(ilvl, `${ilvl} — ${track} ${idx + 1}/${ilvls.length}`);
    });
  }
  return [...labelByIlvl.entries()].map(([ilvl, label]) => ({ ilvl, label })).sort((a, b) => a.ilvl - b.ilvl);
}

function ilvlControl(item, i) {
  if (item.section === 'Search') {
    const ladder = seasonLadder();
    return `<select class="ilvl-select" data-gear-index="${i}" title="Any of this season's upgrade-track item levels, or custom for any number">
      ${ladder.map((o) => `<option value="${o.ilvl}"${o.ilvl === item.ilvl ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
      <option value="custom">custom…</option>
    </select>`;
  }
  const opts = upgradeOptionsFor(item);
  if (!opts.length) {
    // no known upgrades (or no parsed ilvl) — still allow custom editing
    return `<select class="ilvl-select" data-gear-index="${i}">
      <option value="">${item.ilvl ?? '?'}</option>
      <option value="custom">custom…</option>
    </select>`;
  }
  return `<select class="ilvl-select" data-gear-index="${i}" title="Sim this item at a higher upgrade level">
    <option value="">${item.ilvl} (current)</option>
    ${opts.map((o) => `<option value="${o.ilvl}">${esc(o.label)}</option>`).join('')}
    <option value="custom">custom…</option>
  </select>`;
}

// ---------- options ----------
function collectOptions() {
  const opts = {
    fightStyle: $('fight-style').value,
    numEnemies: Number($('num-enemies').value),
    fightLength: Number($('fight-length').value),
    buffs: {},
    consumables: {},
  };
  if ($('precision').value === 'iterations') {
    opts.iterations = Number($('iterations').value);
  } else {
    opts.targetError = Number($('precision').value);
  }
  document.querySelectorAll('#buffs input').forEach((cb) => {
    opts.buffs[cb.dataset.buff] = cb.checked;
  });
  document.querySelectorAll('#consumables input').forEach((cb) => {
    opts.consumables[cb.dataset.consumable] = cb.checked;
  });
  return opts;
}

function restoreOptions(opts) {
  if (opts.fightStyle) $('fight-style').value = opts.fightStyle;
  if (opts.numEnemies) $('num-enemies').value = opts.numEnemies;
  if (opts.fightLength) $('fight-length').value = opts.fightLength;
  if (opts.iterations) {
    $('precision').value = 'iterations';
    $('iterations').value = opts.iterations;
    $('iterations-label').classList.remove('hidden');
  } else if (opts.targetError) {
    $('precision').value = String(opts.targetError);
  }
  for (const [k, v] of Object.entries(opts.buffs ?? {})) {
    const cb = document.querySelector(`#buffs input[data-buff="${k}"]`);
    if (cb) cb.checked = v;
  }
  for (const [k, v] of Object.entries(opts.consumables ?? {})) {
    const cb = document.querySelector(`#consumables input[data-consumable="${k}"]`);
    if (cb) cb.checked = v;
  }
}

// ---------- sim lifecycle ----------
async function startSim() {
  const profile = $('profile').value;
  const options = collectOptions();
  localStorage.setItem('localbots', JSON.stringify({ profile, options }));

  hideError();

  const payload = { profile, options, patch, lang };
  if (mode === 'topgear') {
    payload.mode = 'topgear';
    payload.items = [...document.querySelectorAll('#gear-list input[type="checkbox"]')]
      .filter((cb) => cb.checked)
      .map((cb) => gearItems[Number(cb.dataset.gearIndex)])
      .filter(Boolean);
    payload.compare = {
      consumables: $('compare-consumables')?.checked ? { selection: selectedOptions('consumables') } : false,
      enchants: $('compare-enchants')?.checked ? { selection: selectedOptions('enchants') } : false,
      gems: $('compare-gems')?.checked ? { selection: selectedOptions('gems') } : false,
      folio: !!$('compare-folio')?.checked,
      // always send an explicit list — a missing array means "all" server-side
      talents: $('compare-talents')?.checked
        ? { selection: { loadouts: selectedOptions('talents').loadouts ?? [] } } : false,
    };
    if (payload.compare.talents) payload.customLoadouts = customLoadouts;
    payload.setMinimums = Object.fromEntries(
      Object.entries(setMinimums).filter(([, v]) => v > 0));
    if ($('track-upgrades-toggle').checked) {
      const slots = [...document.querySelectorAll('#tu-list input:checked')].map((cb) => cb.dataset.tuslot);
      if (slots.length) {
        payload.trackUpgrades = {
          slots,
          step: Number($('tu-step').value),
          voidcores: $('tu-voidcore').checked && !$('tu-voidcore').disabled,
        };
      }
    }
    if (!payload.items.length && !Object.values(payload.compare).some(Boolean) && !payload.trackUpgrades) {
      showError('Tick at least one item to compare (or enable a comparison group below).');
      return;
    }
  } else if (mode === 'droptimizer') {
    payload.mode = 'droptimizer';
    payload.selection = collectDroptSelection();
    // Purely informational metadata for Best Setup / Your Top Gear's Sparks
    // warning -- not consumed by the sim itself, so it's sent alongside
    // rather than inside `selection`. Persisted to history so the warning
    // still works after a reload (see server/history.js).
    payload.craftedSparksBudget = Number($('dropt-crafted-sparks')?.value) || null;
    // Auto-detected server-side (see ownedCraftedItemIds) -- echoed back so
    // it's persisted to history the same way as craftedSparksBudget.
    payload.craftedOwnedIds = [...document.querySelectorAll('[data-group="crafted"] input[data-exclitem][data-owned="1"]')]
      .map((cb) => Number(cb.dataset.exclitem));
    if (payload.selection.crafted && !payload.selection.crafted.statPairs.length) {
      showError('Crafted gear is ticked but no stat combo is selected — tick at least one stat pair.');
      return;
    }
  } else if (mode === 'statweights') {
    payload.mode = 'statweights';
  }

  $('sim-button').disabled = true;
  setReportId(null); // the previous result is no longer what is on screen

  let resp;
  try {
    resp = await fetch('/api/sim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    showError('Could not reach the Localbots server. Is it still running?');
    $('sim-button').disabled = false;
    return;
  }
  const body = await resp.json();
  if (!resp.ok) {
    showError(body.error ?? 'The server rejected the request.');
    $('sim-button').disabled = false;
    return;
  }

  currentJobId = body.jobId;
  // items that could not be simmed as asked, rather than dropping them quietly
  skippedNote = body.skippedByHands
    ? `${body.skippedByHands} off-hand item${body.skippedByHands === 1 ? '' : 's'} skipped — a two-hander fills both hands.`
    : '';
  $('cancel-button').classList.remove('hidden');
  showView('results');
  $('history-banner').classList.add('hidden');
  $('empty-state').classList.add('hidden');
  $('results-area').classList.add('hidden');
  $('topgear-area').classList.add('hidden');
  $('progress-area').classList.remove('hidden');
  showQueue(null);
  setProgress('Starting…', 0, '');

  eventSource = new EventSource(`/api/sim/${currentJobId}/events`);
  eventSource.onmessage = (ev) => handleUpdate(JSON.parse(ev.data));
  eventSource.onerror = () => {
    // stream closes normally at job end; only report if we never finished
    if (currentJobId) {
      showError('Lost connection to the sim progress stream.');
      resetControls();
    }
  };
}

function handleUpdate(u) {
  if (u.status === 'queued') {
    renderQueued(u);
  } else if (u.status === 'running') {
    showQueue(null);
    const p = u.progress;
    if (p) {
      const phase = p.item
        ? `Item ${p.phaseNum - 1}/${p.phaseTotal - 1}: ${p.item.replace(/ @[a-z_0-9]+$/, '').replace(/ \[[a-z]?\d+\]$/, '')}`
        : p.phaseTotal > 1 ? `${p.phase} ${p.phaseNum}/${p.phaseTotal}` : p.phase;
      const detail = [
        `${p.iterDone.toLocaleString()} / ${p.iterTotal.toLocaleString()} iterations`,
        p.meanDps ? `~${Math.round(p.meanDps).toLocaleString()} DPS` : null,
        p.eta ? `ETA ${p.eta}` : null,
      ].filter(Boolean).join(' · ');
      setProgress(phase, p.percent, detail);
    } else {
      setProgress('Initializing simc…', 2, '');
    }
  } else if (u.status === 'done') {
    showQueue(null);
    const finishedId = currentJobId; // finishStream clears it
    finishStream();
    $('history-banner').classList.add('hidden');
    craftedSparksBudget = Number($('dropt-crafted-sparks')?.value) || null;
    craftedOwnedIds = new Set([...document.querySelectorAll('[data-group="crafted"] input[data-exclitem][data-owned="1"]')]
      .map((cb) => Number(cb.dataset.exclitem)));
    if (u.result?.topgear) renderTopGear(u.result);
    else renderResult(u.result);
    setReportId(finishedId);
  } else if (u.status === 'failed') {
    showQueue(null);
    finishStream();
    showError(`Sim failed:\n${u.error ?? 'unknown error'}`);
    $('progress-area').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
  } else if (u.status === 'cancelled') {
    showQueue(null);
    finishStream();
    $('progress-area').classList.add('hidden');
    $('empty-state').classList.remove('hidden');
  }
}

function finishStream() {
  currentJobId = null;
  eventSource?.close();
  eventSource = null;
  resetControls();
}

function resetControls() {
  $('sim-button').disabled = false;
  $('cancel-button').classList.add('hidden');
}

async function cancelSim() {
  if (!currentJobId) return;
  await fetch(`/api/sim/${currentJobId}/cancel`, { method: 'POST' });
}

// ---------- rendering ----------
// Waiting behind other people's sims. There is no progress to show, so this
// says where you are in the line, what is running in front of you, and how far
// along that one is — enough to know whether to wait or come back later.
function renderQueued(u) {
  const q = u.queue ?? { position: u.queuePosition ?? 1, ahead: u.queuePosition ?? 1, running: null };
  const ahead = q.ahead ?? 0;
  setProgress(
    ahead === 1 ? 'Waiting — you are next' : `Waiting — ${ahead} sims ahead of you`,
    0,
    'Sims run one at a time on this server. Yours starts on its own; you can leave this tab open.');
  $('progress-bar').classList.add('waiting');
  showQueue(q);
}

function showQueue(q) {
  const area = $('queue-area');
  if (!q) {
    area.classList.add('hidden');
    $('progress-bar').classList.remove('waiting');
    return;
  }
  area.classList.remove('hidden');
  // one pip for the sim running now, then one per waiting sim up to yours
  const pips = [];
  if (q.running) {
    pips.push(`<span class="queue-pip now" title="${esc(q.running.label ?? 'running')}">running${
      q.running.percent != null ? ` ${Math.round(q.running.percent)}%` : ''}</span>`);
  }
  for (let i = 1; i <= (q.position ?? 1); i++) {
    const mine = i === q.position;
    pips.push(`<span class="queue-pip${mine ? ' mine' : ''}">${mine ? 'you' : i}</span>`);
  }
  $('queue-pips').innerHTML = pips.join('');
  $('queue-ahead').textContent = [
    q.running ? `Running now: ${q.running.label}${q.running.eta ? ` · ETA ${q.running.eta}` : ''}` : null,
    q.waiting > 1 ? `${q.waiting} sims waiting` : null,
  ].filter(Boolean).join(' · ');
}

function setProgress(phase, percent, detail) {
  $('progress-phase').textContent = phase;
  $('progress-bar').style.width = `${percent}%`;
  $('progress-detail').textContent = detail;
}

function renderResult(r) {
  $('progress-area').classList.add('hidden');
  $('results-area').classList.remove('hidden');

  $('dps-value').textContent = Math.round(r.dps).toLocaleString();
  const es = lang === 'es';
  const meta = [
    r.player.name,
    r.player.spec,
    es ? `±${Math.round(r.dpsError).toLocaleString()} DPS de error` : `±${Math.round(r.dpsError).toLocaleString()} DPS error`,
    es ? `${r.targets} objetivo${r.targets > 1 ? 's' : ''}` : `${r.targets} target${r.targets > 1 ? 's' : ''}`,
    es ? `combate de ${Math.round(r.fightLength)}s` : `${Math.round(r.fightLength)}s fight`,
    r.iterations ? (es ? `${r.iterations.toLocaleString()} iteraciones` : `${r.iterations.toLocaleString()} iterations`) : null,
    r.elapsedSeconds ? (es ? `simulado en ${r.elapsedSeconds.toFixed(1)}s` : `simmed in ${r.elapsedSeconds.toFixed(1)}s`) : null,
  ].filter(Boolean).join(' · ');
  $('dps-meta').textContent = meta;

  const maxShare = Math.max(...r.abilities.map((a) => a.share), 0.0001);
  const abilityRows = r.abilities.slice(0, 25).map((a) => `
    <tr>
      <td>${esc(a.name)}${a.source !== r.player.name ? `<span class="pet-tag">${esc(a.source)}</span>` : ''}</td>
      <td class="num">${Math.round(a.dps).toLocaleString()}</td>
      <td class="num">${a.executes.toFixed(1)}</td>
      <td>${shareBar(a.share * 100, (a.share / maxShare) * 100)}</td>
    </tr>`).join('');
  document.querySelector('#abilities-table tbody').innerHTML =
    abilityRows || '<tr><td colspan="4">No damage abilities recorded.</td></tr>';

  const buffRows = r.buffs.slice(0, 20).map((b) => `
    <tr>
      <td>${esc(b.name)}</td>
      <td>${shareBar(b.uptime, Math.min(100, b.uptime))}</td>
    </tr>`).join('');
  document.querySelector('#buffs-table tbody').innerHTML =
    buffRows || '<tr><td colspan="2">No notable buffs.</td></tr>';

  $('statweights-block').classList.toggle('hidden', !r.statWeights?.length);
  if (r.statWeights?.length) {
    const maxWeight = Math.max(...r.statWeights.map((s) => s.value), 0.0001);
    document.querySelector('#statweights-table tbody').innerHTML = r.statWeights.map((s) => `
      <tr>
        <td>${esc(s.label)}</td>
        <td class="num">${s.value.toFixed(2)}</td>
        <td>${shareBar(s.normalized * 100, (s.value / maxWeight) * 100)}</td>
      </tr>`).join('');
  }
}

let tgRows = [];
// Sparks budget entered before this run, kept independent of the setup
// form's own input -- it must survive a reload from history, where that
// form was never (re)built. Set at sim-completion time and restored from a
// saved report's persisted options; read by both aggregate results views.
let craftedSparksBudget = null;
// Crafted item ids the player already made this season -- a recraft (same
// item, different stats) costs no Spark, unlike a brand-new one. Same
// survive-a-history-reload treatment as craftedSparksBudget above.
let craftedOwnedIds = new Set();
let skippedNote = ''; // items the sim could not take as asked (an off-hand next to a two-hander)
let tgActiveChip = null;
let tgShowFilters = false; // Details' search/chips are worth showing (many sections/rows)
let tgActiveSlot = null;
let tgEquipped = null; // slot -> { name, ilvl } of the character's own gear

// real gear slots (comparison rows for consumables/talents/etc. use pseudo
// placements like "Flask" or "loadout" and keep the classic row format)
const REAL_SLOTS = new Set([
  'head', 'neck', 'shoulder', 'back', 'chest', 'wrist', 'hands', 'waist',
  'legs', 'feet', 'finger1', 'finger2', 'trinket1', 'trinket2',
  'main_hand', 'off_hand',
]);

function renderTopGear(r) {
  $('progress-area').classList.add('hidden');
  $('topgear-area').classList.remove('hidden');

  $('tg-baseline').textContent = Math.round(r.dps).toLocaleString();
  const tgEs = lang === 'es';
  $('tg-meta').textContent = [
    r.player.name,
    r.player.spec,
    tgEs ? `${r.topgear.length} objeto${r.topgear.length === 1 ? '' : 's'} comparado${r.topgear.length === 1 ? '' : 's'}`
      : `${r.topgear.length} item${r.topgear.length === 1 ? '' : 's'} compared`,
    r.elapsedSeconds ? (tgEs ? `simulado en ${r.elapsedSeconds.toFixed(1)}s` : `simmed in ${r.elapsedSeconds.toFixed(1)}s`) : null,
    skippedNote || null,
  ].filter(Boolean).join(' · ');

  tgRows = r.topgear;
  tgEquipped = r.equipped ?? null; // older saved sims predate this field
  tgActiveChip = null;
  tgActiveSlot = null;
  $('tg-search').value = '';
  // a fresh result always opens on "Your Top Gear" (paperdoll + Details table)
  document.querySelectorAll('.result-tab').forEach((t) => t.classList.toggle('active', t.dataset.restab === 'gear'));
  $('best-setup').classList.add('hidden');
  $('topgear-table').classList.remove('hidden');
  $('tg-gear').classList.remove('hidden');
  renderTopGearGrid();
  // the enchant subline is now always visible (not just on hover), so warm
  // its cache up front instead of showing "enchant #NNNN" until first hover
  warmEnchantNames(tgEquipped);
  // gems link Wowhead's widget straight off their real item id (no warm-up
  // fetch needed, unlike enchants) -- just make sure the widget script is
  // loaded and has scanned the page's freshly-rendered [data-wowhead] links
  loadWowheadWidget().then(refreshWowheadLinks);

  // filter chips (droptimizer runs have many sections; top gear has few)
  const sections = [...new Set(tgRows.map((t) => t.section))];
  tgShowFilters = sections.length > 2 || tgRows.length > 30;
  $('tg-filters').classList.toggle('hidden', !tgShowFilters);
  if (tgShowFilters) {
    $('tg-chips').innerHTML = ['All', ...sections].map((s, i) =>
      `<button class="chip ${i === 0 ? 'active' : ''}" data-chip="${i === 0 ? '' : esc(s)}">${esc(i === 0 ? tr('filter.all') : translateChipLabel(s))}</button>`).join('');
    document.querySelectorAll('#tg-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        tgActiveChip = chip.dataset.chip || null;
        document.querySelectorAll('#tg-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderTopGearRows();
      });
    });
    // second chip row: filter by gear slot, independent of the source chips
    const slots = [...new Set(tgRows.map((t) => slotFamily(t.placement)).filter(Boolean))];
    $('tg-slot-chips').innerHTML = slots.length > 1
      ? ['All slots', ...slots].map((s, i) =>
        `<button class="chip ${i === 0 ? 'active' : ''}" data-slotchip="${i === 0 ? '' : esc(s)}">${esc(i === 0 ? tr('filter.allSlots') : s)}</button>`).join('')
      : '';
    document.querySelectorAll('#tg-slot-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        tgActiveSlot = chip.dataset.slotchip || null;
        document.querySelectorAll('#tg-slot-chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
        renderTopGearRows();
      });
    });
  } else {
    $('tg-slot-chips').innerHTML = '';
  }
  renderTopGearRows();
}

// group paired slots into one chip: rings, trinkets, weapons
function slotFamily(placement) {
  if (!placement) return null;
  if (/^finger/.test(placement)) return tr('filter.rings');
  if (/^trinket/.test(placement)) return tr('filter.trinkets');
  if (placement === 'main_hand' || placement === 'off_hand') return titleCase(tr('slot.weapons'));
  return titleCase(prettySlot(placement));
}

// Known, fixed category names get a translated chip label; anything else
// (a raid/dungeon boss name, an item name used as a droptimizer section) has
// no translation data available and is shown as-is.
const CHIP_LABEL_KEYS = {
  Consumables: 'filter.consumables', Enchants: 'filter.enchants', Gems: 'filter.gems',
  'Omnium Folio': 'filter.omniumFolio', 'Talent loadouts': 'filter.talentLoadouts',
  Bags: 'filter.bags', Equipped: 'filter.equipped', Catalyzed: 'filter.catalyzed', Search: 'filter.search',
  Upgrades: 'filter.upgrades', Loadout: 'filter.loadout', Rings: 'filter.rings', Trinkets: 'filter.trinkets', Weapon: 'filter.weapon',
};
function translateChipLabel(s) {
  if (CHIP_LABEL_KEYS[s]) return tr(CHIP_LABEL_KEYS[s]);
  const row = String(s).match(/^Row (\d+)$/); // Omnium Folio's per-row sub-label (see enhancements.js)
  if (row) return `${tr('filter.row')} ${row[1]}`;
  return s;
}

$('tg-search').addEventListener('input', renderTopGearRows);

function renderTopGearRows() {
  const q = $('tg-search').value.toLowerCase();
  const visible = tgRows.filter((t) =>
    (!tgActiveChip || t.section === tgActiveChip) &&
    (!tgActiveSlot || slotFamily(t.placement) === tgActiveSlot) &&
    (!q || `${t.itemName} ${t.section} ${t.boss ?? ''}`.toLowerCase().includes(q)));

  // When viewing a single section (via chip or a single-section run), group
  // rows by sub-slot (Weapons, Rings, Flask, Row 1, ...) so different slots
  // don't interleave in the ranking.
  const sections = new Set(visible.map((t) => t.section));
  const bosses = new Set(visible.map((t) => t.boss));
  const grouped = sections.size === 1 && bosses.size > 1 && !bosses.has(undefined);
  if (grouped) {
    const byBoss = new Map();
    for (const t of visible) {
      if (!byBoss.has(t.boss)) byBoss.set(t.boss, []);
      byBoss.get(t.boss).push(t);
    }
    const groups = [...byBoss.entries()]
      .sort((a, b) => Math.max(...b[1].map((t) => t.delta)) - Math.max(...a[1].map((t) => t.delta)));
    const maxAbs = Math.max(...visible.map((t) => Math.abs(t.delta)), 1);
    document.querySelector('#topgear-table tbody').innerHTML = groups.map(([boss, rows]) =>
      `<tr class="slot-group-row"><td colspan="6">${esc(boss ?? '')}</td></tr>` +
      rows.map((t) => rowHtml(t, maxAbs)).join('')).join('') || '<tr><td colspan="6">No results match the filter.</td></tr>';
    paintItemIcons(document.querySelector('#topgear-table'));
    refreshWowheadLinks();
    return;
  }

  const maxAbs = Math.max(...visible.map((t) => Math.abs(t.delta)), 1);
  document.querySelector('#topgear-table tbody').innerHTML =
    visible.map((t) => rowHtml(t, maxAbs)).join('') || '<tr><td colspan="6">No results match the filter.</td></tr>';
  paintItemIcons(document.querySelector('#topgear-table'));
  refreshWowheadLinks(); // gem sublines just rendered fresh [data-wowhead] links
}

// the crafter's two chosen secondaries, read straight out of the exact simmed
// line (see profileBuilder.js's `line`) rather than needing every result row
// to carry its own parsed copy -- only ever present on the single-item path,
// same as `line` itself.
function craftedStatsFromLine(line) {
  const m = String(line ?? '').match(/(?:^|,)crafted_stats=(\d+)\/(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

// The item's real bonus ids (upgrade track, embellishment, crafting quality
// roll, ...), read straight out of the exact simmed/equipped line the same
// way craftedStatsFromLine does -- passed to itemTile/tileDataAttrs so
// Wowhead's widget links to the item's actual roll instead of defaulting to
// some other one, which is especially visible on crafted gear (a bare item
// id shows a random secondary-stat allocation, not the one you actually
// crafted).
function bonusIdsFromLine(line) {
  const m = String(line ?? '').match(/(?:^|,)bonus_id=([\d/]+)/);
  return m ? m[1].split('/').map(Number) : [];
}

function rowHtml(t, maxAbs) {
  const cls = t.delta > t.error ? 'delta-pos' : t.delta < -t.error ? 'delta-neg' : 'delta-zero';
  const sign = t.delta > 0 ? '+' : '';
  const fill = (Math.abs(t.delta) / maxAbs) * 100;
  // rarity-style glow for big upgrades: 1% rare blue, 2% epic purple, 3%+ legendary orange
  const glow = t.deltaPct >= 3 ? 'glow-legendary' : t.deltaPct >= 2 ? 'glow-epic' : t.deltaPct >= 1 ? 'glow-rare' : '';
  const eq = REAL_SLOTS.has(t.placement) ? tgEquipped?.[t.placement] : null;
  // sims saved before itemId was stored on Top Gear rows have none — for a
  // row that just re-sims what you're already wearing, the equipped record
  // (which always carried its item id) names the same item and can stand in
  const itemId = t.itemId ?? (t.section === 'Equipped' && eq?.name === t.itemName ? eq.id : null);
  // "(your ilvl -> suggested ilvl) -> the item it replaces (slot)"
  const ilvls = eq?.ilvl && t.ilvl
    ? ` <span class="ilvl${t.origIlvl && t.origIlvl !== t.ilvl ? ' upgraded' : ''}"
        title="${t.origIlvl && t.origIlvl !== t.ilvl ? `drops at ${t.origIlvl}, simmed upgraded to ${t.ilvl}` : `simmed at ${t.ilvl}`}">(${eq.ilvl} → ${t.ilvl})</span>`
    : ilvlBadge(t);
  const target = eq?.name
    ? `${esc(eq.name)} (${esc(prettySlot(t.placement))})`
    : esc(prettySlot(t.placement));
  // rows that change several things (gem sockets, enchant combos) expand
  // into a per-slot "current -> suggested" list
  const expandable = Array.isArray(t.changes) && t.changes.length > 0;
  const detailId = expandable ? ++tgDetailSeq : 0;
  const caret = expandable
    ? ` <button class="expander" data-exp="${detailId}" title="Show exactly what changes">▸ ${t.changes.length} change${t.changes.length === 1 ? '' : 's'}</button>`
    : '';
  const detailRow = expandable
    ? `<tr class="detail-row hidden" data-detail="${detailId}"><td colspan="6"><ul class="change-list">
        ${t.changes.map((c) => `<li>${esc(c.item ?? prettySlot(c.slot))} <span class="hint-inline">(${esc(prettySlot(c.slot))})</span>:
          ${esc(c.from)} → <strong>${esc(c.to)}</strong></li>`).join('')}
      </ul></td></tr>`
    : '';
  const info = {
    name: t.itemName, ilvl: t.ilvl, slot: prettySlot(t.placement),
    source: [translateChipLabel(t.section), translateChipLabel(t.boss)].filter(Boolean).join(' → '),
    enchantId: eq?.enchantId, gemIds: eq?.gemIds,
    craftedStats: craftedStatsFromLine(t.line),
    bonusIds: bonusIdsFromLine(t.line),
    ...(trackStepFor(t.track, t.ilvl) ?? {}),
  };
  return `
  <tr>
    <td><span class="gear-icon-row" ${itemId ? tileDataAttrs(itemId, info) : ''}>${itemId ? itemTileWithBadge(itemId, info, t) : ''}<span><span class="${glow ? `item-glow ${glow}` : ''}">${esc(t.itemName ?? '?')}</span>${ilvls}${trackSchemeFor(t.track)}
        ${t.catalysed ? `<span class="tier-tag" title="Catalyzed${t.catalystFromName ? ` from ${esc(t.catalystFromName)}` : ''} — shown as the real tier piece it becomes">catalyzed</span>` : ''}
        ${t.offHandLost ? '<span class="tier-tag warn" title="A two-hander fills both hands, so this was simmed with your off-hand taken off — its stats are not counted">off-hand removed</span>' : ''}
        ${t.borrowedMainHand ? `<span class="tier-tag warn" title="You currently have no free main hand for this off-hand item, so it was simmed alongside ${esc(t.borrowedMainHand)} from your bags instead of your actual weapon">borrowed ${esc(t.borrowedMainHand)}</span>` : ''}
        ${sparksBadge(t)}
        <span class="slot-tag">→ ${target}</span>${caret}
        ${itemId ? enchGemSubline(eq?.enchantId, eq?.gemIds) : ''}</span></span></td>
    <td><span class="source-tag">${esc(translateChipLabel(t.section))}</span>${t.boss ? `<span class="src-boss">→ ${esc(translateChipLabel(t.boss))}</span>` : ''}</td>
    <td class="num" title="Mean ${Math.round(t.dps).toLocaleString()} DPS ± ${Math.round(t.error).toLocaleString()} (margin of error)">${Math.round(t.dps).toLocaleString()}</td>
    <td class="num ${cls}" title="${sign}${Math.round(t.delta).toLocaleString()} DPS ± ${Math.round(t.error).toLocaleString()} margin of error vs equipped">${sign}${Math.round(t.delta).toLocaleString()}</td>
    <td><div class="share-bar">
      <div class="track"><div class="fill" style="width:${fill.toFixed(1)}%; background:${t.delta >= 0 ? 'var(--green)' : 'var(--red)'}"></div></div>
      <span class="pct ${cls}">${sign}${t.deltaPct.toFixed(2)}%</span>
    </div></td>
    <td class="row-menu-cell">${rowMenuHtml(t)}</td>
  </tr>${detailRow}`;
}

// Raidbots-style per-row "..." menu: pivots this one candidate into another
// tool instead of leaving the results table a dead end. "Run in Quick Sim"
// needs the exact line this candidate was simmed with (see profileBuilder.js's
// `line`, added specifically for this) -- reconstructing an approximation
// from itemId/ilvl alone would silently drop bonus_ids, crafted stats, gems,
// so the action just doesn't offer itself on rows that predate that field
// (older saved history entries) or the synthetic weapon-pair rows.
function rowMenuHtml(t) {
  const idx = tgRows.indexOf(t);
  return `<div class="row-menu">
    <button type="button" class="row-menu-toggle" data-row-idx="${idx}" title="More actions">⋯</button>
    <div class="row-menu-panel hidden" data-row-panel="${idx}">
      ${t.line ? `<button type="button" data-row-action="quicksim" data-row-idx="${idx}">Run in Quick Sim</button>` : ''}
      <button type="button" data-row-action="copy" data-row-idx="${idx}">Copy to clipboard</button>
    </div>
  </div>`;
}

// swap `placement`'s equipped line in the pasted profile for `line` verbatim
// -- same shape the addon itself writes (see gearParser.js), so a slot that
// was empty just gets a new line appended rather than matched-and-replaced.
function swapProfileLine(profileText, placement, line) {
  const re = new RegExp(`^${placement}=.*$`, 'm');
  return re.test(profileText) ? profileText.replace(re, line) : `${profileText}\n${line}`;
}

document.querySelector('#topgear-table tbody')?.addEventListener('click', (e) => {
  const toggle = e.target.closest('.row-menu-toggle');
  if (toggle) {
    const panel = document.querySelector(`[data-row-panel="${toggle.dataset.rowIdx}"]`);
    const wasHidden = panel.classList.contains('hidden');
    document.querySelectorAll('.row-menu-panel').forEach((p) => p.classList.add('hidden'));
    panel.classList.toggle('hidden', !wasHidden);
    return;
  }
  const action = e.target.closest('[data-row-action]');
  if (!action) { document.querySelectorAll('.row-menu-panel').forEach((p) => p.classList.add('hidden')); return; }
  const t = tgRows[Number(action.dataset.rowIdx)];
  if (!t) return;
  document.querySelectorAll('.row-menu-panel').forEach((p) => p.classList.add('hidden'));
  if (action.dataset.rowAction === 'copy') {
    const sign = t.delta > 0 ? '+' : '';
    const text = `${t.itemName ?? '?'} — ${sign}${Math.round(t.delta).toLocaleString()} DPS (${sign}${t.deltaPct.toFixed(2)}%)`;
    navigator.clipboard?.writeText(text).catch(() => {});
  } else if (action.dataset.rowAction === 'quicksim' && t.line && t.placement) {
    $('profile').value = swapProfileLine($('profile').value, t.placement, t.line);
    document.querySelector('.tab[data-mode="quick"]').click();
    showView('setup');
  }
});
document.addEventListener('click', (e) => {
  if (e.target.closest('.row-menu')) return;
  document.querySelectorAll('.row-menu-panel').forEach((p) => p.classList.add('hidden'));
});

let tgDetailSeq = 0;

// ---------- "Best setup": the winner of every independent choice ----------
// Each row was measured on its own against the current character, so the
// picks combine well but their gains are an estimate, not a promise.
function bucketFor(t) {
  const k = t.sourceKind;
  if (k === 'talents') return { key: 'talents', label: tr('bucket.talentBuild'), order: 1 };
  if (k === 'enchants') return { key: `e:${t.boss}`, label: `${tr('bucket.enchant')} — ${translateChipLabel(t.boss)}`, order: 2 };
  if (k === 'gems') return { key: `g:${t.boss}`, label: translateChipLabel(t.boss), order: 3 };
  if (k === 'consumables') return { key: `c:${t.boss}`, label: translateChipLabel(t.boss), order: 4 };
  if (k === 'folio') return { key: `f:${t.boss}`, label: `${tr('filter.omniumFolio')} · ${translateChipLabel(t.boss)}`, order: 5 };
  if (k === 'upgrades') return null; // upgrading is not an either/or choice
  return { key: `s:${t.placement}`, label: prettySlot(t.placement), order: 6 };
}

// ---------- "Your Top Gear": the paperdoll, mirrors the downloaded report ----------
// slot -> the best row for it, same rule Best Setup and the downloaded
// report use: it must beat what's equipped there and clear its own margin
// of error, or the slot keeps showing what you already have.
function bestGearPicksBySlot() {
  const best = new Map();
  for (const t of tgRows) {
    if (NON_SLOT_KINDS.has(t.sourceKind) || !t.placement) continue;
    const cur = best.get(t.placement);
    if (!cur || t.delta > cur.delta) best.set(t.placement, t);
  }
  for (const [slot, t] of [...best]) {
    if (/\(current\)/.test(t.itemName ?? '') || !(t.delta > t.error)) best.delete(slot);
  }
  const { kept, dropped } = affordableCraftedRows([...best.values()]);
  for (const [slot, t] of [...best]) if (!kept.has(t)) best.delete(slot);
  best.sparksDropped = dropped; // stashed for the caller's note -- Maps ignore extra props otherwise
  return best;
}
const NON_SLOT_KINDS = new Set(['enchants', 'gems', 'upgrades', 'folio', 'consumables', 'talents']);

// Both aggregate views (Best Setup, Your Top Gear) independently pick the
// single best row per slot, with no regard for whether several of those
// picks are crafted items competing for the same limited Sparks. A normal
// piece costs 2 Sparks of Tides, a two-hander 4 (server-computed sparkCost
// -- see droptimizer.js's addCrafted/addItem). Rather than just warn, this
// solves the 0/1 knapsack (cost = sparkCost, value = delta) over the
// crafted picks to find which subset is actually affordable together and
// worth the most DPS -- a slot whose crafted pick didn't make the cut
// simply isn't included, so that slot falls back to whatever it already
// shows (current gear). Non-crafted picks are free and always kept.
// Two slots landing on the very same crafted item id correctly costs
// double: wearing two copies means crafting it twice.
// Best-effort only: the budget is unknown for a report reloaded from
// history that predates this field (then every pick is kept, unfiltered).
function affordableCraftedRows(rows) {
  const budget = Number.isFinite(craftedSparksBudget) ? Math.floor(craftedSparksBudget) : null;
  if (budget == null || budget <= 0) return { kept: new Set(rows), dropped: [] };
  // Already-crafted items are a free recraft -- they never compete for the
  // budget, so they're treated the same as non-crafted (always-kept) picks.
  const free = rows.filter((t) => t.sourceKind !== 'crafted' || craftedOwnedIds.has(t.itemId));
  const crafted = rows.filter((t) => t.sourceKind === 'crafted' && !craftedOwnedIds.has(t.itemId));
  if (!crafted.length) return { kept: new Set(rows), dropped: [] };
  const dp = new Array(budget + 1).fill(0);
  const choice = new Array(budget + 1).fill(null).map(() => new Set());
  crafted.forEach((t, i) => {
    const cost = Math.min(budget, Math.max(1, Math.round(t.sparkCost ?? 2)));
    for (let c = budget; c >= cost; c--) {
      const candidate = dp[c - cost] + t.delta;
      if (candidate > dp[c]) {
        dp[c] = candidate;
        choice[c] = new Set(choice[c - cost]);
        choice[c].add(i);
      }
    }
  });
  let bestC = 0;
  for (let c = 1; c <= budget; c++) if (dp[c] > dp[bestC]) bestC = c;
  const keptCrafted = [...choice[bestC]].map((i) => crafted[i]);
  const dropped = crafted.filter((t) => !keptCrafted.includes(t));
  return { kept: new Set([...free, ...keptCrafted]), dropped };
}

// Tags a crafted pick as either a brand-new craft (costs Sparks) or a free
// recraft of something already made this season -- so Best Setup / Your Top
// Gear tell you which of the two to actually go do, not just that it's
// "crafted". Only shown once craftedSparksBudget/craftedOwnedIds exist
// (i.e. this run tracked them at all).
function sparksBadge(t) {
  if (t.sourceKind !== 'crafted') return '';
  if (craftedOwnedIds.has(t.itemId)) {
    return `<span class="tier-tag" title="${lang === 'es' ? 'Ya lo has crafteado esta temporada — solo hace falta un recraft, sin gastar chispas' : "You've already crafted this this season — just needs a recraft, no Sparks spent"}">${lang === 'es' ? '♻️ recraft' : '♻️ recraft'}</span>`;
  }
  if (!Number.isFinite(craftedSparksBudget)) return '';
  const cost = t.sparkCost ?? 2;
  return `<span class="tier-tag" title="${lang === 'es' ? 'Crafteo nuevo' : 'New craft'}">🔨 ${cost} ${lang === 'es' ? 'chispas' : cost === 1 ? 'Spark' : 'Sparks'}</span>`;
}

function sparksNoteHtml(dropped) {
  if (!dropped.length) return '';
  const names = dropped.map((t) => esc(t.itemName ?? '?')).join(', ');
  return `<p class="hint bs-sparks-warning">✨ Limited to ${craftedSparksBudget} Spark${craftedSparksBudget === 1 ? '' : 's'}: the best affordable crafted combo is shown below. Not included (would need more Sparks than you have): ${names}. (Recrafting an item you already made this season for different stats doesn't cost another Spark.)</p>`;
}

function renderTopGearGrid() {
  const el = $('tg-gear');
  if (!tgEquipped) {
    el.innerHTML = '<p class="hint">This sim predates equipped-gear tracking — re-run it to see this tab.</p>';
    return;
  }
  const picks = bestGearPicksBySlot();
  const slots = SLOT_ORDER.filter((s) => tgEquipped[s]);
  if (!slots.length) { el.innerHTML = '<p class="hint">No equipped-gear data for this sim.</p>'; return; }
  const cellFor = (slot) => {
    const eq = tgEquipped[slot];
    const pick = picks.get(slot);
    const itemId = pick ? pick.itemId : eq?.id;
    const name = pick ? pick.itemName : eq?.name;
    const ilvl = pick ? pick.ilvl : eq?.ilvl;
    const info = {
      name, ilvl, slot: prettySlot(slot), enchantId: eq?.enchantId, gemIds: eq?.gemIds,
      craftedStats: pick ? craftedStatsFromLine(pick.line) : null,
      bonusIds: bonusIdsFromLine(pick ? pick.line : eq?.line),
      ...(pick ? (trackStepFor(pick.track, pick.ilvl) ?? {}) : {}),
    };
    const detail = pick
      ? `<span class="hint-inline block">was ${esc(eq?.name ?? 'nothing')} <span class="delta-pos">+${Math.round(pick.delta).toLocaleString()} DPS</span></span>`
      : '';
    return `<div class="pd-row${pick ? ' pd-changed' : ''}">
      <div class="pd-slot hint-inline">${esc(prettySlot(slot))}</div>
      <span class="gear-icon-row" ${tileDataAttrs(itemId, info)}>${itemTileWithBadge(itemId, info, pick)}<span>${esc(name ?? '?')}${ilvl ? ` <span class="hint-inline">(${ilvl})</span>` : ''}
        ${pick ? sparksBadge(pick) : ''}
        ${enchGemSubline(eq?.enchantId, eq?.gemIds)}${detail}</span></span>
    </div>`;
  };
  const half = Math.ceil(slots.length / 2);
  el.innerHTML = `<p class="hint">${esc(tr('results.highlightedHint'))}</p>
    ${sparksNoteHtml(picks.sparksDropped ?? [])}
    <div class="pd-grid">
      <div class="pd-col">${slots.slice(0, half).map(cellFor).join('')}</div>
      <div class="pd-col">${slots.slice(half).map(cellFor).join('')}</div>
    </div>`;
  paintItemIcons(el);
}

function renderBestSetup() {
  const el = $('best-setup');
  const buckets = new Map();
  for (const t of tgRows) {
    const b = bucketFor(t);
    if (!b) continue;
    const cur = buckets.get(b.key);
    if (!cur || t.delta > cur.row.delta) buckets.set(b.key, { ...b, row: t });
  }
  const picks = [...buckets.values()]
    // a category whose winner is what you already use needs no change
    .filter((b) => !/\(current\)/.test(b.row.itemName ?? ''))
    // and only wins that clear their own error bar are worth acting on
    .filter((b) => b.row.delta > b.row.error)
    .sort((a, b) => a.order - b.order || b.row.delta - a.row.delta);

  const alreadyBest = [...buckets.values()].filter((b) => /\(current\)/.test(b.row.itemName ?? '')).length;
  if (!picks.length) {
    el.innerHTML = `<p class="hint">Nothing in this run clearly beat what you already have${alreadyBest ? ` — you are already on the best option in ${alreadyBest} categor${alreadyBest === 1 ? 'y' : 'ies'}` : ''}. If several rows were close, re-run at a higher precision to separate them.</p>`;
    return;
  }
  const { kept, dropped } = affordableCraftedRows(picks.map((p) => p.row));
  const affordablePicks = picks.filter((p) => kept.has(p.row));
  const total = affordablePicks.reduce((n, p) => n + p.row.delta, 0);
  el.innerHTML = `
    <div class="bs-head">
      <span class="bs-total">+${Math.round(total).toLocaleString()} DPS</span>
      <span class="hint">estimated if you make all ${affordablePicks.length} change${affordablePicks.length === 1 ? '' : 's'}
        (${(total / (tgRows[0]?.dps - tgRows[0]?.delta || 1) * 100).toFixed(1)}%)</span>
    </div>
    ${sparksNoteHtml(dropped)}
    <ul class="bs-list">
      ${affordablePicks.map((p) => {
    const t = p.row;
    const changes = Array.isArray(t.changes) && t.changes.length
      ? `<ul class="change-list">${t.changes.map((c) => `<li>${esc(c.item ?? prettySlot(c.slot))}
            <span class="hint-inline">(${esc(prettySlot(c.slot))})</span>: ${esc(c.from)} → <strong>${esc(c.to)}</strong></li>`).join('')}</ul>`
      : '';
    const eq = REAL_SLOTS.has(t.placement) ? tgEquipped?.[t.placement] : null;
    const swap = eq?.name ? `<span class="hint-inline">replaces ${esc(eq.name)}</span>` : '';
    // sims saved before itemId was stored on Top Gear rows have none — see
    // the same fallback in rowHtml() above
    const itemId = t.itemId ?? (t.section === 'Equipped' && eq?.name === t.itemName ? eq.id : null);
    // a gain under twice its error bar could still be simulation noise
    const shaky = t.delta < t.error * 2
      ? ' <span class="bs-shaky" title="This gain is small next to the run\'s margin of error — re-run at a higher precision to confirm it">close to the margin</span>' : '';
    const bsInfo = {
      name: t.itemName, ilvl: t.ilvl, slot: prettySlot(t.placement),
      source: [translateChipLabel(t.section), translateChipLabel(t.boss)].filter(Boolean).join(' → '),
      enchantId: eq?.enchantId, gemIds: eq?.gemIds,
      craftedStats: craftedStatsFromLine(t.line),
      bonusIds: bonusIdsFromLine(t.line),
      ...(trackStepFor(t.track, t.ilvl) ?? {}),
    };
    return `<li class="bs-item">
        <div class="bs-row">
          <span class="bs-label">${esc(p.label)}</span>
          <span class="bs-pick"><span class="gear-icon-row" ${itemId ? tileDataAttrs(itemId, bsInfo) : ''}>${itemId ? itemTileWithBadge(itemId, bsInfo, t) : ''}<span>${esc(t.itemName ?? '?')}${t.ilvl && eq?.ilvl ? ` <span class="ilvl">(${eq.ilvl} → ${t.ilvl})</span>` : ''}${trackSchemeFor(t.track)}
              ${t.catalysed ? `<span class="tier-tag" title="Catalyzed${t.catalystFromName ? ` from ${esc(t.catalystFromName)}` : ''} — shown as the real tier piece it becomes">catalyzed</span>` : ''}
              ${sparksBadge(t)}
              ${itemId ? enchGemSubline(eq?.enchantId, eq?.gemIds) : ''}</span></span></span>
          <span class="bs-gain delta-pos">+${Math.round(t.delta).toLocaleString()}${shaky}</span>
        </div>
        ${swap}${changes}
      </li>`;
  }).join('')}
    </ul>
    <p class="hint">Each change was simmed on its own against your current character. Stacking them
      usually lands close to the total above, but stat changes shift each other's value — re-run a
      sim after making them to see the real number.</p>`;
  paintItemIcons(el);
}

document.querySelectorAll('.result-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.result-tab').forEach((t) => t.classList.toggle('active', t === tab));
    const best = tab.dataset.restab === 'best';
    // "Your Top Gear" is the paperdoll AND the full Details table together
    $('best-setup').classList.toggle('hidden', !best);
    $('tg-gear').classList.toggle('hidden', best);
    $('topgear-table').classList.toggle('hidden', best);
    $('tg-filters').classList.toggle('hidden', best || !tgShowFilters);
    if (best) renderBestSetup();
    else renderTopGearGrid();
    refreshWowheadLinks();
  });
});

// one delegated listener: toggling a row's change details
document.querySelector('#topgear-table tbody').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.expander');
  if (!btn) return;
  const detail = document.querySelector(`#topgear-table [data-detail="${btn.dataset.exp}"]`);
  if (!detail) return;
  const open = detail.classList.toggle('hidden');
  btn.textContent = btn.textContent.replace(open ? '▾' : '▸', open ? '▸' : '▾');
});

// classic badge: used when the equipped item's ilvl isn't known
// (non-gear rows, hand-written profiles, sims saved before this feature)
function ilvlBadge(t) {
  if (!t.ilvl) return '';
  if (t.origIlvl && t.origIlvl !== t.ilvl) {
    return ` <span class="ilvl upgraded">(${t.origIlvl} → ${t.ilvl})</span>`;
  }
  return ` <span class="ilvl">(${t.ilvl})</span>`;
}

function shareBar(pct, fillPct) {
  return `<div class="share-bar">
    <div class="track"><div class="fill" style="width:${fillPct.toFixed(1)}%"></div></div>
    <span class="pct">${pct.toFixed(1)}%</span>
  </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- save report ----------
// Whichever result is on screen — a run that just finished, or a saved one
// opened from History. Null while nothing is shown, which greys the button.
let reportId = null;

function setReportId(id) {
  reportId = id ?? null;
  const btn = $('report-button');
  if (btn) btn.disabled = !reportId;
}

$('report-button').addEventListener('click', () => {
  if (!reportId) return;
  // the server sends it as an attachment, so this saves rather than navigates
  window.location.href = `/api/history/${encodeURIComponent(reportId)}/report?lang=${encodeURIComponent(lang)}`;
});

// ---------- shutdown ----------
$('shutdown-button').addEventListener('click', async () => {
  if (!confirm('Shut down the Localbots server? Any running sim is cancelled.')) return;
  try {
    await fetch('/api/shutdown', { method: 'POST' });
  } catch { /* server may die before responding — that is the point */ }
  document.body.innerHTML = `<div style="display:grid;place-items:center;height:80vh;color:#8b93a3;
    font:15px -apple-system,'Segoe UI',sans-serif;text-align:center">
    <div style="max-width:520px"><h2 style="color:#f2b135">Server stopped</h2>
    <p>You can close this tab. To start Localbots again, open a terminal in the
    localbots folder and run <code style="color:#f2b135">npm start</code>:</p>
    <p style="text-align:left;background:#171a20;border:1px solid #2a2f3a;border-radius:8px;padding:12px 16px;font-size:13px;line-height:1.8">
    <strong>macOS</strong> — Terminal: <code>cd /path/to/localbots &amp;&amp; npm start</code><br>
    <strong>Windows</strong> — PowerShell: <code>cd C:\\path\\to\\localbots; npm start</code><br>
    <strong>Linux</strong> — any shell: <code>cd /path/to/localbots &amp;&amp; npm start</code></p>
    <p>then reload <code>http://localhost:4747</code>.</p></div></div>`;
});

function showError(msg) {
  $('error-box').textContent = msg;
  $('error-box').classList.remove('hidden');
  // the submit button lives in the header now, away from this box, so make
  // sure a validation error is actually visible instead of silently sitting
  // off-screen below whatever the user last scrolled to
  $('error-box').scrollIntoView({ block: 'nearest' });
}
function hideError() {
  $('error-box').classList.add('hidden');
}

// ---------- character source: SimC Addon / Armory ----------
// The Armory tab fills the same #profile textarea the addon export goes into,
// so everything downstream is unchanged — it is only a different way to get the
// text. See server/armory.js for where the data comes from.

// Set while we write the textarea ourselves, so the 'input' handler below can
// tell a programmatic fill from the user typing over an imported character.
let fillingFromArmory = false;

const ARMORY_PREFS = 'localbots-armory';

function showSource(which) {
  const armory = which === 'armory';
  $('src-tab-addon').classList.toggle('active', !armory);
  $('src-tab-armory').classList.toggle('active', armory);
  $('src-tab-addon').setAttribute('aria-selected', String(!armory));
  $('src-tab-armory').setAttribute('aria-selected', String(armory));
  $('src-panel-addon').classList.toggle('hidden', armory);
  $('src-panel-armory').classList.toggle('hidden', !armory);
}

$('src-tab-addon').addEventListener('click', () => showSource('addon'));
$('src-tab-armory').addEventListener('click', () => showSource('armory'));

// remember the last character looked up, so a repeat sim is two clicks
try {
  const saved = JSON.parse(localStorage.getItem(ARMORY_PREFS) ?? '{}');
  if (saved.region) $('armory-region').value = saved.region;
  if (saved.realm) $('armory-realm').value = saved.realm;
  if (saved.name) $('armory-name').value = saved.name;
} catch { /* first run, or someone edited localStorage */ }

const ARMOR_SLOTS = ['head', 'shoulder', 'chest', 'waist', 'legs', 'feet', 'wrist', 'hands', 'back'];
const ACC_SLOTS = ['neck', 'finger1', 'finger2', 'trinket1', 'trinket2'];
const WEAPON_SLOTS = ['main_hand', 'off_hand'];

function itemIcon(c, it) {
  if (!it) return '';
  // Blizzard hands us the finished asset url; the keyless source only gives an
  // icon name, which the CDN does not serve for very new items. Either way the
  // data attributes are what the shared hover card reads, so the imported
  // character gets the same tooltip as every other item list.
  const src = it.iconUrl
    ?? (it.icon
      ? `https://render.worldofwarcraft.com/${encodeURIComponent(c.region)}/icons/56/${encodeURIComponent(it.icon)}.jpg`
      : null);
  const data = [
    `data-item="${Number(it.id) || 0}"`,
    it.name ? `data-name="${esc(it.name)}"` : '',
    it.ilvl ? `data-ilvl="${esc(it.ilvl)}"` : '',
    it.slot ? `data-slot="${esc(prettySlot(it.slot))}"` : '',
    `data-quality="${it.quality ?? 4}"`,
  ].filter(Boolean).join(' ');
  // no src: the shared icon map fills it in, so a missing CDN name is not fatal
  if (!src) return `<img class="char-item q${it.quality ?? 4}" alt="" ${data}>`;
  return `<img class="char-item q${it.quality ?? 4}" src="${esc(src)}" alt="" ${data}>`;
}

function renderCharCard(c) {
  const card = $('char-card');
  if (!c) { card.classList.add('hidden'); card.innerHTML = ''; return; }
  const bySlot = new Map(c.items.map((i) => [i.slot, i]));
  const group = (slots) => slots.map((s) => itemIcon(c, bySlot.get(s))).join('');
  // a live Blizzard read has no crawl age to apologise for
  const when = c.crawledAt ? new Date(c.crawledAt) : null;
  const age = when && !Number.isNaN(when.getTime())
    ? `Gear as last seen ${when.toLocaleString()} — swap something since then and it will not show here.`
    : c.source === 'blizzard'
      ? 'Read live from the Armory, so this is the gear the character logged out in.'
      : '';
  card.innerHTML = `
    ${c.thumbnail ? `<img class="char-portrait" src="${esc(c.thumbnail)}" alt="">` : ''}
    <div class="char-main">
      <div class="char-name">${esc(c.name)}</div>
      <div class="char-sub">${esc(c.race)} <span class="char-class">${esc(c.spec)} ${esc(c.className)}</span></div>
      <div class="char-sub">${esc(c.realm)} (${esc(String(c.region).toUpperCase())})</div>
    </div>
    ${c.itemLevel ? `<div class="char-ilvl">${esc(c.itemLevel)}</div>` : ''}
    <div class="char-items">
      ${group(ARMOR_SLOTS)}<span class="char-gap"></span>${group(ACC_SLOTS)}<span class="char-gap"></span>${group(WEAPON_SLOTS)}
    </div>
    ${age ? `<div class="char-note">${esc(age)}</div>` : ''}`;
  // Brand-new items sometimes have no icon on Blizzard's CDN yet (it answers
  // 403 in every region). Fall back to an empty tile that keeps the slot, the
  // quality border and the tooltip, rather than showing a broken image.
  for (const img of card.querySelectorAll('img.char-item')) {
    img.addEventListener('error', () => {
      img.classList.add('missing');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    }, { once: true });
  }
  card.classList.remove('hidden');
  // any tile the armory could not give a url for falls back to the icon map
  paintCardIcons(card);
}

// the card's tiles use their own class, so give them the same icon-map fill
async function paintCardIcons(card) {
  const pending = [...card.querySelectorAll('img.char-item:not([src])')];
  if (!pending.length) return;
  const need = [...new Set(pending.map((el) => Number(el.dataset.item))
    .filter((id) => id && !iconIds.has(id)))];
  if (need.length) {
    try {
      const r = await fetch(`/api/icons?ids=${need.join(',')}&patch=${encodeURIComponent(patch)}`);
      const j = await r.json();
      for (const id of need) iconIds.set(id, j.icons?.[id] ?? null);
    } catch {
      for (const id of need) iconIds.set(id, null);
    }
  }
  for (const el of pending) {
    const f = iconIds.get(Number(el.dataset.item));
    if (f) el.src = `${ICON_CDN}/${f}.jpg`;
    else el.classList.add('missing');
  }
}

async function importFromArmory() {
  const region = $('armory-region').value;
  const realm = $('armory-realm').value.trim();
  const name = $('armory-name').value.trim();
  if (!realm || !name) {
    $('armory-status').textContent = 'Enter both a realm and a character name.';
    return;
  }
  $('armory-import').disabled = true;
  $('armory-status').textContent = `Looking up ${name} on ${realm}…`;
  renderCharCard(null);
  try {
    const r = await fetch('/api/armory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, realm, name }),
    });
    const j = await r.json();
    if (!r.ok) {
      $('armory-status').textContent = j.error ?? 'Import failed.';
      return;
    }
    localStorage.setItem(ARMORY_PREFS, JSON.stringify({ region, realm, name }));
    fillingFromArmory = true;
    $('profile').value = j.profile;
    $('profile').dispatchEvent(new Event('input', { bubbles: true }));
    fillingFromArmory = false;
    renderCharCard(j.character);
    $('armory-status').textContent = 'Imported — set up the fight below and hit Sim it.';
  } catch {
    $('armory-status').textContent = 'Could not reach the Localbots server.';
  } finally {
    $('armory-import').disabled = false;
  }
}

$('armory-import').addEventListener('click', importFromArmory);
for (const id of ['armory-realm', 'armory-name']) {
  $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') importFromArmory(); });
}

// typing over an imported character makes the card wrong — drop it
$('profile').addEventListener('input', () => {
  if (!fillingFromArmory) renderCharCard(null);
});

// ---------- item icons + hover tooltip ----------
// Icon ids come from the game tables Localbots already downloads (see
// server/itemIcons.js), so this needs no API key and no third-party image host.
// Elements are rendered with the item id in a data attribute and no src; once
// the ids have been looked up the images are filled in, which avoids re-running
// whichever renderer drew them.

const ICON_CDN = 'https://render.worldofwarcraft.com/us/icons/56';
const iconIds = new Map(); // item id -> file id (null = looked up, has none)
let iconFetch = null; // in-flight batch, so a burst of renders makes one request

// Shared by itemTile() and by list rows that want the whole row (icon, name,
// AND the enchant/gem subline under it) to trigger the same item hovercard,
// not just the icon -- see topGearRowHtml() and renderTopGearGrid().
function tileDataAttrs(id, info = {}) {
  const q = info.quality ?? 4;
  // real items always carry their own real id (unlike an enchant, which
  // needs an offset-guess, or a gem/enchant tooltip our own itemStats()
  // can't compute) -- link Wowhead's widget straight off it, same as gems
  // and enchants, for one consistent hovercard source everywhere instead of
  // our own separately-maintained fetch+render pipeline. Without the item's
  // own bonus ids (upgrade track, crafted quality roll, ...) Wowhead has no
  // way to know which exact roll this is and shows some default/random one
  // instead -- see bonusIdsFromLine, which pulls them straight out of the
  // simmed line so the hovercard matches the item actually in your bag.
  const bonus = info.bonusIds?.length ? `&bonus=${info.bonusIds.join(':')}` : '';
  const wowhead = id ? (lang === 'es' ? `es:item=${Number(id)}${bonus}` : `item=${Number(id)}${bonus}`) : '';
  return [
    `data-item="${Number(id) || 0}"`,
    wowhead ? `data-wowhead="${wowhead}"` : '',
    // a catalysed piece keeps the stats of what it was made from
    info.statSource ? `data-statsrc="${Number(info.statSource)}"` : '',
    info.name ? `data-name="${esc(info.name)}"` : '',
    info.ilvl ? `data-ilvl="${esc(info.ilvl)}"` : '',
    info.slot ? `data-slot="${esc(info.slot)}"` : '',
    info.source ? `data-source="${esc(info.source)}"` : '',
    // the enchant/gems carried over from the equipped item in this slot (see
    // droptimizer.js) -- every candidate for a slot is simmed with these, so
    // showing them on the hovercard tells you what the row actually used
    info.enchantId ? `data-enchant="${Number(info.enchantId)}"` : '',
    info.gemIds?.length ? `data-gems="${info.gemIds.map(Number).join(',')}"` : '',
    // upgrade track (e.g. "Myth 6/6") -- decoded server-side, never guessed
    info.track ? `data-track="${esc(info.track)}"` : '',
    info.trackStep != null ? `data-track-step="${Number(info.trackStep)}"` : '',
    info.trackMax != null ? `data-track-max="${Number(info.trackMax)}"` : '',
    // crafter's quality roll (1-5), same scale the in-game recipe UI shows --
    // only ever set on crafted gear (see gearParser.js's craftingQuality)
    info.craftingQuality ? `data-craftq="${Number(info.craftingQuality)}"` : '',
    // the crafter's two chosen secondaries ("32-49") -- resolves the item's
    // stat-template placeholders to real stats server-side (see itemStats.js)
    info.craftedStats?.length === 2 ? `data-craftstats="${info.craftedStats.map(Number).join('-')}"` : '',
    `data-quality="${q}"`,
  ].filter(Boolean).join(' ');
}

function itemTile(id, info = {}) {
  const q = info.quality ?? 4;
  const data = tileDataAttrs(id, info);
  const cls = `item-tile q${q}${info.mini ? ' mini-icon' : ''}`;
  if (!id) return `<span class="${cls} missing" ${data}></span>`;
  const img = `<img class="${cls}" alt="" ${data}>`;
  if (info.noLink) return img;
  // Wowhead's widget only auto-attaches its hover tooltip to <a> elements,
  // never to a bare <img> -- confirmed live: a plain data-wowhead <img> never
  // fired a tooltip request, wrapping the same element in an <a> did.
  const whHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
  // the widget's own data-wowhead mini-syntax joins params with "&" even
  // though it isn't a real query string; a real href needs the usual "?"
  const bonusParam = info.bonusIds?.length ? `bonus=${info.bonusIds.join(':')}` : '';
  const wowhead = (lang === 'es' ? `es:item=${Number(id)}` : `item=${Number(id)}`) + (bonusParam ? `&${bonusParam}` : '');
  const href = `https://${whHost}/item=${Number(id)}${bonusParam ? `?${bonusParam}` : ''}`;
  return `<a class="item-tile-link" href="${href}" data-wowhead="${wowhead}" target="_blank" rel="noopener">${img}</a>`;
}

// A small icon + name, the whole thing linked to Wowhead's real tooltip
// widget off a real item id -- the same "enchgem-item" look as an equipped
// item's enchant/gem subline in the live report (see enchGemSubline), reused
// by the "Also compare" pickers for any option with a real item id up front
// (gems/diamonds/consumables immediately, enchants once resolved -- see
// warmCompareEnchantWowhead).
function wowheadLinkedTile(itemId, label) {
  const whHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
  const wowhead = lang === 'es' ? `es:item=${Number(itemId)}` : `item=${Number(itemId)}`;
  const tile = itemTile(itemId, { mini: true, noLink: true });
  return `<a class="cg-opt-link enchgem-item" href="https://${whHost}/item=${Number(itemId)}" data-wowhead="${wowhead}" target="_blank" rel="noopener">${tile} ${esc(label)}</a>`;
}

// Small flask badge over an item's icon: a catalyzed row already shows the
// real tier piece (its itemId/itemName were swapped server-side — see
// profileBuilder.js), and the badge is what makes that visible at a glance
// without reading the row's text.
function catalystBadge(t) {
  if (!t?.catalysed) return '';
  const title = `Catalyzed${t.catalystFromName ? ` from ${t.catalystFromName}` : ''} — shown as the tier piece it becomes, not the looted item`;
  return `<span class="catalyst-badge" title="${esc(title)}">
    <svg viewBox="0 0 24 24" width="10" height="10"><path d="M9 2v6.3L3.4 19a2 2 0 0 0 1.8 3h13.6a2 2 0 0 0 1.8-3L15 8.3V2M9 2h6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/></svg>
  </span>`;
}

// A crafted item's quality roll (1-5 diamonds, same scale the in-game
// recipe/tooltip shows), same corner-badge treatment as the catalyst flask --
// only ever set on crafted gear (see gearParser.js's craftingQuality).
function craftBadge(info) {
  if (!info?.craftingQuality) return '';
  return `<span class="craft-badge" title="Crafting Quality ${info.craftingQuality}/5">${info.craftingQuality}</span>`;
}

function itemTileWithBadge(id, info, t) {
  if (!id) return itemTile(id, info);
  return `<span class="item-tile-wrap">${itemTile(id, info)}${catalystBadge(t)}${craftBadge(info)}</span>`;
}

// The game's own enchant data has no per-enchant icon (SpellItemEnchantment's
// IconFileDataID is 0 on every row), which is why Raidbots' Top Gear report —
// the reference for this UI — shows the exact same generic scroll icon next
// to every enchant rather than a distinct one each. This is that same asset,
// hosted by Raidbots.
const ENCHANT_ICON_URL = 'https://www.raidbots.com/static/images/icons/56/inv_misc_enchantedscroll.png';

// The enchant/gem line shown under an item's name, each with its own small
// icon (the fixed generic one for an enchant, or the gem's own real icon --
// which reuses itemTile and gets its own hovercard on top). Hovering the
// line's text still pops the parent item's card too (see the data attrs on
// its wrapping row in renderTopGearGrid/rowHtml/renderBestSetup).
function enchGemSubline(enchantId, gemIds) {
  const parts = [];
  if (enchantId) {
    const name = gemOrEnchantLabel(enchantId, 'enchant');
    const itemId = enchantItemIdCache.get(Number(enchantId));
    const spellId = enchantSpellIdCache.get(Number(enchantId));
    // enchants have no item id of their own (they're a SpellItemEnchantment
    // row, not an item), so this app can't compute its own numeric stat line
    // for one the way it does for a real item or gem -- there's no reliable
    // local formula for what an enchant's own effect actually grants (see
    // the note on /api/enchant-names). Prefer linking Wowhead's tooltip
    // widget at the enchant's own scroll ITEM (its "Use: Permanently
    // enchants... by N%" text is reliably complete, verified against three
    // known enchants), falling back to the granted spell (sometimes empty)
    // and finally to our own name-only hovercard. Either way the data
    // attrs/link sit on the WRAPPING span/anchor, not just the icon --
    // otherwise hovering the name text (not the tiny icon itself) bubbles
    // past it to the parent item row's own data-item and shows that item's
    // hovercard instead of the enchant's.
    const inner = `<img class="mini-icon" alt="" src="${ENCHANT_ICON_URL}"> ${esc(name)}`;
    // Wowhead's widget renders the tooltip in whatever locale subdomain the
    // link points to -- matches the language switch the same way our own
    // hovercards already do
    const whHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
    const whEntity = itemId ? `item=${itemId}` : spellId ? `spell=${spellId}` : null;
    const whId = lang === 'es' ? `es:${whEntity}` : whEntity;
    parts.push(whEntity
      ? `<a class="enchgem-item" href="https://${whHost}/${whEntity}" data-wowhead="${whId}" target="_blank" rel="noopener">${inner}</a>`
      : `<span class="enchgem-item" data-name="${esc(name)}" data-source="Enchant">${inner}</span>`);
  }
  for (const g of gemIds ?? []) {
    const gInfo = { name: gemOrEnchantLabel(g, 'gem'), mini: true, noLink: true };
    // a gem carries a real item id already (no offset-guessing needed, unlike
    // an enchant), but our own item hovercard still comes up empty for one:
    // itemStats() requires an ilvl to compute anything, and gems are not
    // itemized/leveled -- so link Wowhead's widget here too, straight off
    // the real id (see the enchant case above for the language handling).
    const gemWhHost = lang === 'es' ? 'es.wowhead.com' : 'www.wowhead.com';
    const gemWhId = lang === 'es' ? `es:item=${g}` : `item=${g}`;
    parts.push(`<a class="enchgem-item" href="https://${gemWhHost}/item=${g}" data-wowhead="${gemWhId}" target="_blank" rel="noopener">${itemTile(g, gInfo)} ${esc(gInfo.name)}</a>`);
  }
  return parts.length ? `<span class="hint-inline block enchgem">${parts.join('')}</span>` : '';
}

// Fill in every tile on the page that does not have its image yet.
async function paintItemIcons(root = document) {
  const pending = [...root.querySelectorAll('img.item-tile[data-item]:not([src])')];
  if (!pending.length) return;
  const need = [...new Set(pending.map((el) => Number(el.dataset.item))
    .filter((id) => id && !iconIds.has(id)))];
  if (need.length) {
    const run = (async () => {
      // chunked so a full droptimizer never builds an absurd query string
      for (let i = 0; i < need.length; i += 200) {
        const batch = need.slice(i, i + 200);
        try {
          const r = await fetch(`/api/icons?ids=${batch.join(',')}&patch=${encodeURIComponent(patch)}`);
          const j = await r.json();
          for (const id of batch) iconIds.set(id, j.icons?.[id] ?? null);
        } catch {
          for (const id of batch) iconIds.set(id, null); // offline: show blanks, never hang
        }
      }
    })();
    iconFetch = run;
    await run;
    if (iconFetch === run) iconFetch = null;
  }
  for (const el of pending) {
    const f = iconIds.get(Number(el.dataset.item));
    if (f) el.src = `${ICON_CDN}/${f}.jpg`;
    else el.classList.add('missing');
  }
}

// one card, reused — cheaper than building a node per hover
let tipEl = null;
function itemTip() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'item-tip hidden';
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

let tipToken = 0;

// enchant id -> its real name ("Enchant Chest - Mark of the Worldsoul"),
// fetched from the game client's own data (see /api/enchant-names) the first
// time it's needed and cached from then on; null = looked up, found nothing.
const enchantNameCache = new Map();
// enchant id -> the spell id its primary effect grants, when there is one
// (see /api/enchant-names) -- used to link a real Wowhead tooltip widget for
// the enchant's actual numeric effect, which this app has no correct local
// formula for (see server/index.js's /api/enchant-names for why).
const enchantSpellIdCache = new Map();
// enchant id -> its scroll item's id (server-guessed via a verified fixed
// offset, confirmed against our own item cache -- see
// ENCHANT_TO_SCROLL_ITEM_OFFSET in server/index.js). The scroll item's own
// Wowhead tooltip reliably has the full "Use: Permanently enchants... by
// N%" text, unlike the enchant's underlying spell (often empty) -- preferred
// over enchantSpellIdCache whenever both exist.
const enchantItemIdCache = new Map();
let enchantNameFetch = null;

// Loads Wowhead's own public tooltip widget script once, the first time an
// enchant with a resolvable spell id is actually shown -- a session that
// never sees one never touches the network for this. $WowheadPower.refreshLinks()
// (documented by Wowhead for exactly this case) re-scans the page for new
// [data-wowhead] links after each redraw.
let wowheadWidgetLoading = null;
function loadWowheadWidget() {
  if (window.$WowheadPower) return Promise.resolve();
  if (wowheadWidgetLoading) return wowheadWidgetLoading;
  wowheadWidgetLoading = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://wow.zamimg.com/widgets/power.js';
    s.onload = resolve;
    s.onerror = resolve; // offline / blocked -- links just stay plain text
    document.head.appendChild(s);
  });
  return wowheadWidgetLoading;
}
function refreshWowheadLinks() {
  window.$WowheadPower?.refreshLinks?.();
}
// every item tile now links Wowhead's widget (see tileDataAttrs) -- items
// show up almost everywhere (char card, gear list, every results table), so
// load it up front rather than waiting for the first enchant/gem hover
loadWowheadWidget();

// Prefetches every equipped slot's enchant name in one request, so "Your Top
// Gear" and Details show the real name straight away instead of "enchant
// #NNNN" until something happens to be hovered. Also skips names already in
// the season's curated comparison list (gemOrEnchantLabel finds those on its
// own, no fetch needed).
async function warmEnchantNames(equipped) {
  // fetch the real (locale-correct) name for every equipped enchant not yet
  // cached -- including ones the curated comparison list already has a
  // (English-only) label for, since the real name now wins over that (see
  // gemOrEnchantLabel)
  const ids = [...new Set(Object.values(equipped ?? {})
    .map((eq) => eq?.enchantId).filter(Boolean))]
    .filter((id) => !enchantNameCache.has(id));
  if (!ids.length) return;
  let anySpellId = false;
  try {
    const r = await fetch(`/api/enchant-names?ids=${ids.join(',')}&patch=${encodeURIComponent(patch)}&lang=${encodeURIComponent(lang)}`);
    const j = await r.json();
    for (const id of ids) {
      enchantNameCache.set(id, j.names?.[id] ?? null);
      if (j.spellIds?.[id]) { enchantSpellIdCache.set(id, j.spellIds[id]); anySpellId = true; }
      if (j.itemIds?.[id]) { enchantItemIdCache.set(id, j.itemIds[id]); anySpellId = true; }
    }
  } catch {
    for (const id of ids) enchantNameCache.set(id, null);
  }
  if (anySpellId) await loadWowheadWidget();
  // redraw whatever's currently showing the enchant sublines
  if (!$('tg-gear').classList.contains('hidden')) renderTopGearGrid();
  if (!$('topgear-table').classList.contains('hidden')) renderTopGearRows();
  refreshWowheadLinks();
}

async function fetchEnchantName(id, onReady) {
  if (enchantNameCache.has(id)) return;
  await enchantNameFetch; // one in-flight batch at a time is plenty for a single hover
  if (enchantNameCache.has(id)) return;
  enchantNameFetch = (async () => {
    try {
      const r = await fetch(`/api/enchant-names?ids=${id}&patch=${encodeURIComponent(patch)}&lang=${encodeURIComponent(lang)}`);
      const j = await r.json();
      enchantNameCache.set(id, j.names?.[id] ?? null);
      if (j.spellIds?.[id]) enchantSpellIdCache.set(id, j.spellIds[id]);
      if (j.itemIds?.[id]) enchantItemIdCache.set(id, j.itemIds[id]);
      if (j.spellIds?.[id] || j.itemIds?.[id]) await loadWowheadWidget();
    } catch { enchantNameCache.set(id, null); }
  })();
  await enchantNameFetch;
  onReady?.();
  refreshWowheadLinks();
}

// id -> the season's display name for a gem or enchant, from the option
// lists the "Also compare" panel already loaded into `season` -- an enchant
// not in that curated list falls back to enchantNameCache (the real game
// name, fetched on demand) and finally to the raw id.
function gemOrEnchantLabel(id, kind) {
  if (kind === 'enchant') {
    // the game client's own name (see server/wagoData.js's loadEnchantNames)
    // is fetched per the CURRENT language and wins over the season config's
    // curated comparison list, which is hand-written English only -- matches
    // how the downloaded report already prioritizes these (see
    // enchGemLabelsFrom in server/index.js). Falls back to the curated label
    // (still meaningful, just English) until warmEnchantNames'/
    // fetchEnchantName's request lands and triggers a redraw.
    const cached = enchantNameCache.get(Number(id));
    if (cached) return cached;
    for (const arr of Object.values(season?.enchantOptions ?? {})) {
      const m = Array.isArray(arr) && arr.find((e) => String(e.id) === String(id));
      if (m) return m.label;
    }
    return `enchant #${id}`;
  }
  const g = (season?.gemOptions ?? []).find((g) => String(g.id) === String(id))
    ?? (season?.diamondOptions?.options ?? []).find((x) => String(x.id) === String(id));
  return g?.label ?? `gem #${id}`;
}

// title-case: slot/track names arrive in simc's lowercase form
const titleCase = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

// A bare-name hovercard for whatever has no Wowhead-resolvable id -- a
// missing/unknown item, or an enchant that never resolved a spell/scroll id
// (see fetchEnchantName). Every item, gem and resolvable enchant now links
// Wowhead's own widget instead (see tileDataAttrs / enchGemSubline), which
// has real, verified numbers this app has no correct local formula for.
function tipShell(d) {
  const rows = [];
  if (d.ilvl) rows.push(`<div class="tip-ilvl">Item Level ${esc(d.ilvl)}</div>`);
  if (d.track && d.trackStep && d.trackMax) {
    const tier = (TRACK_TAG[d.track] ?? '').toLowerCase();
    rows.push(`<div class="tip-track${tier ? ` tier-${tier}` : ''}">Upgrade Level: ${esc(d.track)} ${esc(d.trackStep)}/${esc(d.trackMax)}</div>`);
  }
  if (d.slot) rows.push(`<div class="tip-slot-row"><span class="tip-slot">${esc(titleCase(d.slot))}</span></div>`);
  // enchant/gems this row was actually simmed with (carried from the
  // currently-equipped item in this slot -- see gemOrEnchantLabel above)
  if (d.enchant) {
    const slot = d.slot ? ` ${titleCase(d.slot)}` : '';
    rows.push(`<div class="tip-sec">Enchant${esc(slot)} - ${esc(gemOrEnchantLabel(d.enchant, 'enchant'))}</div>`);
  }
  if (d.gems) {
    const names = d.gems.split(',').map((id) => gemOrEnchantLabel(id, 'gem')).join(', ');
    rows.push(`<div class="tip-sec">Gems: ${esc(names)}</div>`);
  }
  return `<div class="tip-name q${esc(d.quality ?? 4)}">${esc(d.name ?? 'Item')}</div>`
    + rows.join('')
    + (d.source ? `<div class="tip-source">${esc(d.source)}</div>` : '');
}

function showItemTip(el) {
  const d = el.dataset;
  if (!d.name && !d.item) return;
  const tip = itemTip();
  tip.innerHTML = tipShell(d);
  tip.classList.remove('hidden');
  positionTip(el);

  // an enchant outside the season's curated comparison list needs its real
  // name (and, when it resolves, a Wowhead id) fetched on demand -- redraw
  // once it lands so the card picks up the fresh name in the meantime
  if (d.enchant && !enchantNameCache.has(Number(d.enchant))) {
    const token = ++tipToken;
    fetchEnchantName(Number(d.enchant), () => {
      if (token !== tipToken || tip.classList.contains('hidden')) return;
      tip.innerHTML = tipShell(d);
      positionTip(el);
    });
  }
}

function positionTip(el) {
  const tip = itemTip();
  const r = el.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  // prefer the right of the icon, flip left when it would run off screen
  let left = r.right + 10;
  if (left + tr.width > window.innerWidth - 8) left = Math.max(8, r.left - tr.width - 10);
  let top = r.top;
  if (top + tr.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - tr.height - 8);
  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${top + window.scrollY}px`;
}

function hideItemTip() { if (tipEl) tipEl.classList.add('hidden'); }

document.addEventListener('mouseover', (e) => {
  // a [data-wowhead] link handles its own hover entirely (Wowhead's widget) --
  // stop there rather than let closest() keep climbing to a data-item/
  // data-name on some ancestor (the item whose slot the enchant is on) and
  // popping OUR tooltip on top of theirs
  const boundary = e.target.closest?.('[data-item], [data-name], [data-wowhead]');
  if (boundary && !boundary.hasAttribute('data-wowhead')) showItemTip(boundary);
});
document.addEventListener('mouseout', (e) => {
  const boundary = e.target.closest?.('[data-item], [data-name], [data-wowhead]');
  if (boundary && !boundary.hasAttribute('data-wowhead')) hideItemTip();
});
document.addEventListener('scroll', hideItemTip, true);
