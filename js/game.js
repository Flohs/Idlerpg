/* GRIMDELVE — core engine. No DOM access; UI subscribes to events. */
(function () {
  'use strict';
  const D = window.DATA;
  const SAVE_KEY = 'grimdelve_save_v1';
  const listeners = {};
  let S = null;
  let uidCounter = 1;

  // ---------- utils ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const chance = (p) => Math.random() < p;
  function weighted(list, wfn) {
    let total = 0; for (const x of list) total += wfn(x);
    let r = Math.random() * total;
    for (const x of list) { r -= wfn(x); if (r <= 0) return x; }
    return list[list.length - 1];
  }
  function emit(ev, payload) { (listeners[ev] || []).forEach((fn) => { try { fn(payload); } catch (e) { console.error(e); } }); }
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function log(text, kind) { S.log.push({ t: text, k: kind || '', ts: Date.now() }); if (S.log.length > 60) S.log.shift(); emit('log', { t: text, k: kind }); }
  const fmt = (n) => { n = Math.floor(n); if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'; if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K'; return String(n); };

  // ---------- scaling curves (tune here) ----------
  const C = {
    enemyHP: (f) => 42 * Math.pow(f, 1.1) * Math.pow(1.072, f),
    enemyATK: (f) => 7.5 * Math.pow(f, 0.85) * Math.pow(1.055, f),
    enemyDEF: (f) => 2 + f * 1.1,
    gold: (f) => (5 + f * 2.2) * Math.pow(1.035, f),
    xp: (f) => (10 + f * 3.5) * Math.pow(1.028, f),
    itemScale: (ilvl) => (1 + 0.09 * ilvl) * Math.pow(1.045, ilvl),
    xpToNext: (lvl) => Math.floor(35 * Math.pow(lvl, 1.55) + 25 * lvl),
    mitigation: (def, floor) => def / (def + 50 + 5 * (floor || 1)),
  };

  // ---------- state ----------
  function newState() {
    return {
      version: 1, created: Date.now(), lastSeen: Date.now(), name: 'GRIMDELVE',
      gold: 0, embers: 0,
      mats: { scrap: 0, leather: 0, essence: 0, bone_dust: 0, bile_gland: 0, glowcap: 0, hoarfrost: 0, hellsteel: 0, void_shard: 0 },
      heroes: [], party: [], stash: [],
      buildings: { tavern: 1, blacksmith: 0, market: 0, shrine: 0, alchemist: 0, vault: 0, mine: 0, library: 0, guild: 0 },
      unlocked: {}, maxFloor: 0, ascensions: 0, perks: {}, relics: [],
      settings: { autoDescend: true, autoExtractHp: 0.35, autoSell: 'none', autoSalvage: false, autoEquip: true, speed: 1, stopAtFloor: 0 },
      stats: { kills: 0, runs: 0, wipes: 0, extractions: 0, goldEarned: 0, itemsFound: 0, bossKills: 0, deepest: 0, playTicks: 0 },
      run: null, log: [], started: false, uid: 1, mineStock: { scrap: 0, gold: 0 },
    };
  }

  // ---------- heroes ----------
  function createHero(clsId, level) {
    const cls = D.CLASSES[clsId];
    const h = { uid: 'h' + (S.uid++), cls: clsId, name: cls.name, level: 1, xp: 0, equip: {}, kills: 0 };
    for (const s of D.SLOTS) h.equip[s] = null;
    while (h.level < (level || 1)) h.level++;
    return h;
  }
  function heroClass(h) { return D.CLASSES[h.cls]; }
  function globalBonus(stat) {
    let v = 0;
    for (const rid of S.relics) { const r = D.RELICS.find((x) => x.id === rid); if (r && r.stat === stat) v += r.val; }
    for (const p of D.ASCENSION_PERKS) { const rank = S.perks[p.id] || 0; if (rank && p.stat === stat) v += p.val * rank; }
    return v;
  }
  function itemStats(it) {
    const out = {};
    const rar = D.RARITIES[it.rarity];
    const scale = C.itemScale(it.ilvl) * rar.mult * (1 + 0.08 * (it.up || 0));
    const base = D.SLOT_BASE[it.slot];
    const flatScale = (1 + 0.03 * it.ilvl) * (1 + (rar.mult - 1) * 0.5) * (1 + 0.04 * (it.up || 0)); // crit/spd grow gently
    for (const k in base) out[k] = (out[k] || 0) + base[k] * ((k === 'crit' || k === 'spd') ? flatScale : scale);
    if (it.slot === 'weapon' && it.wtype) {
      const wt = D.WEAPON_TYPES[it.wtype];
      out.atk = (out.atk || 0) * wt.atk;
      if (wt.crit) out.crit = (out.crit || 0) + wt.crit;
      if (wt.def) out.def = (out.def || 0) + wt.def * scale * 0.5;
      if (wt.spd) out.spd = (out.spd || 0) + wt.spd;
      if (wt.hp) out.hp = (out.hp || 0) + wt.hp * scale * 0.5;
    }
    for (const a of it.affixes || []) {
      const def = D.AFFIXES.find((x) => x.id === a.id);
      if (!def) continue;
      out[def.stat] = (out[def.stat] || 0) + a.v;
    }
    return out;
  }
  function heroStats(h) {
    const cls = heroClass(h);
    const L = h.level - 1;
    const st = { hp: cls.base.hp + cls.grow.hp * L, atk: cls.base.atk + cls.grow.atk * L, def: cls.base.def + cls.grow.def * L,
      spd: cls.base.spd + cls.grow.spd * L, crit: cls.base.crit + cls.grow.crit * L, lifesteal: 0, gold: 0, xp: 0, loot: 0, thorns: 0 };
    for (const s of D.SLOTS) {
      const it = h.equip[s]; if (!it) continue;
      const is = itemStats(it);
      for (const k in is) st[k] = (st[k] || 0) + is[k];
    }
    st.hp *= 1 + (globalBonus('hppct')) / 100;
    st.atk *= 1 + (globalBonus('atkpct')) / 100;
    st.spd *= 1 + (globalBonus('spdpct')) / 100;
    st.crit += globalBonus('crit');
    st.lifesteal += globalBonus('lifesteal');
    st.gold += globalBonus('gold'); st.xp += globalBonus('xp'); st.loot += globalBonus('loot');
    st.lifesteal = Math.min(st.lifesteal, 60);
    for (const k in st) st[k] = Math.round(st[k] * 10) / 10;
    st.hp = Math.floor(st.hp);
    return st;
  }
  function heroSkills(h) {
    return heroClass(h).skills.filter((sid) => D.SKILLS[sid].unlock <= h.level).map((sid) => D.SKILLS[sid]);
  }
  function heroPower(h) { const s = heroStats(h); return Math.round(s.atk * 4 + s.hp / 4 + s.def * 3 + s.spd * 2 + s.crit); }
  function partySizeCap() { const t = S.buildings.tavern; return t >= 6 && S.unlocked.paladin ? 5 : t >= 3 && S.unlocked.enchant ? 4 : 3; }
  function rosterCap() { return 3 + S.buildings.tavern * 2; }
  function stashCap() { return 30 + S.buildings.vault * 15; }
  function classUnlocked(cid) { const c = D.CLASSES[cid]; return !c.unlock || !!S.unlocked[c.unlock]; }
  function recruitCost() { return Math.floor(80 * Math.pow(1.7, S.heroes.length - 3 + 1) * (1 + S.maxFloor * 0.05)); }
  function recruit(clsId) {
    if (!classUnlocked(clsId)) return 'Not unlocked yet.';
    if (S.heroes.length >= rosterCap()) return 'Roster is full. Upgrade the Tavern.';
    const cost = recruitCost();
    if (S.gold < cost) return 'Not enough gold.';
    S.gold -= cost;
    const lvl = Math.max(1, Math.floor(Math.max(...S.heroes.map((h) => h.level)) * 0.6));
    const h = createHero(clsId, lvl);
    S.heroes.push(h);
    if (S.party.length < partySizeCap() && !S.run) S.party.push(h.uid);
    log(`${h.name} joins the company at level ${h.level}.`, 'good');
    emit('roster');
    return null;
  }
  function dismiss(uid) {
    if (S.run) return 'Cannot dismiss during a run.';
    if (S.heroes.length <= 1) return 'You need at least one hero.';
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return 'No such hero';
    for (const s of D.SLOTS) if (h.equip[s]) { addToStash(h.equip[s]); h.equip[s] = null; }
    S.heroes = S.heroes.filter((x) => x.uid !== uid);
    S.party = S.party.filter((x) => x !== uid);
    if (S.party.length === 0) S.party.push(S.heroes[0].uid);
    emit('roster');
    return null;
  }
  function toggleParty(uid) {
    if (S.run) return 'Cannot change the party mid-run.';
    const i = S.party.indexOf(uid);
    if (i >= 0) { if (S.party.length === 1) return 'The party needs at least one hero.'; S.party.splice(i, 1); }
    else { if (S.party.length >= partySizeCap()) return 'Party is full.'; S.party.push(uid); }
    emit('roster');
    return null;
  }
  function giveXp(h, amount) {
    const bonus = 1 + (S.buildings.library * 0.1) + heroStats(h).xp / 100 + S.ascensions * 0.2;
    h.xp += Math.floor(amount * bonus);
    let leveled = false;
    while (h.xp >= C.xpToNext(h.level)) {
      h.xp -= C.xpToNext(h.level); h.level++; leveled = true;
      const newSkill = heroClass(h).skills.map((s) => D.SKILLS[s]).find((sk) => sk.unlock === h.level);
      log(`${h.name} reaches level ${h.level}${newSkill ? ' and learns ' + newSkill.name : ''}.`, 'level');
      emit('levelup', { hero: h, skill: newSkill });
      if (S.run) { const rp = S.run.party.find((p) => p.uid === h.uid); if (rp && rp.alive) { const st = heroStats(h); rp.maxhp = st.hp; rp.hp = Math.min(rp.maxhp, rp.hp + Math.floor(st.hp * 0.25)); } }
    }
    return leveled;
  }

  // ---------- items ----------
  function genItem(ilvl, opts) {
    opts = opts || {};
    ilvl = Math.max(1, Math.floor(ilvl));
    const luck = 1 + (opts.luck || 0) / 100;
    const maxR = (S.maxFloor >= 50 || S.ascensions > 0) ? 5 : ilvl >= 25 ? 4 : 3;
    let rIdx = D.RARITIES.indexOf(weighted(D.RARITIES.slice(0, maxR + 1), (r, i) => {
      const idx = D.RARITIES.indexOf(r);
      return r.weight * (idx === 0 ? 1 : Math.pow(luck, idx) * (1 + ilvl * 0.012 * idx));
    }));
    if (opts.minRarity != null) rIdx = Math.max(rIdx, opts.minRarity);
    if (opts.boost && chance(opts.boost)) rIdx = Math.min(maxR, rIdx + 1);
    const slot = opts.slot || pick(D.SLOTS);
    const rar = D.RARITIES[rIdx];
    const it = { id: 'i' + (S.uid++), slot, ilvl, rarity: rIdx, up: 0, affixes: [], wtype: null, name: '' };
    if (slot === 'weapon') it.wtype = opts.wtype || pick(Object.keys(D.WEAPON_TYPES));
    const pool = D.AFFIXES.slice();
    for (let i = 0; i < rar.affixes && pool.length; i++) {
      const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
      it.affixes.push({ id: a.id, v: rollAffix(a, ilvl, rIdx) });
    }
    nameItem(it);
    return it;
  }
  function rollAffix(a, ilvl, rIdx) {
    let v = (a.flat + a.per * ilvl) * (0.7 + Math.random() * 0.6) * (1 + rIdx * 0.15);
    if (a.pct) v = Math.min(a.max, v);
    else if (a.stat === 'crit' || a.stat === 'spd') v = Math.min(a.stat === 'crit' ? 12 : 6, v * 0.5);
    else v *= C.itemScale(ilvl) / (1 + 0.09 * ilvl); // mild exponential on flat affixes
    return Math.round(v * 10) / 10;
  }
  function nameItem(it) {
    const rar = D.RARITIES[it.rarity];
    const prefix = pick(D.ITEM_PREFIX[rar.id]);
    const noun = it.slot === 'weapon' ? D.WEAPON_TYPES[it.wtype].name : pick(D.ITEM_NOUN[it.slot]);
    const suffix = it.affixes.length ? ' ' + D.AFFIXES.find((a) => a.id === it.affixes[0].id).name : '';
    it.name = `${prefix} ${noun}${suffix}`;
  }
  function sellPrice(it) { return Math.floor((6 + it.ilvl * 3.2 * Math.pow(1.03, it.ilvl)) * D.RARITIES[it.rarity].sell * (1 + S.buildings.market * 0.12) * (1 + it.up * 0.1)); }
  function salvageYield(it) {
    const y = { scrap: Math.max(1, Math.round(1 + it.ilvl / 4)) };
    if (['head', 'chest', 'hands', 'feet'].includes(it.slot)) y.leather = Math.max(1, Math.round(it.ilvl / 6));
    if (it.rarity >= 2) y.essence = it.rarity - 1;
    if (it.up) y.scrap += it.up * 2;
    return y;
  }
  function addToStash(it) {
    if (S.stash.length >= stashCap()) {
      const g = sellPrice(it); S.gold += g; log(`Stash full — ${it.name} sold for ${g} gold.`, 'warn'); return false;
    }
    S.stash.push(it); return true;
  }
  function findItem(id) {
    let i = S.stash.findIndex((x) => x.id === id);
    if (i >= 0) return { where: 'stash', item: S.stash[i], idx: i };
    for (const h of S.heroes) for (const s of D.SLOTS) if (h.equip[s] && h.equip[s].id === id) return { where: 'hero', item: h.equip[s], hero: h, slot: s };
    if (S.run) { i = S.run.bag.findIndex((x) => x.id === id); if (i >= 0) return { where: 'bag', item: S.run.bag[i], idx: i }; }
    return null;
  }
  function removeItem(id) {
    const f = findItem(id); if (!f) return null;
    if (f.where === 'stash') S.stash.splice(f.idx, 1);
    else if (f.where === 'bag') S.run.bag.splice(f.idx, 1);
    else f.hero.equip[f.slot] = null;
    return f.item;
  }
  function sellItem(id) { const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot sell that.'; const g = sellPrice(f.item); removeItem(id); S.gold += g; S.stats.goldEarned += g; emit('inv'); return null; }
  function salvageItem(id) { const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot salvage that.'; const y = salvageYield(f.item); removeItem(id); for (const k in y) S.mats[k] = (S.mats[k] || 0) + y[k]; emit('inv'); return null; }
  function canEquip(h, it) { return it.slot !== 'weapon' || heroClass(h).weapons.includes(it.wtype); }
  function equipItem(uid, id) {
    const h = S.heroes.find((x) => x.uid === uid); const f = findItem(id);
    if (!h || !f) return 'Nothing to equip.';
    if (f.where === 'bag') return 'Loot in the bag can be equipped after extraction.';
    if (!canEquip(h, f.item)) return `${h.name} cannot wield a ${D.WEAPON_TYPES[f.item.wtype].name}.`;
    if (S.run && S.party.includes(uid)) return 'Cannot change gear mid-run.';
    removeItem(id);
    const old = h.equip[f.item.slot];
    h.equip[f.item.slot] = f.item;
    if (old) addToStash(old);
    emit('inv'); return null;
  }
  function unequip(uid, slot) { const h = S.heroes.find((x) => x.uid === uid); if (!h || !h.equip[slot]) return; if (S.run && S.party.includes(uid)) return 'Cannot change gear mid-run.'; addToStash(h.equip[slot]); h.equip[slot] = null; emit('inv'); }
  function itemScore(it, h) {
    const st = itemStats(it); const cls = heroClass(h);
    const w = cls.role === 'tank' ? { hp: 0.25, def: 3.5, atk: 3, spd: 2, crit: 0.8 } : cls.role === 'support' ? { hp: 0.3, def: 2.5, atk: 4, spd: 2.5, crit: 0.8 } : { hp: 0.15, def: 1.5, atk: 5, spd: 2.5, crit: 1.6 };
    let s = 0; for (const k in st) s += (w[k] || 0.6) * st[k];
    return s;
  }
  function autoEquip(uid) {
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return 0;
    if (S.run && S.party.includes(uid)) return 0;
    let n = 0;
    for (const slot of D.SLOTS) {
      let best = h.equip[slot]; let bestScore = best ? itemScore(best, h) : -1;
      for (const it of S.stash) if (it.slot === slot && canEquip(h, it) && itemScore(it, h) > bestScore) { best = it; bestScore = itemScore(it, h); }
      if (best && best !== h.equip[slot]) { equipItem(uid, best.id); n++; }
    }
    return n;
  }
  function autoEquipAll() { let n = 0; for (const h of S.heroes) n += autoEquip(h.uid); if (n) log(`Auto-equipped ${n} item${n > 1 ? 's' : ''}.`, 'good'); emit('inv'); return n; }

  // ---------- crafting ----------
  function craftIlvl() { return Math.max(1, S.maxFloor + S.buildings.blacksmith * 3); }
  function craftCost(slot) {
    const il = craftIlvl();
    const c = { gold: Math.floor(40 + il * 25 * Math.pow(1.03, il)), scrap: Math.floor(4 + il / 2) };
    if (['head', 'chest', 'hands', 'feet'].includes(slot)) c.leather = Math.floor(2 + il / 4);
    return c;
  }
  function craft(slot, matId) {
    if (!S.unlocked.craft) return 'Crafting is not unlocked.';
    const cost = craftCost(slot);
    for (const k in cost) if ((k === 'gold' ? S.gold : S.mats[k]) < cost[k]) return `Not enough ${k === 'gold' ? 'gold' : D.MATERIALS[k].name}.`;
    let boost = 0;
    if (matId) { if ((S.mats[matId] || 0) < 3) return `Need 3 ${D.MATERIALS[matId].name}.`; S.mats[matId] -= 3; boost = 0.5; }
    S.gold -= cost.gold; for (const k in cost) if (k !== 'gold') S.mats[k] -= cost[k];
    const it = genItem(craftIlvl(), { slot, luck: 40 + S.buildings.blacksmith * 8, boost, minRarity: 1 });
    addToStash(it);
    log(`Forged ${it.name}.`, 'loot'); emit('inv'); emit('crafted', it);
    return null;
  }
  function upgradeCap() { return 3 + S.buildings.blacksmith * 2; }
  function upgradeCost(it) { const n = it.up + 1; return { gold: Math.floor((15 + it.ilvl * 6) * Math.pow(1.45, n) * Math.pow(1.03, it.ilvl)), scrap: Math.floor(2 + n * 2 + it.ilvl / 8) }; }
  function upgrade(id) {
    const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot upgrade that.';
    if (f.item.up >= upgradeCap()) return 'Upgrade cap reached. Improve the Blacksmith.';
    if (S.run && f.where === 'hero' && S.party.includes(f.hero.uid)) return 'Cannot upgrade gear mid-run.';
    const c = upgradeCost(f.item);
    if (S.gold < c.gold) return 'Not enough gold.'; if (S.mats.scrap < c.scrap) return 'Not enough scrap.';
    S.gold -= c.gold; S.mats.scrap -= c.scrap; f.item.up++;
    emit('inv'); return null;
  }
  function enchantCost(it) { return 2 + it.rarity * 2; }
  function enchant(id) {
    if (!S.unlocked.enchant) return 'Enchanting is not unlocked.';
    const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot enchant that.';
    if (S.run && f.where === 'hero' && S.party.includes(f.hero.uid)) return 'Cannot enchant gear mid-run.';
    const it = f.item; const rar = D.RARITIES[it.rarity];
    if (rar.affixes === 0) return 'Common gear has no affixes to reroll.';
    const cost = enchantCost(it); if (S.mats.essence < cost) return `Need ${cost} Dark Essence.`;
    S.mats.essence -= cost;
    const pool = D.AFFIXES.slice(); it.affixes = [];
    for (let i = 0; i < rar.affixes; i++) { const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; it.affixes.push({ id: a.id, v: rollAffix(a, it.ilvl, it.rarity) * 1.1 }); }
    nameItem(it); emit('inv'); return null;
  }

  // ---------- village ----------
  function buildingCost(bid) { const b = D.BUILDINGS[bid]; const l = S.buildings[bid]; const c = { gold: Math.floor(b.base * Math.pow(b.growth, l)) }; if (l >= 3) c.scrap = Math.floor(10 * Math.pow(1.6, l - 3) + l * 5); return c; }
  function buildingAvailable(bid) { const b = D.BUILDINGS[bid]; return !b.unlock || !!S.unlocked[b.unlock]; }
  function upgradeBuilding(bid) {
    const b = D.BUILDINGS[bid]; if (!buildingAvailable(bid)) return 'Locked. Delve deeper.';
    if (S.buildings[bid] >= b.max) return 'Fully upgraded.';
    const c = buildingCost(bid);
    if (S.gold < c.gold) return 'Not enough gold.'; if (c.scrap && S.mats.scrap < c.scrap) return 'Not enough scrap.';
    S.gold -= c.gold; if (c.scrap) S.mats.scrap -= c.scrap; S.buildings[bid]++;
    log(`${b.name} upgraded to level ${S.buildings[bid]}.`, 'good'); emit('village');
    return null;
  }
  function guildLevel() { return S.buildings.guild; }
  function collectMine() { const g = Math.floor(S.mineStock.gold), sc = Math.floor(S.mineStock.scrap); if (g + sc <= 0) return; S.gold += g; S.mats.scrap += sc; S.mineStock = { gold: 0, scrap: 0 }; log(`Collected ${g} gold and ${sc} scrap from the mine.`, 'good'); emit('village'); }
  function mineTick(hours) { const l = S.buildings.mine; if (!l) return; S.mineStock.gold += l * 25 * hours; S.mineStock.scrap += l * 6 * hours; }

  // ---------- milestones ----------
  function checkMilestones() {
    for (const m of D.MILESTONES) {
      if (S.unlocked[m.id]) continue;
      if (m.cond.floor != null && S.maxFloor < m.cond.floor) continue;
      S.unlocked[m.id] = true;
      log(`Milestone: ${m.name} — ${m.unlocks}`, 'milestone');
      emit('milestone', m);
    }
  }
  function waystones() { const w = [1]; for (let f = 10; f <= S.maxFloor; f += 10) w.push(f + 1); return w; }

  // ---------- run / dungeon ----------
  function biomeFor(floor) { const idx = Math.floor((floor - 1) / D.FLOORS_PER_BIOME); return { biome: D.BIOMES[idx % D.BIOMES.length], cycle: Math.floor(idx / D.BIOMES.length) }; }
  function isBossFloor(f) { return f % D.BOSS_EVERY === 0; }
  function difficultyMult() { return 1 + S.ascensions * 0.3; }

  function startRun(startFloor) {
    if (S.run) return 'A run is already in progress.';
    if (S.party.length === 0) return 'Pick a party first.';
    startFloor = startFloor || 1;
    if (!waystones().includes(startFloor)) return 'No waystone there.';
    startFloor += (S.perks.legacy_depth || 0) * D.ASCENSION_PERKS.find((p) => p.id === 'legacy_depth').val;
    const party = S.party.map((uid) => { const h = S.heroes.find((x) => x.uid === uid); const st = heroStats(h); return { uid, hp: st.hp, maxhp: st.hp, shield: 0, ap: Math.random() * 50, cds: {}, buffs: [], alive: true, taunt: 0, stun: 0, dots: [] }; });
    S.run = { floor: startFloor, startFloor, room: 0, phase: 'travel', travelT: 0, party, enemies: [], bag: [], gold: 0, xp: 0, kills: 0, potions: S.buildings.alchemist, tick: 0, floorsCleared: 0, waitT: 0, bossFloorsCleared: 0 };
    S.stats.runs++;
    log(`The company descends. Floor ${startFloor}: ${biomeFor(startFloor).biome.name}.`, 'run');
    emit('runstart'); return null;
  }
  function spawnEncounter() {
    const R = S.run; const f = R.floor; const { biome, cycle } = biomeFor(f);
    const boss = isBossFloor(f) && R.room === D.ROOMS_PER_FLOOR; // boss in final room
    const count = boss ? 1 + (f >= 20 ? 1 : 0) : clamp(1 + Math.floor(Math.random() * (2 + Math.min(2, Math.floor(f / 8)))), 1, 4);
    const hpB = C.enemyHP(f) * difficultyMult() * (1 + cycle * 0.5), atkB = C.enemyATK(f) * difficultyMult() * (1 + cycle * 0.3), defB = C.enemyDEF(f);
    R.enemies = [];
    const mk = (eid, isBoss) => {
      const e = D.ENEMIES[eid];
      const hp = Math.floor(hpB * e.hp * (0.9 + Math.random() * 0.2));
      return { id: 'e' + (S.uid++), eid, name: e.name + (cycle > 0 ? ' ' + 'I'.repeat(cycle + 1).replace('IIII', 'IV') : ''), img: e.img, hp, maxhp: hp, atk: atkB * e.atk, def: defB * e.def, spd: 8 * e.spd, ap: Math.random() * 40, alive: true, boss: !!isBoss, buffs: [], dots: [], stun: 0, shield: 0, spec: e, shake: 0 };
    };
    if (boss) { R.enemies.push(mk(biome.boss, true)); if (count > 1) R.enemies.push(mk(pick(biome.enemies), false)); }
    else for (let i = 0; i < count; i++) R.enemies.push(mk(pick(biome.enemies), false));
    R.phase = 'combat'; R.roundT = 0;
    emit('encounter', { boss, enemies: R.enemies });
  }

  // combatant helpers
  function effStat(c, stat) {
    let base;
    if (c.uid) { const st = heroStats(S.heroes.find((h) => h.uid === c.uid)); base = st[stat] || 0; }
    else base = c[stat] || 0;
    let mult = 1;
    for (const b of c.buffs) if (b[stat]) mult += b[stat];
    return base * mult;
  }
  function hasBuff(c, k) { return c.buffs.some((b) => b[k]); }
  function buffVal(c, k) { let v = 0; for (const b of c.buffs) if (b[k]) v += b[k]; return v; }
  function heroOf(c) { return S.heroes.find((h) => h.uid === c.uid); }
  function label(c) { return c.uid ? heroOf(c).name : c.name; }

  function dealDamage(src, tgt, raw, opts) {
    opts = opts || {};
    if (!tgt.alive) return 0;
    if (tgt.uid && hasBuff(tgt, 'evade') && chance(buffVal(tgt, 'evade'))) { emit('float', { id: tgt.uid, text: 'evade', kind: 'miss' }); return 0; }
    if (!tgt.uid && tgt.spec.evade && chance(tgt.spec.evade)) { emit('float', { id: tgt.id, text: 'miss', kind: 'miss' }); return 0; }
    const def = effStat(tgt, 'def');
    let dmg = raw * (1 - C.mitigation(def, S.run.floor));
    if (opts.true) dmg = raw;
    dmg *= 1 + buffVal(tgt, 'vuln');
    if (tgt.uid) {
      const h = heroOf(tgt);
      if (h.cls === 'knight' && tgt.hp < tgt.maxhp * 0.5) dmg *= 0.8;
      if (S.run.party.some((p) => p.alive && p.uid !== tgt.uid && heroOf(p).cls === 'paladin')) dmg *= 0.9;
    }
    let crit = false;
    if (src && !opts.noCrit) {
      const cc = (src.uid ? effStat(src, 'crit') : 5) + (opts.critBonus || 0);
      if (chance(cc / 100)) { crit = true; dmg *= src.uid && heroOf(src).cls === 'rogue' ? 2.0 : 1.5; }
    }
    dmg = Math.max(1, Math.floor(dmg));
    // shield absorbs
    if (tgt.shield > 0) { const a = Math.min(tgt.shield, dmg); tgt.shield -= a; dmg -= a; if (a) emit('float', { id: tgt.uid || tgt.id, text: '-' + a, kind: 'shield' }); }
    tgt.hp -= dmg;
    tgt.shake = 4;
    emit('float', { id: tgt.uid || tgt.id, text: String(dmg), kind: crit ? 'crit' : (tgt.uid ? 'hurt' : 'dmg') });
    if (src && src.uid) {
      const st = heroStats(heroOf(src));
      let ls = st.lifesteal / 100 + buffVal(src, 'lifesteal') + (opts.lifesteal || 0);
      if (ls > 0) heal(src, dmg * ls, true);
      if (heroOf(src).cls === 'necromancer' && tgt.hp < tgt.maxhp * 0.5) for (const p of S.run.party) if (p.alive) heal(p, dmg * 0.08, true);
      if (heroOf(src).cls !== 'necromancer' && S.run.party.some((p) => p.alive && heroOf(p).cls === 'necromancer') && tgt.hp < tgt.maxhp * 0.5) for (const p of S.run.party) if (p.alive) heal(p, dmg * 0.08, true);
    }
    if (tgt.uid && src && !src.uid) { const st = heroStats(heroOf(tgt)); if (st.thorns > 0) { src.hp -= Math.floor(dmg * st.thorns / 100); emit('float', { id: src.id, text: Math.floor(dmg * st.thorns / 100), kind: 'dmg' }); if (src.hp <= 0) killEnemy(src); } }
    if (tgt.hp <= 0) { if (tgt.uid) killHero(tgt); else killEnemy(tgt); }
    return dmg;
  }
  function heal(c, amount, quiet) {
    if (!c.alive) return; amount = Math.floor(amount); if (amount <= 0) return;
    const before = c.hp; c.hp = Math.min(c.maxhp, c.hp + amount);
    if (!quiet && c.hp - before > 0) emit('float', { id: c.uid || c.id, text: '+' + (c.hp - before), kind: 'heal' });
  }
  function killHero(p) {
    p.alive = false; p.hp = 0; p.buffs = []; p.dots = [];
    log(`${label(p)} falls.`, 'bad'); emit('death', { id: p.uid });
    if (!S.run.party.some((x) => x.alive)) partyWipe();
  }
  function killEnemy(e) {
    const R = S.run; if (!e.alive) return;
    e.alive = false; e.hp = 0; R.kills++; S.stats.kills++;
    const f = R.floor;
    const alive = R.party.filter((p) => p.alive);
    const goldBonus = 1 + Math.max(...alive.map((p) => heroStats(heroOf(p)).gold), 0) / 100 + S.ascensions * 0.3;
    const lootBonus = Math.max(...alive.map((p) => heroStats(heroOf(p)).loot), 0);
    const g = Math.floor(C.gold(f) * (e.boss ? 8 : 1) * goldBonus * rnd(0.8, 1.2));
    R.gold += g;
    const xp = C.xp(f) * (e.boss ? 6 : 1);
    for (const p of R.party) giveXp(heroOf(p), p.alive ? xp : xp * 0.5);
    if (e.boss) { S.stats.bossKills++; log(`${e.name} is destroyed.`, 'boss'); }
    // loot
    const dropChance = (e.boss ? 1 : 0.22 + f * 0.002) * (1 + lootBonus / 100);
    if (chance(dropChance)) {
      const it = genItem(f + (e.boss ? 3 : 0), { luck: lootBonus + f * 0.5, minRarity: e.boss ? 2 : null });
      R.bag.push(it); S.stats.itemsFound++;
      emit('loot', { item: it, id: e.id });
      if (it.rarity >= 3) log(`Found ${it.name}!`, 'loot');
    }
    if (chance(e.boss ? 1 : 0.12)) { const mat = biomeFor(f).biome.material; R.mats = R.mats || {}; R.mats[mat] = (R.mats[mat] || 0) + (e.boss ? 3 : 1); }
    if (e.boss && S.unlocked.relics && chance(0.35)) {
      const pool = D.RELICS.filter((r) => !S.relics.includes(r.id));
      if (pool.length) { const r = pick(pool); S.relics.push(r.id); log(`Relic found: ${r.name} — ${r.desc}`, 'milestone'); emit('relic', r); }
    }
    emit('float', { id: e.id, text: '+' + g + 'g', kind: 'gold' });
    emit('kill', { id: e.id, boss: e.boss });
  }

  function partyWipe() {
    const R = S.run;
    R.phase = 'dead';
    S.stats.wipes++;
    const keep = S.buildings.shrine * 0.08;
    const kept = R.bag.filter(() => chance(keep));
    const goldKept = Math.floor(R.gold * 0.4);
    for (const it of kept) addToStash(it);
    S.gold += goldKept; S.stats.goldEarned += goldKept;
    const summary = { type: 'wipe', floor: R.floor, kills: R.kills, gold: goldKept, goldLost: R.gold - goldKept, items: kept.length, itemsLost: R.bag.length - kept.length, floors: R.floorsCleared };
    log(`The company is wiped out on floor ${R.floor}. ${kept.length} of ${R.bag.length} items recovered.`, 'bad');
    S.run = null;
    emit('runend', summary);
    return summary;
  }
  function extract() {
    const R = S.run; if (!R) return 'No run.';
    if (R.phase !== 'floorclear' && R.phase !== 'travel') return 'Can only extract after clearing a floor.';
    S.stats.extractions++;
    let sold = 0, salvaged = 0, kept = 0;
    for (const it of R.bag) {
      const rid = D.RARITIES[it.rarity].id;
      if (S.settings.autoSell !== 'none' && guildLevel() >= 3 && shouldAutoSell(it)) { if (S.settings.autoSalvage && guildLevel() >= 4) { const y = salvageYield(it); for (const k in y) S.mats[k] = (S.mats[k] || 0) + y[k]; salvaged++; } else { S.gold += sellPrice(it); sold++; } }
      else { addToStash(it); kept++; }
    }
    S.gold += R.gold; S.stats.goldEarned += R.gold;
    if (R.mats) for (const k in R.mats) S.mats[k] = (S.mats[k] || 0) + R.mats[k];
    const summary = { type: 'extract', floor: R.floor - (R.phase === 'floorclear' ? 0 : 1), kills: R.kills, gold: R.gold, items: R.bag.length, kept, sold, salvaged, floors: R.floorsCleared, mats: R.mats || {} };
    log(`Extracted from floor ${summary.floor} with ${R.bag.length} items and ${fmt(R.gold)} gold.`, 'good');
    S.run = null;
    if (S.settings.autoEquip && guildLevel() >= 5) autoEquipAll();
    emit('runend', summary);
    return null;
  }
  function shouldAutoSell(it) {
    const order = ['none', 'common', 'uncommon', 'rare'];
    const idx = order.indexOf(S.settings.autoSell);
    return idx > 0 && it.rarity <= idx - 1;
  }
  function descend() {
    const R = S.run; if (!R || R.phase !== 'floorclear') return 'Not at a floor exit.';
    R.floor++; R.room = 0; R.phase = 'travel'; R.travelT = 0;
    const { biome } = biomeFor(R.floor);
    if ((R.floor - 1) % D.FLOORS_PER_BIOME === 0) log(`Floor ${R.floor}: ${biome.name}. ${biome.flavor}`, 'run');
    emit('floor', { floor: R.floor });
    return null;
  }
  function usePotionIfNeeded() {
    const R = S.run; if (R.potions <= 0) return;
    const low = R.party.filter((p) => p.alive && p.hp < p.maxhp * 0.35);
    if (!low.length) return;
    R.potions--; const healPct = 0.3 + S.buildings.alchemist * 0.05;
    for (const p of low) heal(p, p.maxhp * healPct);
    log(`A potion is used. ${R.potions} left.`, '');
    emit('potion');
  }

  // choose & perform hero action
  function heroAct(p) {
    const R = S.run; const h = heroOf(p); const cls = heroClass(h);
    if (p.stun > 0) { p.stun--; return; }
    tickDots(p);
    if (!p.alive) return;
    // buffs countdown
    p.buffs = p.buffs.filter((b) => --b.dur > 0);
    if (p.taunt > 0) p.taunt--;
    for (const k in p.cds) if (p.cds[k] > 0) p.cds[k]--;
    // priest trait
    if (cls.id === 'priest') for (const q of R.party) if (q.alive) heal(q, q.maxhp * 0.01, true);
    const enemies = R.enemies.filter((e) => e.alive); if (!enemies.length) return;
    const allies = R.party.filter((q) => q.alive);
    const skills = heroSkills(h).slice().reverse(); // strongest first
    const skillPower = 1 + S.buildings.library * 0.05;
    const atk = effStat(p, 'atk');
    const pickTarget = () => {
      if (cls.id === 'ranger') return enemies.reduce((a, b) => (a.hp < b.hp ? a : b));
      if (cls.id === 'rogue') return enemies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b));
      const tauntless = enemies; return chance(0.6) ? tauntless[0] : pick(tauntless);
    };
    for (const sk of skills) {
      const sid = cls.skills.find((x) => D.SKILLS[x] === sk);
      if ((p.cds[sid] || 0) > 0) continue;
      let used = false; const m = (sk.mult || 0) * skillPower;
      switch (sk.type) {
        case 'dmg': { const t = pickTarget(); let raw = atk * m; if (sk.execute && t.hp < t.maxhp * sk.execute) raw *= 3; if (sk.vs && t.spec.family === sk.vs) raw *= 2; if (sk.selfdmg) { p.hp = Math.max(1, p.hp - Math.floor(p.maxhp * sk.selfdmg)); }
          if (cls.id === 'pyromancer' && t.dots.some((d) => d.burn)) raw *= 1.25;
          if (cls.id === 'berserker') raw *= 1 + (1 - p.hp / p.maxhp);
          dealDamage(p, t, raw, { critBonus: sk.critBonus, lifesteal: sk.lifesteal }); if (sk.stun && t.alive) t.stun = sk.stun; if (sk.burn && t.alive) t.dots.push({ v: atk * 0.3, dur: sk.burn, burn: true, src: p }); used = true; break; }
        case 'aoe': { for (const t of enemies) { let raw = atk * m; if (cls.id === 'pyromancer' && t.dots.some((d) => d.burn)) raw *= 1.25; if (cls.id === 'berserker') raw *= 1 + (1 - p.hp / p.maxhp); dealDamage(p, t, raw); if (sk.burn && t.alive) t.dots.push({ v: atk * 0.25, dur: sk.burn, burn: true, src: p }); } if (sk.healall) for (const q of allies) heal(q, q.maxhp * sk.healall); used = true; break; }
        case 'dot': { const t = pickTarget(); t.dots.push({ v: atk * m, dur: sk.dur, burn: cls.id === 'pyromancer', src: p }); emit('float', { id: t.id, text: cls.id === 'pyromancer' ? 'burning' : 'poisoned', kind: 'status' }); used = true; break; }
        case 'dotall': { for (const t of enemies) t.dots.push({ v: atk * m, dur: sk.dur, src: p }); used = true; break; }
        case 'heal': { const w = allies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)); if (w.hp / w.maxhp < 0.65) { heal(w, atk * m); used = true; } break; }
        case 'healself': { if (p.hp / p.maxhp < 0.5) { heal(p, p.maxhp * m); if (sk.buff) p.buffs.push({ ...sk.buff }); used = true; } break; }
        case 'shield': { if (p.shield < p.maxhp * 0.1 && p.hp / p.maxhp < 0.85) { p.shield = Math.floor(p.maxhp * m); emit('float', { id: p.uid, text: 'shield', kind: 'status' }); used = true; } break; }
        case 'shieldall': { if (allies.some((q) => q.shield <= 0 && q.hp / q.maxhp < 0.9)) { for (const q of allies) q.shield = Math.max(q.shield, Math.floor(q.maxhp * m)); emit('float', { id: p.uid, text: 'ward', kind: 'status' }); used = true; } break; }
        case 'taunt': { if (allies.length > 1 && p.hp / p.maxhp > 0.3) { p.taunt = sk.dur; emit('float', { id: p.uid, text: 'taunt', kind: 'status' }); used = true; } break; }
        case 'selfbuff': { if (!hasBuff(p, Object.keys(sk.buff)[0])) { p.buffs.push({ ...sk.buff }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'buffall': { if (!hasBuff(p, 'atk')) { for (const q of allies) q.buffs.push({ ...sk.buff }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'debuff': { const t = pickTarget(); if (!hasBuff(t, Object.keys(sk.debuff)[0])) { dealDamage(p, t, atk * m); if (t.alive) t.buffs.push({ ...sk.debuff }); used = true; } break; }
        case 'debuffall': { if (!enemies.some((e) => hasBuff(e, 'atk'))) { for (const t of enemies) t.buffs.push({ ...sk.debuff }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'cleanse': { if (allies.some((q) => q.dots.length || q.buffs.some((b) => b.spd < 0)) || allies.some((q) => q.hp / q.maxhp < 0.5)) { for (const q of allies) { q.dots = []; q.buffs = q.buffs.filter((b) => !(b.spd < 0 || b.atk < 0)); heal(q, q.maxhp * 0.05); } used = true; } break; }
        case 'revive': { const dead = R.party.find((q) => !q.alive); if (dead) { dead.alive = true; dead.hp = Math.floor(dead.maxhp * m); dead.ap = 0; log(`${label(dead)} is dragged back to life.`, 'good'); emit('revive', { id: dead.uid }); used = true; } break; }
      }
      if (used) { p.cds[sid] = sk.cd; emit('skill', { id: p.uid, name: sk.name }); return; }
    }
    // basic attack
    const t = pickTarget(); let raw = atk;
    if (cls.id === 'berserker') raw *= 1 + (1 - p.hp / p.maxhp);
    if (cls.id === 'pyromancer' && t.dots.some((d) => d.burn)) raw *= 1.25;
    dealDamage(p, t, raw);
    emit('attack', { id: p.uid, target: t.id });
  }
  function tickDots(c) {
    if (!c.dots.length) return;
    let total = 0;
    for (const d of c.dots) { total += d.v; d.dur--; }
    c.dots = c.dots.filter((d) => d.dur > 0);
    if (total > 0) {
      const dmg = Math.max(1, Math.floor(total));
      c.hp -= dmg; emit('float', { id: c.uid || c.id, text: dmg, kind: c.uid ? 'hurt' : 'dot' });
      if (c.hp <= 0) { if (c.uid) killHero(c); else killEnemy(c); }
    }
  }
  function enemyAct(e) {
    const R = S.run;
    if (e.stun > 0) { e.stun--; return; }
    tickDots(e); if (!e.alive) return;
    e.buffs = e.buffs.filter((b) => --b.dur > 0);
    if (e.spec.regen) heal(e, e.maxhp * e.spec.regen, true);
    const alive = R.party.filter((p) => p.alive); if (!alive.length) return;
    const sp = e.spec;
    if (sp.heals && chance(0.3)) { const w = R.enemies.filter((x) => x.alive).reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)); if (w.hp < w.maxhp * 0.7) { heal(w, w.maxhp * 0.15); return; } }
    if (sp.summons && chance(0.25) && R.enemies.filter((x) => x.alive).length < 4) { const { biome } = biomeFor(R.floor); const add = D.ENEMIES[sp.summons]; const hp = Math.floor(C.enemyHP(R.floor) * add.hp * 0.6 * difficultyMult()); R.enemies.push({ id: 'e' + (S.uid++), eid: sp.summons, name: add.name, img: add.img, hp, maxhp: hp, atk: C.enemyATK(R.floor) * add.atk * difficultyMult(), def: C.enemyDEF(R.floor) * add.def, spd: 8 * add.spd, ap: 0, alive: true, boss: false, buffs: [], dots: [], stun: 0, shield: 0, spec: add, shake: 0 }); emit('encounter', { boss: false, enemies: R.enemies, add: true }); return; }
    const atk = effStat(e, 'atk');
    const taunter = alive.find((p) => p.taunt > 0);
    const target = taunter || (chance(0.55) ? alive[0] : pick(alive)); // front-liner draws most aggro
    if (sp.aoe && chance(0.3)) { for (const p of alive) dealDamage(e, p, atk * 0.7); emit('attack', { id: e.id, target: 'all' }); return; }
    const dmg = dealDamage(e, target, atk);
    emit('attack', { id: e.id, target: target.uid });
    if (!target.alive) return;
    if (sp.poison && chance(sp.poison)) target.dots.push({ v: atk * 0.25, dur: 3 });
    if (sp.burn && chance(sp.burn)) target.dots.push({ v: atk * 0.3, dur: 2, burn: true });
    if (sp.slow && chance(sp.slow) && !hasBuff(target, 'spd')) target.buffs.push({ spd: -0.3, dur: 2 });
    if (sp.lifesteal && dmg > 0) heal(e, dmg * sp.lifesteal, true);
  }

  function floorCleared() {
    const R = S.run;
    R.floorsCleared++;
    if (isBossFloor(R.floor)) R.bossFloorsCleared++;
    if (R.floor > S.maxFloor) { S.maxFloor = R.floor; S.stats.deepest = R.floor; checkMilestones(); }
    // floor chest
    const f = R.floor;
    const alive = R.party.filter((p) => p.alive);
    const lootBonus = Math.max(...alive.map((p) => heroStats(heroOf(p)).loot), 0);
    const g = Math.floor(C.gold(f) * 3 * rnd(0.8, 1.3) * (1 + S.ascensions * 0.3)); R.gold += g;
    const chest = { gold: g, items: [] };
    if (chance(0.5 + lootBonus / 200)) { const it = genItem(f + 1, { luck: lootBonus + f * 0.5, minRarity: isBossFloor(f) ? 2 : 1 }); R.bag.push(it); chest.items.push(it); S.stats.itemsFound++; }
    const mat = biomeFor(f).biome.material; R.mats = R.mats || {}; R.mats[mat] = (R.mats[mat] || 0) + 1; chest.mat = mat;
    // rest
    const restPct = 0.2 + S.buildings.shrine * 0.04;
    for (const p of R.party) if (p.alive) { heal(p, p.maxhp * restPct, true); p.dots = []; p.buffs = p.buffs.filter((b) => !(b.spd < 0 || b.atk < 0)); }
    if (S.buildings.shrine >= 4) for (const p of R.party) if (!p.alive) { p.alive = true; p.hp = Math.floor(p.maxhp * 0.25); p.ap = 0; p.cds = {}; log(`${label(p)} rises at the Shrine's call.`, 'good'); emit('revive', { id: p.uid }); }
    R.phase = 'floorclear'; R.waitT = 0;
    log(`Floor ${f} cleared. ${chest.items.length ? 'Chest: ' + chest.items[0].name + '. ' : ''}Extract or go deeper?`, 'run');
    emit('floorclear', { floor: f, chest, next: biomeFor(f + 1).biome, newBiome: f % D.FLOORS_PER_BIOME === 0 });
  }

  // main simulation tick (100ms at 1x)
  function tick() {
    const R = S.run; if (!R) return;
    R.tick++; S.stats.playTicks++;
    if (R.phase === 'travel') {
      R.travelT++;
      const need = R.room === 0 ? 18 : 25;
      if (R.travelT >= need) { R.room++; R.travelT = 0; spawnEncounter(); }
      return;
    }
    if (R.phase === 'combat') {
      usePotionIfNeeded();
      const all = [...R.party, ...R.enemies];
      for (const c of all) {
        if (!c.alive) continue;
        c.ap += effStat(c, 'spd') * 0.55;
        if (c.ap >= 100) { c.ap -= 100; if (c.uid) heroAct(c); else enemyAct(c); if (!S.run) return; }
        if (c.shake > 0) c.shake--;
      }
      if (!S.run) return;
      if (!R.enemies.some((e) => e.alive)) {
        const roomsTotal = D.ROOMS_PER_FLOOR + (isBossFloor(R.floor) ? 1 : 0);
        if (R.room >= roomsTotal) floorCleared();
        else { R.phase = 'travel'; R.travelT = 0; for (const p of R.party) if (p.alive) heal(p, p.maxhp * 0.03, true); emit('roomclear'); }
      }
      return;
    }
    if (R.phase === 'floorclear') {
      R.waitT++;
      if (guildLevel() >= 1 && S.settings.autoDescend && R.waitT >= 25) {
        const alive = R.party.filter((p) => p.alive);
        const avg = alive.reduce((a, p) => a + p.hp / p.maxhp, 0) / alive.length;
        const stop = S.settings.stopAtFloor && R.floor >= S.settings.stopAtFloor;
        const lowHp = guildLevel() >= 2 && avg < S.settings.autoExtractHp;
        const someoneDead = alive.length < R.party.length && guildLevel() >= 2;
        if (stop || lowHp || someoneDead) extract(); else descend();
      }
    }
  }

  // ---------- ascension ----------
  function canAscend() { return S.unlocked.ascension && S.maxFloor >= 60; }
  function ascensionReward() { return Math.max(1, Math.floor(S.maxFloor / 10) + Math.floor(S.stats.bossKills / 10) + S.ascensions); }
  function ascend() {
    if (!canAscend()) return 'Reach floor 60 first.';
    if (S.run) return 'Finish or abandon the run first.';
    const reward = ascensionReward();
    S.embers += reward; S.ascensions++;
    S.maxFloor = 0; S.stash = []; S.gold = 0; S.relics = [];
    for (const h of S.heroes) for (const s of D.SLOTS) h.equip[s] = null;
    log(`ASCENSION ${S.ascensions}. The dungeon reforms. +${reward} Embers. Enemies are ${Math.round((difficultyMult() - 1) * 100)}% stronger; loot, gold and XP are richer.`, 'milestone');
    emit('ascend', { reward }); emit('inv'); emit('village');
    return null;
  }
  function buyPerk(pid) {
    const p = D.ASCENSION_PERKS.find((x) => x.id === pid); const r = S.perks[pid] || 0;
    if (r >= p.max) return 'Maxed.'; const c = p.cost(r); if (S.embers < c) return 'Not enough Embers.';
    S.embers -= c; S.perks[pid] = r + 1; emit('village'); return null;
  }
  function abandonRun() { if (!S.run) return; const R = S.run; S.run = null; log('The company retreats in disgrace. The bag is lost.', 'bad'); emit('runend', { type: 'abandon', floor: R.floor, kills: R.kills, gold: 0, items: 0, itemsLost: R.bag.length, floors: R.floorsCleared }); }

  // ---------- new game / save ----------
  function newGame(chosen) {
    S = newState();
    for (const cid of chosen) { const h = createHero(cid, 1); S.heroes.push(h); S.party.push(h.uid); }
    // starter gear
    for (const h of S.heroes) { const it = genItem(1, { slot: 'weapon', wtype: heroClass(h).weapons[0] }); it.rarity = 0; it.affixes = []; nameItem(it); h.equip.weapon = it; }
    S.gold = 30; S.started = true;
    log('The company gathers at the gate. Below: the Catacombs.', 'run');
    save(); emit('newgame');
  }
  function save() { if (!S) return; S.lastSeen = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; S = JSON.parse(raw); } catch (e) { return false; }
    if (!S || !S.version) return false;
    // migrations / defaults
    const def = newState();
    for (const k in def) if (S[k] === undefined) S[k] = def[k];
    for (const k in def.settings) if (S.settings[k] === undefined) S.settings[k] = def.settings[k];
    for (const k in def.mats) if (S.mats[k] === undefined) S.mats[k] = 0;
    for (const k in def.buildings) if (S.buildings[k] === undefined) S.buildings[k] = 0;
    if (S.run) { for (const e of S.run.enemies) e.spec = D.ENEMIES[e.eid]; }
    return true;
  }
  function offlineProgress() {
    const now = Date.now(); const dt = Math.min(now - (S.lastSeen || now), 12 * 3600 * 1000);
    if (dt < 30000) return null;
    const hours = dt / 3600000;
    const rep = { hours, mineGold: 0, mineScrap: 0, floors: 0, ticks: 0, ended: null };
    if (S.buildings.mine) { rep.mineGold = Math.floor(S.buildings.mine * 25 * hours); rep.mineScrap = Math.floor(S.buildings.mine * 6 * hours); mineTick(hours); }
    if (S.run && guildLevel() >= 6 && S.settings.autoDescend) {
      const maxTicks = Math.min(Math.floor(dt / D.TICK_MS), 4 * 36000);
      const startFloor = S.run.floor; let ended = null;
      const h = (s) => { ended = s; };
      on('runend', h);
      for (let i = 0; i < maxTicks && S.run; i++) tick();
      listeners.runend = listeners.runend.filter((x) => x !== h);
      rep.ticks = maxTicks; rep.floors = (S.run ? S.run.floor : (ended ? ended.floor : startFloor)) - startFloor; rep.ended = ended;
    }
    S.lastSeen = now;
    return rep;
  }
  function resetAll() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* */ } S = null; }
  function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
  function importSave(str) { try { const obj = JSON.parse(decodeURIComponent(escape(atob(str.trim())))); if (!obj.version) return 'Invalid save.'; S = obj; load.call(null); localStorage.setItem(SAVE_KEY, JSON.stringify(S)); return null; } catch (e) { return 'Could not read that save.'; } }

  window.Game = {
    get S() { return S; }, D, C, on, emit, log, fmt,
    newGame, save, load, offlineProgress, resetAll, exportSave, importSave, tick,
    heroStats, heroSkills, heroPower, heroClass, itemStats, sellPrice, salvageYield, genItem,
    recruit, recruitCost, dismiss, toggleParty, partySizeCap, rosterCap, stashCap, classUnlocked,
    sellItem, salvageItem, equipItem, unequip, autoEquip, autoEquipAll, canEquip, findItem, itemScore,
    craft, craftCost, craftIlvl, upgrade, upgradeCost, upgradeCap, enchant, enchantCost,
    buildingCost, buildingAvailable, upgradeBuilding, collectMine, guildLevel,
    startRun, extract, descend, abandonRun, waystones, biomeFor, isBossFloor, difficultyMult,
    canAscend, ascensionReward, ascend, buyPerk, checkMilestones, xpToNext: C.xpToNext,
  };
})();
