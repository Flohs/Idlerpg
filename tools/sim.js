#!/usr/bin/env node
/* Headless balance simulation: loads the engine with a fake window/localStorage and auto-plays. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const store = {};
const ctx = { window: null, console, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'), Date, Math, JSON };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['data.js', 'skills.js', 'dungeon.js', 'world.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
const G = ctx.Game;
const args = process.argv.slice(2);
const hours = parseFloat(args[0] || '2');   // simulated play hours
const verbose = args.includes('-v');

G.newGame(['knight']); for (const h of G.S.heroes) { h.autoSkills = true; }
const S = () => G.S;
let lastFloorLog = 0;
G.on('milestone', (m) => console.log(`  [milestone] floor ${S().maxFloor}: ${m.name}`));
G.on('runend', (r) => { if (verbose) console.log(`  run end: ${r.type} floor ${r.floor} items ${r.items} gold ${r.gold}`); });

// crude "player" policy: between runs, sell commons, auto-equip, upgrade village, craft, then start at best waystone.
function villageTurn() {
  const s = S();
  // auto equip all heroes
  G.autoEquipAll();
  // sell everything not equipped that's worse than what's equipped (simple: sell all stash commons/uncommons, salvage rares+ if we have lots)
  for (const it of s.stash.slice()) { if (it.rarity === 0) G.salvageItem(it.id); else if (it.rarity === 1) (s.mats.scrap < 40 ? G.salvageItem(it.id) : G.sellItem(it.id)); else if (s.stash.length > 20) G.salvageItem(it.id); }
  // upgrade equipped items a bit
  for (const h of s.heroes) for (const slot of Object.keys(h.equip)) { const it = h.equip[slot]; if (!it) continue; for (let i = 0; i < 3; i++) { const c = G.upgradeCost(it); if (s.gold > c.gold * 4 && s.mats.scrap > c.scrap * 2) G.upgrade(it.id); else break; } }
  // buildings: cheapest available first, keep some gold
  const order = ['guild', 'shrine', 'blacksmith', 'tavern', 'market', 'alchemist', 'library', 'vault', 'mine'];
  for (let i = 0; i < 6; i++) {
    let best = null;
    for (const b of order) { if (!G.buildingAvailable(b)) continue; if (s.buildings[b] >= G.D.BUILDINGS[b].max) continue; const c = G.buildingCost(b); if (c.gold < s.gold * 0.6 && (!c.scrap || c.scrap <= s.mats.scrap)) { if (!best || c.gold < G.buildingCost(best).gold) best = b; } }
    if (!best) break; G.upgradeBuilding(best);
  }
  // recruit
  if (s.heroes.length < G.partySizeCap() && s.gold > G.recruitCost() * 1.5) { const avail = Object.keys(G.D.CLASSES).filter((c) => G.classUnlocked(c) && !s.heroes.some((h) => h.cls === c)); if (avail.length) G.recruit(avail[0]); }
  while (s.party.length < G.partySizeCap()) { const h = s.heroes.find((x) => !s.party.includes(x.uid)); if (!h) break; G.toggleParty(h.uid); }
  // craft when rich
  if (s.unlocked.craft) { for (const slot of G.D.SLOTS) { const c = G.craftCost(slot); if (s.gold > c.gold * 3 && s.mats.scrap > c.scrap * 2 && (!c.leather || s.mats.leather >= c.leather)) G.craft(slot, null); } G.autoEquipAll(); }
  s.settings.autoDescend = true; s.settings.autoExtractHp = 0.4; s.settings.autoSell = 'uncommon'; s.settings.autoSalvage = true;
}

const totalTicks = Math.floor(hours * 3600 * 10);
let t = 0; let runs = 0; let manualDecisions = 0;
while (t < totalTicks) {
  const s = S();
  if (!s.run) { villageTurn(); const ws = G.waystones(); const err = G.startRun(ws[ws.length - 1]); if (err) { console.log('startRun error', err); break; } runs++; }
  G.tick(); t++;
  const r = S().run;
  if (r && r.phase === 'floorclear' && G.guildLevel() < 1) {
    // manual policy before guild: descend unless avg hp < 45% or a hero is dead
    manualDecisions++;
    const alive = r.party.filter((p) => p.alive); const avg = alive.reduce((a, p) => a + p.hp / p.maxhp, 0) / alive.length;
    if (alive.length < r.party.length || avg < 0.45) G.extract(); else G.descend();
  }
  if (t % 36000 === 0) {
    const s2 = S();
    const lv = s2.heroes.map((h) => `${h.cls.slice(0, 3)}${h.level}`).join(' ');
    console.log(`h${t / 36000}: maxFloor ${s2.maxFloor} gold ${G.fmt(s2.gold)} scrap ${s2.mats.scrap} runs ${runs} wipes ${s2.stats.wipes} items ${s2.stats.itemsFound} | ${lv} | bld ${Object.entries(s2.buildings).filter(([k, v]) => v).map(([k, v]) => k.slice(0, 3) + v).join(' ')}`);
  }
}
const s = S();
console.log('\nFINAL', { maxFloor: s.maxFloor, runs, wipes: s.stats.wipes, extractions: s.stats.extractions, gold: G.fmt(s.gold), goldEarned: G.fmt(s.stats.goldEarned), kills: s.stats.kills, items: s.stats.itemsFound, ascensions: s.ascensions });
for (const h of s.heroes) { const st = G.heroStats(h); console.log(`${h.name} L${h.level} hp${st.hp} atk${st.atk} def${st.def} spd${st.spd} crit${st.crit} | ${Object.values(h.equip).filter(Boolean).map((i) => G.D.RARITIES[i.rarity].id[0] + i.ilvl + '+' + i.up).join(' ')}`); }
