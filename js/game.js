/* GRIMDELVE — core engine. No DOM access; UI subscribes to events.
 * Two theatres share one combat system: the overworld (zones explored on the surface) and dungeons (floors below).
 */
(function () {
  'use strict';
  const D = window.DATA;
  const SAVE_KEY = 'grimdelve_save_v1';
  const listeners = {};
  let S = null;

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
    enemyHP: (f) => 34 * Math.pow(f, 1.1) * Math.pow(1.06, f),
    enemyATK: (f) => 6.5 * Math.pow(f, 0.85) * Math.pow(1.048, f),
    enemyDEF: (f) => 2 + f * 1.0,
    gold: (f) => (3 + f * 1.6) * Math.pow(1.03, f),
    xp: (f) => (10 + f * 3.5) * Math.pow(1.028, f),
    itemScale: (ilvl) => (1 + 0.11 * ilvl) * Math.pow(1.03, ilvl),
    xpToNext: (lvl) => Math.floor(35 * Math.pow(lvl, 1.55) + 25 * lvl),
    mitigation: (def, lvl) => def / (def + 50 + 5 * (lvl || 1)),
  };
  const TICKS_PER_TILE = 3;
  const WORLD_TICKS_PER_TILE = 3;

  // ---------- state ----------
  function newState() {
    return {
      version: 2, created: Date.now(), lastSeen: Date.now(), name: 'GRIMDELVE',
      gold: 0, embers: 0,
      mats: { scrap: 0, leather: 0, essence: 0, bone_dust: 0, bile_gland: 0, glowcap: 0, hoarfrost: 0, hellsteel: 0, void_shard: 0 },
      heroes: [], party: [], stash: [],
      buildings: { tavern: 1, blacksmith: 0, market: 0, shrine: 0, alchemist: 0, vault: 0, mine: 0, library: 0, guild: 0 },
      unlocked: {}, maxFloor: 0, ascensions: 0, perks: {}, relics: [],
      settings: { autoDescend: true, autoExtractHp: 0.35, autoSell: 'none', autoSalvage: false, autoEquip: true, autoRestart: true, autoDelve: true, autoNextZone: true, speed: 1, stopAtFloor: 0, sfx: 0.8, music: 0.5 },
      stats: { kills: 0, runs: 0, wipes: 0, extractions: 0, goldEarned: 0, itemsFound: 0, bossKills: 0, deepest: 0, playTicks: 0, floorsCleared: 0, zones: 0, quests: 0, campsCleared: 0 },
      run: null, world: null, log: [], started: false, uid: 1, mineStock: { scrap: 0, gold: 0 }, ui: {}, wipeStreak: 0, restT: 0, maxZone: 1,
    };
  }

  // ---------- heroes & skills ----------
  function createHero(clsId, level) {
    const cls = D.CLASSES[clsId];
    const h = { uid: 'h' + (S.uid++), cls: clsId, name: cls.name, level: 1, xp: 0, equip: {}, kills: 0, skills: {}, points: 1, autoSkills: true };
    for (const s of D.SLOTS) h.equip[s] = null;
    while (h.level < (level || 1)) { h.level++; h.points++; }
    autoSpend(h);
    return h;
  }
  function heroClass(h) { return D.CLASSES[h.cls]; }
  const rank = (h, sid) => (h.skills && h.skills[sid]) || 0;
  function treeNode(h, sid) { return D.TREES[h.cls].find((n) => n.id === sid); }
  function pointsSpent(h) { let n = 0; for (const k in h.skills) n += h.skills[k]; return n; }
  function canSpend(h, sid) {
    const node = treeNode(h, sid); if (!node) return 'Not in this tree.';
    if (h.points <= 0) return 'No skill points.';
    if (h.level < D.TIER_LEVEL[node.tier - 1]) return `Requires level ${D.TIER_LEVEL[node.tier - 1]}.`;
    if (node.req && rank(h, node.req) < 1) return `Requires a point in ${D.SKILLS[node.req].name}.`;
    if (rank(h, sid) >= D.MAX_RANK) return 'Maxed.';
    return null;
  }
  function spendPoint(uid, sid) {
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return 'No hero.';
    const err = canSpend(h, sid); if (err) return err;
    h.skills[sid] = rank(h, sid) + 1; h.points--;
    emit('roster'); return null;
  }
  function autoSpend(h) {
    const build = D.BUILD[h.cls]; let guard = 0;
    while (h.points > 0 && guard++ < 200) {
      let best = null, bestScore = Infinity;
      build.forEach((sid, i) => { if (!canSpend(h, sid)) { const cap = i < 3 ? D.MAX_RANK : 10; const r = rank(h, sid); if (r < cap) { const score = r / cap + i * 0.01; if (score < bestScore) { bestScore = score; best = sid; } } } });
      if (!best) { best = build.find((sid) => canSpend(h, sid) === null) || null; if (!best) break; }
      h.skills[best] = rank(h, best) + 1; h.points--;
    }
  }
  function respecCost(h) { return Math.floor(50 * h.level * Math.pow(1.05, h.level)); }
  function respec(uid) {
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return 'No hero.';
    if (S.run && S.party.includes(uid)) return 'Not in the dungeon.';
    const c = respecCost(h); if (S.gold < c) return `Respec costs ${fmt(c)} gold.`;
    S.gold -= c; h.points += pointsSpent(h); h.skills = {}; if (h.autoSkills) autoSpend(h);
    emit('roster'); return null;
  }
  function toggleAutoSkills(uid) { const h = S.heroes.find((x) => x.uid === uid); if (!h) return; h.autoSkills = !h.autoSkills; if (h.autoSkills) autoSpend(h); emit('roster'); }
  function passiveStats(h) {
    const out = {};
    for (const node of D.TREES[h.cls]) { const sk = D.SKILLS[node.id]; if (sk.type !== 'passive') continue; const r = rank(h, node.id); if (!r) continue; out[sk.stat] = (out[sk.stat] || 0) + sk.per * r; }
    return out;
  }
  function partyPassive(stat) { let v = 0; for (const uid of S.party) { const h = S.heroes.find((x) => x.uid === uid); if (h) v += passiveStats(h)[stat] || 0; } return v; }
  function skillMult(h, sk, sid) {
    const r = Math.max(1, rank(h, sid));
    let syn = 0; if (sk.syn) for (const k in sk.syn) syn += rank(h, k) * sk.syn[k] / 100;
    return (1 + 0.1 * (r - 1)) * (1 + syn) * (1 + S.buildings.library * 0.05);
  }
  function skillDur(h, sk, sid) { return (sk.dur || (sk.buff && sk.buff.dur) || (sk.debuff && sk.debuff.dur) || 0) + Math.floor(rank(h, sid) / 5); }
  function globalBonus(stat) {
    let v = 0;
    for (const rid of S.relics) { const r = D.RELICS.find((x) => x.id === rid); if (r && r.stat === stat) v += r.val; }
    for (const p of D.ASCENSION_PERKS) { const rk = S.perks[p.id] || 0; if (rk && p.stat === stat) v += p.val * rk; }
    return v;
  }
  function itemStats(it) {
    const out = {};
    const rar = D.RARITIES[it.rarity];
    const scale = C.itemScale(it.ilvl) * rar.mult * (1 + 0.08 * (it.up || 0));
    const base = D.SLOT_BASE[it.slot];
    for (const k in base) {
      if (k === 'crit' || k === 'spd') out[k] = (out[k] || 0) + base[k] * (1 + 0.03 * it.ilvl) * rar.mult * (1 + 0.04 * (it.up || 0));
      else out[k] = (out[k] || 0) + base[k] * scale;
    }
    if (it.slot === 'weapon' && it.wtype) {
      const wt = D.WEAPON_TYPES[it.wtype];
      out.atk = (out.atk || 0) * wt.atk;
      if (wt.crit) out.crit = (out.crit || 0) + wt.crit;
      if (wt.def) out.def = (out.def || 0) + wt.def * scale * 0.5;
      if (wt.spd) out.spd = (out.spd || 0) + wt.spd;
      if (wt.hp) out.hp = (out.hp || 0) + wt.hp * scale * 0.5;
    }
    for (const a of it.affixes || []) { const def = D.AFFIXES.find((x) => x.id === a.id); if (!def) continue; out[def.stat] = (out[def.stat] || 0) + a.v; }
    return out;
  }
  function heroStats(h) {
    const cls = heroClass(h);
    const L = h.level - 1;
    const st = { hp: cls.base.hp + cls.grow.hp * L, atk: cls.base.atk + cls.grow.atk * L, def: cls.base.def + cls.grow.def * L,
      spd: cls.base.spd + cls.grow.spd * L, crit: cls.base.crit + cls.grow.crit * L, lifesteal: 0, gold: 0, xp: 0, loot: 0, thorns: 0, evade: 0, critdmg: 0, healpow: 0, dotpow: 0 };
    for (const s of D.SLOTS) { const it = h.equip[s]; if (!it) continue; const is = itemStats(it); for (const k in is) st[k] = (st[k] || 0) + is[k]; }
    const ps = passiveStats(h);
    const inParty = S.party.includes(h.uid);
    const hppct = (ps.hppct || 0) + (inParty ? partyPassive('party_hppct') : 0) + globalBonus('hppct');
    const defpct = (ps.defpct || 0) + (inParty ? partyPassive('party_defpct') : 0);
    st.hp *= 1 + hppct / 100;
    st.atk *= 1 + ((ps.atkpct || 0) + globalBonus('atkpct')) / 100;
    st.def *= 1 + defpct / 100;
    st.spd *= 1 + ((ps.spdpct || 0) + globalBonus('spdpct')) / 100;
    st.crit += (ps.crit || 0) + globalBonus('crit');
    st.lifesteal += (ps.lifesteal || 0) + globalBonus('lifesteal');
    st.evade += ps.evade || 0; st.critdmg += ps.critdmg || 0; st.healpow += ps.healpow || 0; st.dotpow += ps.dotpow || 0; st.thorns += ps.thorns || 0;
    st.gold += globalBonus('gold'); st.xp += globalBonus('xp'); st.loot += globalBonus('loot');
    st.lifesteal = Math.min(st.lifesteal, 60); st.evade = Math.min(st.evade, 50);
    for (const k in st) st[k] = Math.round(st[k] * 10) / 10;
    st.hp = Math.floor(st.hp);
    return st;
  }
  function heroSkills(h) { // active skills with at least one rank, strongest tier first
    return D.TREES[h.cls].filter((n) => D.SKILLS[n.id].type !== 'passive' && rank(h, n.id) > 0).sort((a, b) => b.tier - a.tier).map((n) => ({ id: n.id, sk: D.SKILLS[n.id] }));
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
    if (S.party.length < partySizeCap() && !S.run && !inCombat()) { S.party.push(h.uid); syncWorldParty(); }
    log(`${h.name} joins the company at level ${h.level}.`, 'good');
    emit('roster');
    return null;
  }
  function dismiss(uid) {
    if (S.run || inCombat()) return 'Not while fighting.';
    if (S.heroes.length <= 1) return 'You need at least one hero.';
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return 'No such hero';
    for (const s of D.SLOTS) if (h.equip[s]) { addToStash(h.equip[s]); h.equip[s] = null; }
    S.heroes = S.heroes.filter((x) => x.uid !== uid);
    S.party = S.party.filter((x) => x !== uid);
    if (S.party.length === 0) S.party.push(S.heroes[0].uid);
    syncWorldParty(); emit('roster');
    return null;
  }
  function toggleParty(uid) {
    if (S.run) return 'Cannot change the party in the dungeon.';
    if (inCombat()) return 'Not while fighting.';
    const i = S.party.indexOf(uid);
    if (i >= 0) { if (S.party.length === 1) return 'The party needs at least one hero.'; S.party.splice(i, 1); }
    else { if (S.party.length >= partySizeCap()) return 'Party is full.'; S.party.push(uid); }
    syncWorldParty(); emit('roster');
    return null;
  }
  function giveXp(h, amount) {
    const bonus = 1 + (S.buildings.library * 0.1) + heroStats(h).xp / 100 + S.ascensions * 0.2;
    h.xp += Math.floor(amount * bonus);
    let leveled = false;
    while (h.xp >= C.xpToNext(h.level)) {
      h.xp -= C.xpToNext(h.level); h.level++; h.points = (h.points || 0) + 1; leveled = true;
      if (h.autoSkills) autoSpend(h);
      log(`${h.name} reaches level ${h.level}.`, 'level');
      emit('levelup', { hero: h });
      const B = cur(); if (B) { const rp = B.party.find((p) => p.uid === h.uid); if (rp && rp.alive) { const st = heroStats(h); rp.maxhp = st.hp; rp.hp = Math.min(rp.maxhp, rp.hp + Math.floor(st.hp * 0.25)); } }
    }
    return leveled;
  }

  // ---------- items (Diablo-style rarity: white is the norm, colour is rare) ----------
  function genItem(ilvl, opts) {
    opts = opts || {};
    ilvl = Math.max(1, Math.floor(ilvl));
    const luck = 1 + (opts.luck || 0) / 100;
    const maxR = (S.maxFloor >= 50 || S.ascensions > 0) ? 5 : ilvl >= 25 ? 4 : 3;
    let rIdx = D.RARITIES.indexOf(weighted(D.RARITIES.slice(0, maxR + 1), (r) => {
      const idx = D.RARITIES.indexOf(r);
      return idx === 0 ? r.weight : r.weight * luck * (1 + ilvl * 0.012);
    }));
    if (opts.minRarity != null) rIdx = Math.max(rIdx, opts.minRarity);
    if (opts.boost && chance(opts.boost)) rIdx = Math.min(maxR, rIdx + 1);
    const slot = opts.slot || pick(D.SLOTS);
    const rar = D.RARITIES[rIdx];
    const it = { id: 'i' + (S.uid++), slot, ilvl, rarity: rIdx, up: 0, affixes: [], wtype: null, name: '' };
    if (slot === 'weapon') it.wtype = opts.wtype || pick(Object.keys(D.WEAPON_TYPES));
    const pool = D.AFFIXES.slice();
    for (let i = 0; i < rar.affixes && pool.length; i++) { const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; it.affixes.push({ id: a.id, v: rollAffix(a, ilvl, rIdx) }); }
    nameItem(it);
    return it;
  }
  function rollAffix(a, ilvl, rIdx) {
    let v = (a.flat + a.per * ilvl) * (0.7 + Math.random() * 0.6) * (1 + rIdx * 0.15);
    if (a.pct) v = Math.min(a.max, v);
    else if (a.stat === 'crit' || a.stat === 'spd') v *= 1;
    else v *= C.itemScale(ilvl) / (1 + 0.11 * ilvl);
    return Math.round(v * 10) / 10;
  }
  function nameItem(it) {
    const rar = D.RARITIES[it.rarity];
    const prefix = pick(D.ITEM_PREFIX[rar.id]);
    const noun = it.slot === 'weapon' ? D.WEAPON_TYPES[it.wtype].name : pick(D.ITEM_NOUN[it.slot]);
    const suffix = it.affixes.length ? ' ' + D.AFFIXES.find((a) => a.id === it.affixes[0].id).name : '';
    it.name = `${prefix} ${noun}${suffix}`;
  }
  function sellPrice(it) { return Math.floor((4 + it.ilvl * 2.4 * Math.pow(1.03, it.ilvl)) * D.RARITIES[it.rarity].sell * (1 + S.buildings.market * 0.12) * (1 + it.up * 0.1)); }
  function salvageYield(it) {
    const y = { scrap: Math.max(1, Math.round(2 + it.ilvl / 3)) };
    if (['head', 'chest', 'hands', 'feet'].includes(it.slot)) y.leather = Math.max(1, Math.round(it.ilvl / 6));
    if (it.rarity >= 2) y.essence = it.rarity - 1;
    if (it.up) y.scrap += it.up * 2;
    return y;
  }
  function addToStash(it) {
    if (S.stash.length >= stashCap()) { const g = sellPrice(it); S.gold += g; log(`Stash full — ${it.name} sold for ${g} gold.`, 'warn'); return false; }
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
    if (S.run && S.party.includes(uid)) return 'Cannot change gear in the dungeon.';
    removeItem(id);
    const old = h.equip[f.item.slot];
    h.equip[f.item.slot] = f.item;
    if (old) addToStash(old);
    syncWorldParty(); emit('inv'); return null;
  }
  function unequip(uid, slot) { const h = S.heroes.find((x) => x.uid === uid); if (!h || !h.equip[slot]) return; if (S.run && S.party.includes(uid)) return 'Cannot change gear in the dungeon.'; addToStash(h.equip[slot]); h.equip[slot] = null; syncWorldParty(); emit('inv'); }
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
    const it = genItem(craftIlvl(), { slot, luck: 150 + S.buildings.blacksmith * 30, boost, minRarity: 1 });
    addToStash(it);
    log(`Forged ${it.name}.`, 'loot'); emit('inv'); emit('crafted', it);
    return null;
  }
  function upgradeCap() { return 3 + S.buildings.blacksmith * 2; }
  function upgradeCost(it) { const n = it.up + 1; return { gold: Math.floor((15 + it.ilvl * 6) * Math.pow(1.45, n) * Math.pow(1.03, it.ilvl)), scrap: Math.floor(2 + n * 2 + it.ilvl / 8) }; }
  function upgrade(id) {
    const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot upgrade that.';
    if (f.item.up >= upgradeCap()) return 'Upgrade cap reached. Improve the Blacksmith.';
    if (S.run && f.where === 'hero' && S.party.includes(f.hero.uid)) return 'Cannot upgrade gear in the dungeon.';
    const c = upgradeCost(f.item);
    if (S.gold < c.gold) return 'Not enough gold.'; if (S.mats.scrap < c.scrap) return 'Not enough scrap.';
    S.gold -= c.gold; S.mats.scrap -= c.scrap; f.item.up++;
    syncWorldParty(); emit('inv'); return null;
  }
  function enchantCost(it) { return 2 + it.rarity * 2; }
  function enchant(id) {
    if (!S.unlocked.enchant) return 'Enchanting is not unlocked.';
    const f = findItem(id); if (!f || f.where === 'bag') return 'Cannot enchant that.';
    if (S.run && f.where === 'hero' && S.party.includes(f.hero.uid)) return 'Cannot enchant gear in the dungeon.';
    const it = f.item; const rar = D.RARITIES[it.rarity];
    if (rar.affixes === 0) return 'Common gear has no affixes to reroll.';
    const cost = enchantCost(it); if (S.mats.essence < cost) return `Need ${cost} Dark Essence.`;
    S.mats.essence -= cost;
    const pool = D.AFFIXES.slice(); it.affixes = [];
    for (let i = 0; i < rar.affixes; i++) { const a = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; it.affixes.push({ id: a.id, v: rollAffix(a, it.ilvl, it.rarity) * 1.1 }); }
    nameItem(it); syncWorldParty(); emit('inv'); return null;
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

  // ---------- battle context (dungeon run or overworld encounter) ----------
  function cur() { if (S.run) return S.run; const Wd = S.world; if (Wd && Wd.phase === 'combat' && Wd.enc) return Wd.enc; return null; }
  function inCombat() { return !!(S.world && S.world.phase === 'combat'); }
  function makePartyState(uids) { return uids.map((uid) => { const h = S.heroes.find((x) => x.uid === uid); const st = heroStats(h); return { uid, hp: st.hp, maxhp: st.hp, shield: 0, ap: Math.random() * 50, cds: {}, buffs: [], alive: true, taunt: 0, stun: 0, dots: [], target: null }; }); }
  function makeEnemy(eid, level, isBoss, cycle, scale) {
    const e = D.ENEMIES[eid];
    const hpB = C.enemyHP(level) * difficultyMult() * (1 + (cycle || 0) * 0.5) * (scale || 1), atkB = C.enemyATK(level) * difficultyMult() * (1 + (cycle || 0) * 0.3), defB = C.enemyDEF(level);
    const hp = Math.floor(hpB * e.hp * (0.9 + Math.random() * 0.2));
    return { id: 'e' + (S.uid++), eid, name: e.name + (cycle > 0 ? ' ' + 'I'.repeat(cycle + 1).replace('IIII', 'IV') : ''), img: e.img, hp, maxhp: hp, atk: atkB * e.atk, def: defB * e.def, spd: 8 * e.spd, ap: Math.random() * 40, alive: true, boss: !!isBoss, buffs: [], dots: [], stun: 0, shield: 0, spec: e, shake: 0, level, ox: Math.random(), oy: Math.random(), target: null };
  }

  // ---------- dungeon run ----------
  function biomeFor(floor) { const idx = Math.floor((floor - 1) / D.FLOORS_PER_BIOME); return { biome: D.BIOMES[idx % D.BIOMES.length], cycle: Math.floor(idx / D.BIOMES.length) }; }
  function isBossFloor(f) { return f % D.BOSS_EVERY === 0; }
  function difficultyMult() { return 1 + S.ascensions * 0.3; }
  function mainRooms(floor) { return D.ROOMS_PER_FLOOR + (isBossFloor(floor) ? 1 : 0); }
  function newFloorMap() {
    const R = S.run; R.seed = Math.floor(Math.random() * 1e9);
    R.map = window.Dungeon.generate(R.floor, mainRooms(R.floor), R.seed);
    R.room = 0; R.phase = 'travel'; R.travelT = 0; R.doorOpen = false; R.next = makeEncounter(1); R.encDone = 0;
  }
  function makeEncounter(stopIdx) {
    const R = S.run; const stop = R.map.route[stopIdx]; if (!stop || !stop.enc) return [];
    const f = R.floor; const { biome, cycle } = biomeFor(f);
    const list = [];
    if (stop.boss) { list.push(makeEnemy(biome.boss, f, true, cycle)); const adds = 1 + Math.min(3, Math.floor(f / 15)); for (let i = 0; i < adds; i++) list.push(makeEnemy(pick(biome.enemies), f, false, cycle)); }
    else if (stop.side) { const n = 1 + rint(0, Math.min(3, 1 + Math.floor(f / 10))); for (let i = 0; i < n; i++) list.push(makeEnemy(pick(biome.enemies), f, false, cycle)); }
    else { const n = clamp(2 + rint(0, 2 + Math.min(4, Math.floor(f / 6))), 2, 8); for (let i = 0; i < n; i++) list.push(makeEnemy(pick(biome.enemies), f, false, cycle)); }
    return list;
  }
  function travelNeed() { const R = S.run; const seg = R.map.segs[R.room + 1]; return seg ? Math.max(6, seg.path.length * TICKS_PER_TILE) : 10; }
  function currentSeg() { const R = S.run; return R && R.map ? R.map.segs[R.room + 1] : null; }
  function startRun(startFloor, auto, entrance) {
    if (S.run) return 'A run is already in progress.';
    if (S.party.length === 0) return 'Pick a party first.';
    startFloor = startFloor || 1;
    if (!auto) S.wipeStreak = 0;
    S.ui.startFloor = startFloor;
    startFloor += (S.perks.legacy_depth || 0) * D.ASCENSION_PERKS.find((p) => p.id === 'legacy_depth').val;
    const party = makePartyState(S.party);
    if (S.world && S.world.party) for (const p of party) { const wp = S.world.party.find((x) => x.uid === p.uid); if (wp) { p.hp = Math.min(p.maxhp, Math.max(Math.floor(p.maxhp * 0.3), wp.hp)); } }
    S.run = { floor: startFloor, startFloor, room: 0, phase: 'travel', travelT: 0, party, enemies: [], bag: [], gold: 0, xp: 0, kills: 0, potions: S.buildings.alchemist, tick: 0, floorsCleared: 0, waitT: 0, bossFloorsCleared: 0, entrance: entrance || null, zone: S.world ? S.world.zone : 1 };
    newFloorMap();
    S.stats.runs++;
    log(`The company descends. Floor ${startFloor}: ${biomeFor(startFloor).biome.name}.`, 'run');
    emit('runstart'); return null;
  }
  function arriveAtStop() {
    const R = S.run; R.room++; R.travelT = 0;
    const stop = R.map.route[R.room];
    if (stop.enc) { R.enemies = R.next || makeEncounter(R.room); R.next = null; R.phase = 'combat'; emit('encounter', { boss: !!stop.boss, enemies: R.enemies, side: !!stop.side }); }
    else if (R.room >= R.map.route.length - 1) floorCleared();
    else { R.phase = 'travel'; R.doorOpen = false; R.next = makeEncounter(R.room + 1); emit('roomclear'); }
  }
  function afterRoomCleared() {
    const R = S.run; const stop = R.map.route[R.room];
    R.encDone++;
    if (stop.side) { // alcove chest
      const f = R.floor; const lootBonus = partyLoot(R);
      const g = Math.floor(C.gold(f) * 2 * rnd(0.8, 1.3) * (1 + S.ascensions * 0.3)); R.gold += g;
      const it = genItem(f + 1, { luck: 60 + lootBonus, minRarity: 1 }); R.bag.push(it); S.stats.itemsFound++;
      log(`Alcove chest: ${it.name} and ${g} gold.`, 'loot'); emit('chest', { item: it, gold: g });
    }
    if (R.room >= R.map.route.length - 1) floorCleared();
    else { R.phase = 'travel'; R.travelT = 0; R.doorOpen = false; R.next = makeEncounter(R.room + 1); for (const p of R.party) if (p.alive) heal(p, p.maxhp * 0.03, true); emit('roomclear'); }
  }
  function partyLoot(B) { return Math.max(...B.party.filter((p) => p.alive).map((p) => heroStats(heroOf(p)).loot), 0); }

  // combatant helpers
  function effStat(c, stat) {
    let base;
    if (c.uid) { const st = heroStats(heroOf(c)); base = st[stat] || 0; }
    else base = c[stat] || 0;
    let mult = 1;
    for (const b of c.buffs) if (b[stat]) mult += b[stat];
    return base * mult;
  }
  function hasBuff(c, k) { return c.buffs.some((b) => b[k]); }
  function buffVal(c, k) { let v = 0; for (const b of c.buffs) if (b[k]) v += b[k]; return v; }
  function heroOf(c) { return S.heroes.find((h) => h.uid === c.uid); }
  function label(c) { return c.uid ? heroOf(c).name : c.name; }
  function battleLevel(B) { return B.floor || 1; }

  function dealDamage(src, tgt, raw, opts) {
    opts = opts || {};
    const B = cur(); if (!B || !tgt.alive) return 0;
    if (tgt.uid) { const ev = heroStats(heroOf(tgt)).evade / 100 + buffVal(tgt, 'evade'); if (ev > 0 && chance(Math.min(0.75, ev))) { emit('float', { id: tgt.uid, text: 'evade', kind: 'miss' }); return 0; } }
    if (!tgt.uid && tgt.spec.evade && chance(tgt.spec.evade)) { emit('float', { id: tgt.id, text: 'miss', kind: 'miss' }); return 0; }
    const def = effStat(tgt, 'def');
    let dmg = raw * (1 - C.mitigation(def, battleLevel(B)));
    if (opts.true) dmg = raw;
    dmg *= 1 + buffVal(tgt, 'vuln');
    if (tgt.uid) {
      const h = heroOf(tgt);
      if (h.cls === 'knight' && tgt.hp < tgt.maxhp * 0.5) dmg *= 0.8;
      if (B.party.some((p) => p.alive && p.uid !== tgt.uid && heroOf(p).cls === 'paladin')) dmg *= 0.9;
    }
    let crit = false;
    if (src && !opts.noCrit) {
      const cc = (src.uid ? effStat(src, 'crit') : 5) + (opts.critBonus || 0);
      if (chance(cc / 100)) { crit = true; dmg *= (src.uid && heroOf(src).cls === 'rogue' ? 2.0 : 1.5) + (src.uid ? heroStats(heroOf(src)).critdmg / 100 : 0); }
    }
    dmg = Math.max(1, Math.floor(dmg));
    if (tgt.shield > 0) { const a = Math.min(tgt.shield, dmg); tgt.shield -= a; dmg -= a; if (a) emit('float', { id: tgt.uid || tgt.id, text: '-' + a, kind: 'shield' }); }
    tgt.hp -= dmg;
    tgt.shake = 4;
    emit('float', { id: tgt.uid || tgt.id, text: String(dmg), kind: crit ? 'crit' : (tgt.uid ? 'hurt' : 'dmg') });
    if (src && src.uid) {
      const st = heroStats(heroOf(src));
      const ls = st.lifesteal / 100 + buffVal(src, 'lifesteal') + (opts.lifesteal || 0);
      if (ls > 0) heal(src, dmg * ls, true);
      if (B.party.some((p) => p.alive && heroOf(p).cls === 'necromancer') && tgt.hp < tgt.maxhp * 0.5) for (const p of B.party) if (p.alive) heal(p, dmg * 0.08, true);
    }
    if (tgt.uid && src && !src.uid) { const st = heroStats(heroOf(tgt)); if (st.thorns > 0) { const th = Math.floor(dmg * st.thorns / 100); if (th > 0) { src.hp -= th; emit('float', { id: src.id, text: th, kind: 'dmg' }); if (src.hp <= 0) killEnemy(src); } } }
    if (tgt.hp <= 0) { if (tgt.uid) killHero(tgt); else killEnemy(tgt); }
    return dmg;
  }
  function heal(c, amount, quiet) {
    if (!c.alive) return; amount = Math.floor(amount); if (amount <= 0) return;
    const before = c.hp; c.hp = Math.min(c.maxhp, c.hp + amount);
    if (!quiet && c.hp - before > 0) emit('float', { id: c.uid || c.id, text: '+' + (c.hp - before), kind: 'heal' });
  }
  function killHero(p) {
    const B = cur();
    p.alive = false; p.hp = 0; p.buffs = []; p.dots = [];
    log(`${label(p)} falls.`, 'bad'); emit('death', { id: p.uid });
    if (B && !B.party.some((x) => x.alive)) { if (S.run) partyWipe(); else worldWipe(); }
  }
  function killEnemy(e) {
    const B = cur(); if (!e.alive || !B) return;
    e.alive = false; e.hp = 0; B.kills++; S.stats.kills++;
    const f = battleLevel(B);
    const alive = B.party.filter((p) => p.alive);
    const goldBonus = 1 + Math.max(...alive.map((p) => heroStats(heroOf(p)).gold), 0) / 100 + S.ascensions * 0.3;
    const lootBonus = Math.max(...alive.map((p) => heroStats(heroOf(p)).loot), 0);
    const deep = f >= 100 ? 2 : 1;
    const g = Math.floor(C.gold(f) * (e.boss ? 8 : 1) * goldBonus * rnd(0.8, 1.2) * deep);
    B.gold += g;
    const xp = C.xp(f) * (e.boss ? 6 : 1);
    for (const p of B.party) giveXp(heroOf(p), p.alive ? xp : xp * 0.5);
    if (e.boss) { S.stats.bossKills++; log(`${e.name} is destroyed.`, 'boss'); }
    const dropChance = (e.boss ? 1 : 0.14 + f * 0.001) * (1 + lootBonus / 100);
    if (chance(dropChance)) {
      const it = genItem(f + (e.boss ? 3 : 0) + (deep > 1 ? 5 : 0), { luck: (lootBonus + (e.boss ? 120 : 0)) * deep, minRarity: e.boss ? 1 : null });
      B.bag.push(it); S.stats.itemsFound++;
      emit('loot', { item: it, id: e.id });
      if (it.rarity >= 2) log(`Found ${it.name}!`, 'loot');
    }
    if (chance(e.boss ? 1 : 0.1)) { const mat = S.run ? biomeFor(f).biome.material : D.BIOMES[Math.min(D.BIOMES.length - 1, Math.floor((f - 1) / D.FLOORS_PER_BIOME))].material; B.mats = B.mats || {}; B.mats[mat] = (B.mats[mat] || 0) + (e.boss ? 3 : 1); }
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
    S.stats.wipes++; S.wipeStreak = (S.wipeStreak || 0) + 1;
    if (S.wipeStreak === 3 && guildLevel() >= 6) log('Three wipes in a row. The Guild halts automatic runs until you send the company out yourself.', 'warn');
    const keep = S.buildings.shrine * 0.08;
    const kept = R.bag.filter(() => chance(keep));
    const goldKept = Math.floor(R.gold * 0.4);
    for (const it of kept) addToStash(it);
    S.gold += goldKept; S.stats.goldEarned += goldKept;
    const summary = { type: 'wipe', floor: R.floor, kills: R.kills, gold: goldKept, goldLost: R.gold - goldKept, items: kept.length, itemsLost: R.bag.length - kept.length, floors: R.floorsCleared, entrance: R.entrance };
    log(`The company is wiped out on floor ${R.floor}. ${kept.length} of ${R.bag.length} items recovered.`, 'bad');
    S.run = null;
    returnToSurface(true);
    emit('runend', summary);
    return summary;
  }
  function extract() {
    const R = S.run; if (!R) return 'No run.';
    if (R.phase !== 'floorclear' && R.phase !== 'travel') return 'Can only extract after clearing a floor.';
    S.stats.extractions++; S.wipeStreak = 0;
    let sold = 0, salvaged = 0, kept = 0;
    for (const it of R.bag) {
      if (S.settings.autoSell !== 'none' && guildLevel() >= 3 && shouldAutoSell(it)) { if (S.settings.autoSalvage && guildLevel() >= 4) { const y = salvageYield(it); for (const k in y) S.mats[k] = (S.mats[k] || 0) + y[k]; salvaged++; } else { S.gold += sellPrice(it); sold++; } }
      else { addToStash(it); kept++; }
    }
    S.gold += R.gold; S.stats.goldEarned += R.gold;
    if (R.mats) for (const k in R.mats) S.mats[k] = (S.mats[k] || 0) + R.mats[k];
    const summary = { type: 'extract', floor: R.floor - (R.phase === 'floorclear' ? 0 : 1), kills: R.kills, gold: R.gold, items: R.bag.length, kept, sold, salvaged, floors: R.floorsCleared, mats: R.mats || {}, entrance: R.entrance };
    log(`Extracted from floor ${summary.floor} with ${R.bag.length} items and ${fmt(R.gold)} gold.`, 'good');
    const hpMap = {}; for (const p of R.party) hpMap[p.uid] = p.alive ? p.hp / p.maxhp : 0.25;
    S.run = null;
    if (S.settings.autoEquip && guildLevel() >= 5) autoEquipAll();
    returnToSurface(false, hpMap, R.entrance);
    emit('runend', summary);
    return null;
  }
  function shouldAutoSell(it) { const order = ['none', 'common', 'uncommon', 'rare']; const idx = order.indexOf(S.settings.autoSell); return idx > 0 && it.rarity <= idx - 1; }
  function descend() {
    const R = S.run; if (!R || R.phase !== 'floorclear') return 'Not at a floor exit.';
    R.floor++;
    newFloorMap();
    const { biome } = biomeFor(R.floor);
    if ((R.floor - 1) % D.FLOORS_PER_BIOME === 0) log(`Floor ${R.floor}: ${biome.name}. ${biome.flavor}`, 'run');
    emit('floor', { floor: R.floor });
    return null;
  }
  function usePotionIfNeeded(B) {
    if (B.potions <= 0) return;
    const low = B.party.filter((p) => p.alive && p.hp < p.maxhp * 0.35);
    if (!low.length) return;
    B.potions--; const healPct = 0.3 + S.buildings.alchemist * 0.05;
    for (const p of low) heal(p, p.maxhp * healPct);
    log(`A potion is used. ${B.potions} left.`, ''); emit('potion');
  }

  // choose & perform hero action
  function heroAct(p) {
    const B = cur(); const h = heroOf(p); const cls = heroClass(h);
    if (p.stun > 0) { p.stun--; return; }
    tickDots(p);
    if (!p.alive) return;
    p.buffs = p.buffs.filter((b) => --b.dur > 0);
    if (p.taunt > 0) p.taunt--;
    for (const k in p.cds) if (p.cds[k] > 0) p.cds[k]--;
    if (cls.id === 'priest') for (const q of B.party) if (q.alive) heal(q, q.maxhp * 0.01, true);
    const enemies = B.enemies.filter((e) => e.alive); if (!enemies.length) return;
    const allies = B.party.filter((q) => q.alive);
    const st = heroStats(h);
    const atk = effStat(p, 'atk');
    const healpow = 1 + st.healpow / 100, dotpow = 1 + st.dotpow / 100;
    const pickTarget = () => {
      if (cls.id === 'ranger') { const t = enemies.reduce((a, b) => (a.hp < b.hp ? a : b)); p.target = t.id; return t; }
      if (cls.id === 'rogue') { const t = enemies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)); p.target = t.id; return t; }
      const keep = enemies.find((e) => e.id === p.target); if (keep) return keep; // stick with the chosen foe
      const t = chance(0.6) ? enemies[0] : pick(enemies); p.target = t.id; return t;
    };
    for (const { id: sid, sk } of heroSkills(h)) {
      if ((p.cds[sid] || 0) > 0) continue;
      let used = false; const m = (sk.mult || 0) * skillMult(h, sk, sid); const dur = skillDur(h, sk, sid);
      switch (sk.type) {
        case 'dmg': { const t = pickTarget(); let raw = atk * m; if (sk.execute && t.hp < t.maxhp * sk.execute) raw *= 3; if (sk.vs && t.spec.family === sk.vs) raw *= 2; if (sk.selfdmg) { p.hp = Math.max(1, p.hp - Math.floor(p.maxhp * sk.selfdmg)); }
          if (cls.id === 'pyromancer' && t.dots.some((d) => d.burn)) raw *= 1.25;
          if (cls.id === 'berserker') raw *= 1 + (1 - p.hp / p.maxhp);
          dealDamage(p, t, raw, { critBonus: sk.critBonus, lifesteal: sk.lifesteal }); if (sk.stun && t.alive) t.stun = sk.stun; if (sk.burn && t.alive) t.dots.push({ v: atk * 0.3 * dotpow, dur: sk.burn, burn: true });
          if (sk.splash) for (const o of enemies) if (o !== t && o.alive) { dealDamage(p, o, raw * sk.splash); if (sk.burn && o.alive) o.dots.push({ v: atk * 0.2 * dotpow, dur: sk.burn, burn: true }); }
          used = true; break; }
        case 'aoe': { for (const t of enemies) { let raw = atk * m; if (cls.id === 'pyromancer' && t.dots.some((d) => d.burn)) raw *= 1.25; if (cls.id === 'berserker') raw *= 1 + (1 - p.hp / p.maxhp); dealDamage(p, t, raw, { lifesteal: sk.lifesteal }); if (sk.burn && t.alive) t.dots.push({ v: atk * 0.25 * dotpow, dur: sk.burn, burn: true }); if (sk.stun && t.alive) t.stun = sk.stun; } if (sk.healall) for (const q of allies) heal(q, q.maxhp * sk.healall * healpow); used = true; break; }
        case 'dot': { const t = pickTarget(); t.dots.push({ v: atk * m * dotpow, dur: dur, burn: cls.id === 'pyromancer' }); emit('float', { id: t.id, text: cls.id === 'pyromancer' ? 'burning' : 'poisoned', kind: 'status' }); used = true; break; }
        case 'dotall': { for (const t of enemies) t.dots.push({ v: atk * m * dotpow, dur: dur }); used = true; break; }
        case 'heal': { const w = allies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)); if (w.hp / w.maxhp < 0.65) { heal(w, atk * m * healpow); used = true; } break; }
        case 'healself': { if (p.hp / p.maxhp < 0.5) { heal(p, p.maxhp * m * healpow); if (sk.buff) p.buffs.push({ ...sk.buff, dur }); used = true; } break; }
        case 'shield': { if (p.shield < p.maxhp * 0.1 && p.hp / p.maxhp < 0.85) { p.shield = Math.floor(p.maxhp * m); emit('float', { id: p.uid, text: 'shield', kind: 'status' }); used = true; } break; }
        case 'shieldall': { if (allies.some((q) => q.shield <= 0 && q.hp / q.maxhp < 0.9)) { for (const q of allies) q.shield = Math.max(q.shield, Math.floor(q.maxhp * m)); emit('float', { id: p.uid, text: 'ward', kind: 'status' }); used = true; } break; }
        case 'taunt': { if (allies.length > 1 && p.hp / p.maxhp > 0.3) { p.taunt = dur; emit('float', { id: p.uid, text: 'taunt', kind: 'status' }); used = true; } break; }
        case 'selfbuff': { if (!hasBuff(p, Object.keys(sk.buff)[0])) { p.buffs.push({ ...sk.buff, dur }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'buffall': { const key = Object.keys(sk.buff)[0]; if (!hasBuff(p, key)) { for (const q of allies) q.buffs.push({ ...sk.buff, dur }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'debuff': { const t = pickTarget(); if (!hasBuff(t, Object.keys(sk.debuff)[0])) { dealDamage(p, t, atk * m); if (t.alive) t.buffs.push({ ...sk.debuff, dur }); used = true; } break; }
        case 'debuffall': { if (!enemies.some((e) => hasBuff(e, 'atk'))) { for (const t of enemies) t.buffs.push({ ...sk.debuff, dur }); emit('float', { id: p.uid, text: sk.name, kind: 'status' }); used = true; } break; }
        case 'cleanse': { if (allies.some((q) => q.dots.length || q.buffs.some((b) => b.spd < 0)) || allies.some((q) => q.hp / q.maxhp < 0.5)) { for (const q of allies) { q.dots = []; q.buffs = q.buffs.filter((b) => !(b.spd < 0 || b.atk < 0)); heal(q, q.maxhp * 0.05 * healpow); } used = true; } break; }
        case 'revive': { const dead = B.party.find((q) => !q.alive); if (dead) { dead.alive = true; dead.hp = Math.floor(dead.maxhp * m); dead.ap = 0; log(`${label(dead)} is dragged back to life.`, 'good'); emit('revive', { id: dead.uid }); used = true; } break; }
      }
      if (used) { p.cds[sid] = Math.max(1, sk.cd - Math.floor(rank(h, sid) / 10)); emit('skill', { id: p.uid, name: sk.name, sid, target: p.target }); return; }
    }
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
    const B = cur();
    if (e.stun > 0) { e.stun--; return; }
    tickDots(e); if (!e.alive) return;
    e.buffs = e.buffs.filter((b) => --b.dur > 0);
    if (e.spec.regen) heal(e, e.maxhp * e.spec.regen, true);
    const alive = B.party.filter((p) => p.alive); if (!alive.length) return;
    const sp = e.spec;
    if (sp.heals && chance(0.3)) { const w = B.enemies.filter((x) => x.alive).reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)); if (w.hp < w.maxhp * 0.7) { heal(w, w.maxhp * 0.15); emit('skill', { id: e.id, name: 'Mend', target: w.id }); return; } }
    if (sp.summons && chance(0.25) && B.enemies.filter((x) => x.alive).length < 6) { const add = makeEnemy(sp.summons, battleLevel(B), false, 0, 0.6); B.enemies.push(add); emit('encounter', { boss: false, enemies: B.enemies, add: true }); return; }
    const atk = effStat(e, 'atk');
    const taunter = alive.find((p) => p.taunt > 0);
    let target = taunter || alive.find((p) => p.uid === e.target);
    if (!target) { target = chance(0.55) ? alive[0] : pick(alive); }
    e.target = target.uid;
    if (sp.aoe && chance(0.3)) { for (const p of alive) dealDamage(e, p, atk * 0.7); emit('attack', { id: e.id, target: 'all' }); return; }
    const dmg = dealDamage(e, target, atk);
    emit('attack', { id: e.id, target: target.uid });
    if (!target.alive) return;
    if (sp.poison && chance(sp.poison)) target.dots.push({ v: atk * 0.25, dur: 3 });
    if (sp.burn && chance(sp.burn)) target.dots.push({ v: atk * 0.3, dur: 2, burn: true });
    if (sp.slow && chance(sp.slow) && !hasBuff(target, 'spd')) target.buffs.push({ spd: -0.3, dur: 2 });
    if (sp.lifesteal && dmg > 0) heal(e, dmg * sp.lifesteal, true);
  }
  // one combat tick for a battle context; returns true when all enemies are dead
  function combatTick(B) {
    usePotionIfNeeded(B);
    const all = [...B.party, ...B.enemies];
    for (const c of all) {
      if (!c.alive) continue;
      c.ap += effStat(c, 'spd') * 0.55;
      if (c.ap >= 100) { c.ap -= 100; if (c.uid) heroAct(c); else enemyAct(c); if (!cur()) return false; }
      if (c.shake > 0) c.shake--;
    }
    return !B.enemies.some((e) => e.alive);
  }

  function floorCleared() {
    const R = S.run;
    R.floorsCleared++; S.stats.floorsCleared = (S.stats.floorsCleared || 0) + 1;
    if (isBossFloor(R.floor)) R.bossFloorsCleared++;
    if (R.floor > S.maxFloor) { S.maxFloor = R.floor; S.stats.deepest = R.floor; checkMilestones(); }
    if (R.entrance && S.world) questProgress('delve', { entrance: R.entrance, floor: R.floor });
    const f = R.floor;
    const lootBonus = partyLoot(R);
    const g = Math.floor(C.gold(f) * 3 * rnd(0.8, 1.3) * (1 + S.ascensions * 0.3)); R.gold += g;
    const chest = { gold: g, items: [] };
    const it = genItem(f + 1, { luck: lootBonus + 20, minRarity: isBossFloor(f) ? 1 : null }); R.bag.push(it); chest.items.push(it); S.stats.itemsFound++;
    if (chance(0.25 + lootBonus / 200)) { const it2 = genItem(f + 1, { luck: lootBonus + 20 }); R.bag.push(it2); chest.items.push(it2); S.stats.itemsFound++; }
    const mat = biomeFor(f).biome.material; R.mats = R.mats || {}; R.mats[mat] = (R.mats[mat] || 0) + 1; chest.mat = mat;
    const restPct = 0.2 + S.buildings.shrine * 0.04;
    for (const p of R.party) if (p.alive) { heal(p, p.maxhp * restPct, true); p.dots = []; p.buffs = p.buffs.filter((b) => !(b.spd < 0 || b.atk < 0)); }
    if (S.buildings.shrine >= 4) for (const p of R.party) if (!p.alive) { p.alive = true; p.hp = Math.floor(p.maxhp * 0.25); p.ap = 0; p.cds = {}; log(`${label(p)} rises at the Shrine's call.`, 'good'); emit('revive', { id: p.uid }); }
    R.phase = 'floorclear'; R.waitT = 0;
    log(`Floor ${f} cleared. Chest: ${chest.items[0].name}. Extract or go deeper?`, 'run');
    emit('floorclear', { floor: f, chest, next: biomeFor(f + 1).biome, newBiome: f % D.FLOORS_PER_BIOME === 0 });
  }

  function runTick() {
    const R = S.run;
    R.tick++;
    if (R.phase === 'travel') {
      R.travelT++;
      const seg = currentSeg(); const need = travelNeed();
      if (seg && !R.doorOpen && R.travelT >= Math.max(0, seg.doorIdx - 1) * TICKS_PER_TILE) { R.doorOpen = true; const stop = R.map.route[R.room + 1]; emit('door', { room: R.room + 1, boss: !!(stop && stop.boss), side: !!(stop && stop.side) }); }
      if (R.travelT >= need) arriveAtStop();
      return;
    }
    if (R.phase === 'combat') { if (combatTick(R) && S.run) afterRoomCleared(); return; }
    if (R.phase === 'floorclear') {
      R.waitT++;
      if (guildLevel() >= 1 && S.settings.autoDescend && R.waitT >= 25) {
        const alive = R.party.filter((p) => p.alive);
        const avg = alive.reduce((a, p) => a + p.hp / p.maxhp, 0) / alive.length;
        const stop = S.settings.stopAtFloor && R.floor >= S.settings.stopAtFloor;
        const lowHp = guildLevel() >= 2 && avg < S.settings.autoExtractHp;
        const someoneDead = alive.length < R.party.length && guildLevel() >= 2;
        const bossAhead = guildLevel() >= 2 && isBossFloor(R.floor + 1) && avg < Math.min(0.75, S.settings.autoExtractHp + 0.3);
        if (stop || lowHp || someoneDead || bossAhead) extract(); else descend();
      }
    }
  }

  // ---------- overworld ----------
  const WD = () => window.World;
  function newZone(zone) {
    const seed = Math.floor(Math.random() * 1e9);
    const map = WD().generate(zone, seed);
    const explored = new Array(map.w * map.h).fill(0);
    const Wd = { zone, seed, map, explored, exploredCount: 0, pos: { x: map.start.x, y: map.start.y }, path: [], dest: null, order: null, phase: 'explore', moveT: 0, regenT: 0, idleT: 0, enc: null, deadT: 0, uncovered: false, quests: [], party: [], potions: S.buildings.alchemist, dir: 1, visitedTiles: 0 };
    Wd.quests = makeQuests(map);
    S.world = Wd;
    syncWorldParty();
    WD().reveal(map, explored, Wd.pos.x, Wd.pos.y, 5); recount();
    S.maxZone = Math.max(S.maxZone || 1, zone);
    log(`${map.title}. ${D.ZONE_THEMES.find((t) => t.id === map.theme).flavor}`, 'run');
    emit('zone', { zone, map });
  }
  function recount() { const Wd = S.world; let n = 0; const m = Wd.map; for (let i = 0; i < m.tiles.length; i++) if (Wd.explored[i] && !WD().BLOCKED(m.tiles[i])) n++; Wd.exploredCount = n; }
  function exploredPct() { const Wd = S.world; return Wd ? Wd.exploredCount / Math.max(1, Wd.map.walkableCount) : 0; }
  function syncWorldParty() {
    const Wd = S.world; if (!Wd) return;
    const old = Wd.party || [];
    Wd.party = S.party.map((uid) => { const prev = old.find((p) => p.uid === uid); const h = S.heroes.find((x) => x.uid === uid); const st = heroStats(h); if (prev) { const ratio = prev.maxhp ? prev.hp / prev.maxhp : 1; prev.maxhp = st.hp; prev.hp = Math.min(st.hp, Math.floor(st.hp * ratio)); return prev; } return makePartyState([uid])[0]; });
    if (Wd.enc) Wd.enc.party = Wd.party;
  }
  function makeQuests(map) {
    const theme = D.ZONE_THEMES.find((t) => t.id === map.theme);
    const q = [];
    q.push({ id: 'uncover', name: `Chart the ${theme.name}`, desc: 'Uncover 90% of the zone.', done: false, reward: { gold: 40 * WD().zoneLevel(map.zone) } });
    const camps = map.pois.filter((p) => p.type === 'camp');
    if (camps.length) q.push({ id: 'camps', name: 'Break the camps', desc: `Destroy all ${camps.length} monster camps.`, done: false, progress: 0, target: camps.length, reward: { gold: 60 * WD().zoneLevel(map.zone), item: 1 } });
    const lair = map.pois.find((p) => p.type === 'lair');
    if (lair) q.push({ id: 'lair', name: `Slay ${lair.name}`, desc: 'Break every camp first; then the lair will answer. Opens the road onward.', done: false, reward: { points: 1, item: 2 } });
    const dg = map.pois.filter((p) => p.type === 'dungeon');
    dg.forEach((d, i) => { q.push({ id: 'find_' + d.id, name: `Find the ${d.name}`, desc: 'Somewhere in this zone a way down is hidden.', done: false, reward: { gold: 30 * WD().zoneLevel(map.zone) } }); q.push({ id: 'delve_' + d.id, name: `Clear the ${d.name}`, desc: `Descend and clear floor ${d.baseFloor}.`, done: false, entrance: d.id, floor: d.baseFloor, reward: { item: 2, gold: 50 * WD().zoneLevel(map.zone) } }); });
    const shrines = map.pois.filter((p) => p.type === 'shrine');
    if (shrines.length) q.push({ id: 'shrines', name: 'Pray at every shrine', desc: `Visit all ${shrines.length} shrines.`, done: false, progress: 0, target: shrines.length, reward: { gold: 25 * WD().zoneLevel(map.zone) } });
    return q;
  }
  function completeQuest(q) {
    if (q.done) return; q.done = true; S.stats.quests++;
    const r = q.reward || {}; const lvl = WD().zoneLevel(S.world.zone);
    const parts = [];
    if (r.gold) { S.gold += r.gold; S.stats.goldEarned += r.gold; parts.push(`${r.gold} gold`); }
    if (r.item) { const it = genItem(lvl + 2, { luck: 200, minRarity: r.item }); addToStash(it); parts.push(it.name); }
    if (r.points) { for (const h of S.heroes) { h.points = (h.points || 0) + r.points; if (h.autoSkills) autoSpend(h); } parts.push(`+${r.points} skill point for every hero`); }
    log(`Quest complete: ${q.name}. Reward: ${parts.join(', ')}.`, 'milestone');
    emit('quest', q);
  }
  function questProgress(kind, info) {
    const Wd = S.world; if (!Wd) return;
    for (const q of Wd.quests) {
      if (q.done) continue;
      if (kind === 'uncover' && q.id === 'uncover' && exploredPct() >= 0.9) completeQuest(q);
      if (kind === 'camp' && q.id === 'camps') { q.progress = Wd.map.pois.filter((p) => p.type === 'camp' && p.done).length; if (q.progress >= q.target) completeQuest(q); }
      if (kind === 'lair' && q.id === 'lair') completeQuest(q);
      if (kind === 'found' && q.id === 'find_' + info.id) completeQuest(q);
      if (kind === 'delve' && q.entrance === info.entrance && info.floor >= q.floor) completeQuest(q);
      if (kind === 'shrine' && q.id === 'shrines') { q.progress = Wd.map.pois.filter((p) => p.type === 'shrine' && p.done).length; if (q.progress >= q.target) completeQuest(q); }
    }
  }
  function lairDone() { const l = S.world.map.pois.find((p) => p.type === 'lair'); return !l || l.done; }
  function exitFound() { const e = S.world.map.pois.find((p) => p.type === 'exit'); return !!(e && e.found); }
  function canAdvance() { return lairDone() && exitFound(); }
  function foundDungeons() { return S.world ? S.world.map.pois.filter((p) => p.type === 'dungeon' && p.found) : []; }
  function order(type, poiId, floor) {
    const Wd = S.world; if (!Wd) return 'No zone.';
    if (S.run) return 'The company is underground.';
    if (type === 'cancel') { Wd.order = null; Wd.path = []; Wd.dest = null; emit('order'); return null; }
    if (type === 'dungeon') { const poi = Wd.map.pois.find((p) => p.id === poiId); if (!poi || !poi.found) return 'No such entrance.'; Wd.order = { type, poi: poiId, floor: floor || poi.baseFloor }; }
    else if (type === 'exit') { if (!canAdvance()) return lairDone() ? 'The way onward has not been found.' : 'The lair still rules this land.'; Wd.order = { type }; }
    Wd.path = []; Wd.dest = null; log(type === 'exit' ? 'Orders: march to the next zone.' : `Orders: descend into the ${Wd.map.pois.find((p) => p.id === poiId).name}.`, 'run');
    emit('order'); return null;
  }
  function returnToSurface(wiped, hpMap, entrance) {
    const Wd = S.world; if (!Wd) return;
    if (wiped) { Wd.pos = { x: Wd.map.start.x, y: Wd.map.start.y }; for (const p of Wd.party) { p.alive = true; p.hp = Math.floor(p.maxhp * 0.5); p.dots = []; p.buffs = []; } }
    else { const ent = Wd.map.pois.find((p) => p.id === entrance); for (const p of Wd.party) { const r = hpMap && hpMap[p.uid] != null ? hpMap[p.uid] : 1; p.alive = true; p.hp = Math.max(1, Math.floor(p.maxhp * Math.max(0.2, r))); p.dots = []; p.buffs = []; } if (ent) Wd.pos = { x: ent.x, y: ent.y }; }
    Wd.phase = 'explore'; Wd.path = []; Wd.dest = null; Wd.order = null; Wd.enc = null; Wd.idleT = 0;
    emit('surface');
  }
  function poiAt(x, y) { return S.world.map.pois.find((p) => p.x === x && p.y === y); }
  function startEncounter(poi) {
    const Wd = S.world; const theme = D.ZONE_THEMES.find((t) => t.id === Wd.map.theme);
    const lvl = WD().zoneLevel(Wd.zone) + rint(0, 4);
    const list = [];
    if (poi.type === 'lair') { list.push(makeEnemy(poi.boss, lvl + 2, true, 0)); for (let i = 0; i < 3; i++) list.push(makeEnemy(pick(theme.enemies), lvl, false, 0)); }
    else { const n = (poi.size || 3) + Math.min(3, Math.floor(Wd.zone / 2)); for (let i = 0; i < n; i++) list.push(makeEnemy(pick(theme.enemies), lvl, false, 0)); }
    Wd.enc = { party: Wd.party, enemies: list, floor: lvl, gold: 0, bag: [], mats: {}, kills: 0, potions: Wd.potions, poi: poi.id, world: true };
    Wd.phase = 'combat'; Wd.path = []; Wd.dest = null;
    log(`${poi.type === 'lair' ? poi.name + ' rises to meet the company.' : 'The ' + poi.name + ' stirs.'}`, poi.type === 'lair' ? 'boss' : 'run');
    emit('encounter', { boss: poi.type === 'lair', enemies: list, world: true, poi });
  }
  function endEncounter() {
    const Wd = S.world; const E = Wd.enc; if (!E) return;
    const poi = Wd.map.pois.find((p) => p.id === E.poi);
    if (poi) { poi.done = true; if (poi.type === 'camp') { S.stats.campsCleared++; questProgress('camp'); } if (poi.type === 'lair') { questProgress('lair'); log('The lair is silent. The road onward is open.', 'milestone'); } }
    S.gold += E.gold; S.stats.goldEarned += E.gold; Wd.potions = E.potions;
    for (const it of E.bag) addToStash(it);
    for (const k in E.mats) S.mats[k] = (S.mats[k] || 0) + E.mats[k];
    for (const p of Wd.party) if (!p.alive) { p.alive = true; p.hp = Math.floor(p.maxhp * 0.25); p.ap = 0; p.cds = {}; }
    for (const p of Wd.party) { p.dots = []; p.buffs = []; }
    Wd.enc = null; Wd.phase = 'explore'; Wd.idleT = 0;
    emit('encounterend', { gold: E.gold, items: E.bag.length, poi });
  }
  function worldWipe() {
    const Wd = S.world; const E = Wd.enc;
    S.stats.wipes++;
    const lost = Math.floor(S.gold * 0.1); S.gold -= lost;
    log(`The company falls in the ${Wd.map.title}. They wake at the ${Wd.zone === 1 ? 'town gate' : 'waypoint'}, ${fmt(lost)} gold poorer.`, 'bad');
    if (E && E.poi) { const poi = Wd.map.pois.find((p) => p.id === E.poi); if (poi) poi.done = false; }
    Wd.enc = null; Wd.phase = 'dead'; Wd.deadT = 0; Wd.path = []; Wd.dest = null; Wd.order = null;
    emit('worldwipe', { lost });
  }
  function visitPoi(poi) {
    const Wd = S.world;
    if (poi.done) return;
    if (poi.type === 'chest') { const lvl = WD().zoneLevel(Wd.zone); const g = Math.floor(C.gold(lvl) * 6 * rnd(0.8, 1.3)); S.gold += g; S.stats.goldEarned += g; const it = genItem(lvl + 1, { luck: 40 + partyLoot({ party: Wd.party }) }); addToStash(it); S.stats.itemsFound++; poi.done = true; log(`A chest: ${it.name} and ${g} gold.`, 'loot'); emit('chest', { item: it, gold: g, world: true }); }
    else if (poi.type === 'shrine') { for (const p of Wd.party) { p.alive = true; p.hp = p.maxhp; p.dots = []; } poi.done = true; log('The shrine\'s cold light mends every wound.', 'good'); questProgress('shrine'); emit('shrineused', poi); }
    else if (poi.type === 'town' || poi.type === 'waypoint') { for (const p of Wd.party) if (p.alive) p.hp = p.maxhp; }
  }
  function nextZone() {
    const Wd = S.world; const z = Wd.zone + 1;
    S.stats.zones++;
    for (const p of Wd.party) { p.alive = true; p.hp = p.maxhp; }
    log(`The company leaves the ${Wd.map.title} behind.`, 'run');
    newZone(z);
    emit('order');
  }
  function stepMove() {
    const Wd = S.world; const m = Wd.map;
    if (!Wd.path.length) return;
    const nxt = Wd.path.shift();
    if (nxt.x === Wd.pos.x && nxt.y === Wd.pos.y) { if (!Wd.path.length) return; return stepMove(); }
    Wd.dir = (nxt.x - Wd.pos.x) - (nxt.y - Wd.pos.y) >= 0 ? 1 : -1;
    Wd.pos = { x: nxt.x, y: nxt.y };
    const n = WD().reveal(m, Wd.explored, nxt.x, nxt.y, 4);
    if (n) { recount(); questProgress('uncover');
      for (const poi of m.pois) if (!poi.found && Wd.explored[poi.y * m.w + poi.x]) { poi.found = true; log(`Discovered: ${poi.name || poi.type}.`, 'good'); emit('poi', poi); if (poi.type === 'dungeon') questProgress('found', poi); }
      if (!Wd.uncovered && exploredPct() >= 0.995) { Wd.uncovered = true; log(`${m.title} is fully charted.`, 'milestone'); }
    }
    const here = poiAt(nxt.x, nxt.y); if (here) visitPoi(here);
    // camps and the lair attack when the party comes close
    const campsDone = !m.pois.some((p) => p.type === 'camp' && !p.done);
    for (const poi of m.pois) { if ((poi.type === 'camp' || (poi.type === 'lair' && campsDone)) && !poi.done && Math.abs(poi.x - nxt.x) <= 2 && Math.abs(poi.y - nxt.y) <= 2) { startEncounter(poi); return; } }
  }
  function chooseDestination() {
    const Wd = S.world; const m = Wd.map; const W = WD();
    const goTo = (poi) => { const path = W.pathTo(m, Wd.pos, { x: poi.x, y: poi.y }); if (path) { Wd.path = path; Wd.dest = { x: poi.x, y: poi.y, id: poi.id }; return true; } return false; };
    if (Wd.order) {
      if (Wd.order.type === 'dungeon') { const poi = m.pois.find((p) => p.id === Wd.order.poi); if (!poi) { Wd.order = null; return; } if (Wd.pos.x === poi.x && Wd.pos.y === poi.y) { const o = Wd.order; Wd.order = null; startRun(Math.max(poi.baseFloor, o.floor || poi.baseFloor), false, poi.id); return; } if (!goTo(poi)) Wd.order = null; return; }
      if (Wd.order.type === 'exit') { const poi = m.pois.find((p) => p.type === 'exit'); if (Wd.pos.x === poi.x && Wd.pos.y === poi.y) { Wd.order = null; nextZone(); return; } if (!goTo(poi)) Wd.order = null; return; }
    }
    // found-but-unvisited things nearby first (chests, shrines, camps, lair)
    const campsLeft = m.pois.some((p) => p.type === 'camp' && !p.done);
    const pending = m.pois.filter((p) => p.found && !p.done && (['chest', 'shrine', 'camp'].includes(p.type) || (p.type === 'lair' && !campsLeft)));
    if (pending.length) { const near = pending.map((p) => ({ p, d: Math.abs(p.x - Wd.pos.x) + Math.abs(p.y - Wd.pos.y) })).sort((a, b) => a.d - b.d); if (near[0].d <= 14 || Wd.uncovered) { for (const c of near) if (goTo(c.p)) return; } }
    const r = W.nearestUnexplored(m, Wd.explored, Wd.pos);
    if (r) { Wd.path = r.path; Wd.dest = r.tile; return; }
    if (!Wd.uncovered) { Wd.uncovered = true; recount(); questProgress('uncover'); log(`${m.title} is fully charted.`, 'milestone'); }
    // everything done: automation decides
    Wd.idleT++;
    if (Wd.idleT % 50 === 1) {
      const allDone = Wd.quests.every((q) => q.done || q.id.startsWith('delve_') || q.id.startsWith('find_'));
      if (guildLevel() >= 3 && S.settings.autoDelve) { const d = m.pois.find((p) => p.type === 'dungeon' && p.found && !Wd.quests.find((q) => q.entrance === p.id && q.done)); if (d) { order('dungeon', d.id, d.baseFloor); return; } }
      if (guildLevel() >= 6 && S.settings.autoNextZone && allDone && canAdvance()) { order('exit'); return; }
    }
  }
  function worldTick() {
    const Wd = S.world; if (!Wd) return;
    if (Wd.phase === 'combat') { if (Wd.enc && combatTick(Wd.enc) && Wd.phase === 'combat') endEncounter(); return; }
    if (Wd.phase === 'dead') { Wd.deadT++; if (Wd.deadT >= 60) { Wd.pos = { x: Wd.map.start.x, y: Wd.map.start.y }; for (const p of Wd.party) { p.alive = true; p.hp = Math.floor(p.maxhp * 0.6); p.dots = []; p.buffs = []; } Wd.phase = 'explore'; emit('surface'); } return; }
    // regeneration on the surface
    Wd.regenT++; if (Wd.regenT >= 10) { Wd.regenT = 0; for (const p of Wd.party) if (p.alive && p.hp < p.maxhp) p.hp = Math.min(p.maxhp, p.hp + Math.max(1, Math.floor(p.maxhp * 0.01))); }
    Wd.moveT++;
    if (Wd.moveT >= WORLD_TICKS_PER_TILE) { Wd.moveT = 0; if (!Wd.path.length) chooseDestination(); if (Wd.path.length && S.world && S.world.phase === 'explore') stepMove(); }
  }

  // ---------- main tick ----------
  function tick() {
    S.stats.playTicks++;
    if (S.run) { runTick(); return; }
    worldTick();
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
    newZone(1);
    log(`REBIRTH ${S.ascensions}. The world reforms. +${reward} Embers. Enemies are ${Math.round((difficultyMult() - 1) * 100)}% stronger; loot, gold and XP are richer.`, 'milestone');
    emit('ascend', { reward }); emit('inv'); emit('village');
    return null;
  }
  function buyPerk(pid) {
    const p = D.ASCENSION_PERKS.find((x) => x.id === pid); const r = S.perks[pid] || 0;
    if (r >= p.max) return 'Maxed.'; const c = p.cost(r); if (S.embers < c) return 'Not enough Embers.';
    S.embers -= c; S.perks[pid] = r + 1; syncWorldParty(); emit('village'); return null;
  }
  function abandonRun() { if (!S.run) return; const R = S.run; S.run = null; log('The company retreats to the surface in disgrace. The bag is lost.', 'bad'); returnToSurface(false, null, R.entrance); emit('runend', { type: 'abandon', floor: R.floor, kills: R.kills, gold: 0, items: 0, itemsLost: R.bag.length, floors: R.floorsCleared }); }

  // ---------- new game / save ----------
  function newGame(chosen) {
    S = newState();
    for (const cid of chosen) { const h = createHero(cid, 1); S.heroes.push(h); S.party.push(h.uid); }
    for (const h of S.heroes) { const it = genItem(1, { slot: 'weapon', wtype: heroClass(h).weapons[0] }); it.rarity = 0; it.affixes = []; nameItem(it); h.equip.weapon = it; }
    S.gold = 30; S.started = true;
    newZone(1);
    log('The company walks out of the gate. Somewhere out there is a way down.', 'run');
    save(); emit('newgame');
  }
  function save() { if (!S) return; S.lastSeen = Date.now(); try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function migrate() {
    const def = newState();
    for (const k in def) if (S[k] === undefined) S[k] = def[k];
    for (const k in def.settings) if (S.settings[k] === undefined) S.settings[k] = def.settings[k];
    for (const k in def.stats) if (S.stats[k] === undefined) S.stats[k] = def.stats[k];
    for (const k in def.mats) if (S.mats[k] === undefined) S.mats[k] = 0;
    for (const k in def.buildings) if (S.buildings[k] === undefined) S.buildings[k] = 0;
    for (const h of S.heroes) {
      if (!h.skills) { h.skills = {}; h.points = h.level; h.autoSkills = true; autoSpend(h); }
      if (h.points === undefined) h.points = 0;
    }
    if (S.run) {
      for (const e of S.run.enemies) e.spec = D.ENEMIES[e.eid];
      for (const e of S.run.next || []) e.spec = D.ENEMIES[e.eid];
      if (!S.run.map || !S.run.map.route) { const R = S.run; R.seed = Math.floor(Math.random() * 1e9); R.map = window.Dungeon.generate(R.floor, mainRooms(R.floor), R.seed); R.room = 0; R.phase = 'travel'; R.travelT = 0; R.doorOpen = false; R.next = makeEncounter(1); R.encDone = 0; }
      for (const p of S.run.party) if (p.target === undefined) p.target = null;
    }
    if (!S.world) newZone(1);
    else { const Wd = S.world; if (Wd.enc) { Wd.enc.party = Wd.party; for (const e of Wd.enc.enemies) e.spec = D.ENEMIES[e.eid]; } syncWorldParty(); }
  }
  function load() {
    try { const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false; S = JSON.parse(raw); } catch (e) { return false; }
    if (!S || !S.version) return false;
    migrate();
    return true;
  }
  function offlineProgress() {
    const now = Date.now(); const dt = Math.min(now - (S.lastSeen || now), 12 * 3600 * 1000);
    if (dt < 30000) return null;
    const hours = dt / 3600000;
    const rep = { hours, mineGold: 0, mineScrap: 0, floors: 0, ticks: 0, ended: [], goldBefore: S.gold, itemsBefore: S.stats.itemsFound, campsBefore: S.stats.campsCleared, questsBefore: S.stats.quests };
    if (S.buildings.mine) { rep.mineGold = Math.floor(S.buildings.mine * 25 * hours); rep.mineScrap = Math.floor(S.buildings.mine * 6 * hours); mineTick(hours); }
    if (guildLevel() >= 6 && S.settings.autoDescend) {
      const maxTicks = Math.min(Math.floor(dt / D.TICK_MS), 4 * 36000);
      const before = S.stats.floorsCleared || 0;
      const h = (s) => { rep.ended.push(s); };
      on('runend', h);
      const savedListeners = {}; for (const k in listeners) if (k !== 'runend') { savedListeners[k] = listeners[k]; listeners[k] = []; }
      for (let i = 0; i < maxTicks; i++) tick();
      for (const k in savedListeners) listeners[k] = savedListeners[k];
      listeners.runend = listeners.runend.filter((x) => x !== h);
      rep.ticks = maxTicks; rep.floors = (S.stats.floorsCleared || 0) - before;
    }
    rep.goldGained = S.gold - rep.goldBefore; rep.itemsGained = S.stats.itemsFound - rep.itemsBefore; rep.camps = S.stats.campsCleared - rep.campsBefore; rep.quests = S.stats.quests - rep.questsBefore;
    S.lastSeen = now;
    return rep;
  }
  function resetAll() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* */ } S = null; }
  function exportSave() { return btoa(unescape(encodeURIComponent(JSON.stringify(S)))); }
  function importSave(str) { try { const obj = JSON.parse(decodeURIComponent(escape(atob(str.trim())))); if (!obj.version) return 'Invalid save.'; S = obj; migrate(); localStorage.setItem(SAVE_KEY, JSON.stringify(S)); return null; } catch (e) { return 'Could not read that save.'; } }

  window.Game = {
    get S() { return S; }, D, C, on, emit, log, fmt,
    newGame, save, load, offlineProgress, resetAll, exportSave, importSave, tick,
    heroStats, heroSkills, heroPower, heroClass, itemStats, sellPrice, salvageYield, genItem, passiveStats,
    rank, canSpend, spendPoint, respec, respecCost, toggleAutoSkills, autoSpend, skillMult, skillDur, pointsSpent,
    recruit, recruitCost, dismiss, toggleParty, partySizeCap, rosterCap, stashCap, classUnlocked,
    sellItem, salvageItem, equipItem, unequip, autoEquip, autoEquipAll, canEquip, findItem, itemScore,
    craft, craftCost, craftIlvl, upgrade, upgradeCost, upgradeCap, enchant, enchantCost,
    buildingCost, buildingAvailable, upgradeBuilding, collectMine, guildLevel,
    startRun, extract, descend, abandonRun, waystones, biomeFor, isBossFloor, difficultyMult, travelNeed, currentSeg, TICKS_PER_TILE, cur, inCombat,
    order, exploredPct, canAdvance, lairDone, exitFound, foundDungeons, nextZone, newZone,
    canAscend, ascensionReward, ascend, buyPerk, checkMilestones, xpToNext: C.xpToNext,
  };
})();
