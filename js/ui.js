/* GRIMDELVE — DOM UI */
(function () {
  'use strict';
  const D = window.DATA;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let G, S;
  let currentTab = 'dungeon';
  const dirty = { dungeon: true, heroes: true, stash: true, forge: true, village: true, hud: true };
  let stashFilter = 'all';
  let craftSlot = 'weapon', craftMat = null;

  const fmt = (n) => window.Game.fmt(n);
  const pct = (n) => Math.round(n * 100) + '%';
  const portrait = (key, cls) => `<div class="portrait ${cls || ''}" style="background-image:url(assets/img/${key}.webp)"></div>`;
  const rarName = (it) => D.RARITIES[it.rarity].name;

  // ---------- toasts / modals ----------
  function toast(html, kind, ms) {
    const el = document.createElement('div'); el.className = 'toast ' + (kind || ''); el.innerHTML = html;
    const root = $('#toasts'); while (root.children.length >= 3) root.firstChild.remove();
    root.appendChild(el); setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, ms || 2600);
  }
  function modal(html, opts) {
    opts = opts || {};
    const root = $('#modal-root');
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="sheet">${opts.noClose ? '' : '<button class="close" data-close>✕</button>'}${html}</div>`;
    bg.addEventListener('click', (e) => { if (e.target === bg && !opts.noClose) close(); });
    bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    root.appendChild(bg);
    function close() { bg.remove(); if (opts.onClose) opts.onClose(); }
    return { el: bg, close };
  }
  function closeModals() { $('#modal-root').innerHTML = ''; }
  function err(msg) { if (msg) toast(esc(msg), 'bad'); return !msg; }

  // ---------- HUD ----------
  function renderHud() {
    $('#hud-gold b').textContent = fmt(S.gold);
    $('#hud-scrap b').textContent = fmt(S.mats.scrap);
    $('#hud-essence b').textContent = fmt(S.mats.essence);
    $('#hud-ember').classList.toggle('hidden', !(S.embers > 0 || S.ascensions > 0));
    $('#hud-ember b').textContent = fmt(S.embers);
    $('#btn-speed').textContent = S.settings.speed + '×';
    // tab locks
    $$('#tabs button').forEach((b) => {
      const t = b.dataset.tab;
      const locked = (t === 'forge' && !S.unlocked.blacksmith);
      b.classList.toggle('locked', locked);
    });
    const badge = $('#tabs button[data-tab=village] .badge');
    const canAfford = Object.keys(D.BUILDINGS).some((bid) => G.buildingAvailable(bid) && S.buildings[bid] < D.BUILDINGS[bid].max && G.buildingCost(bid).gold <= S.gold && (!G.buildingCost(bid).scrap || G.buildingCost(bid).scrap <= S.mats.scrap)) || (S.mineStock.gold >= 50);
    if (canAfford && !badge) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = '!'; $('#tabs button[data-tab=village]').appendChild(b); }
    else if (!canAfford && badge) badge.remove();
    dirty.hud = false;
  }

  // ---------- Dungeon tab ----------
  function renderDungeon() {
    const R = S.run; const panel = $('#dungeon-panel');
    const label = $('#scene-label');
    if (R) {
      const bf = G.biomeFor(R.floor); const rooms = D.ROOMS_PER_FLOOR + (G.isBossFloor(R.floor) ? 1 : 0);
      label.innerHTML = `<span>Floor <b>${R.floor}</b> · <span class="biome">${esc(bf.biome.name)}${bf.cycle ? ' ' + 'I'.repeat(bf.cycle + 1) : ''}</span></span><span>${R.phase === 'floorclear' ? 'Exit' : (G.isBossFloor(R.floor) && R.room === rooms ? 'BOSS' : 'Room ' + Math.min(R.phase === 'travel' ? R.room + 1 : R.room, rooms) + '/' + rooms)}</span>`;
    } else label.innerHTML = `<span><span class="biome">Village gate</span></span><span>Deepest: ${S.maxFloor}</span>`;

    let html = '';
    if (!R) {
      const ws = G.waystones(); const best = ws[ws.length - 1];
      if (!S.ui) S.ui = {}; if (!ws.includes(S.ui.startFloor)) S.ui.startFloor = best;
      const bf = G.biomeFor(S.ui.startFloor);
      html += `<div class="panel"><h3>The Company <small>${S.party.length}/${G.partySizeCap()} · power ${fmt(S.party.reduce((a, uid) => a + G.heroPower(S.heroes.find((h) => h.uid === uid)), 0))}</small></h3>
        <div class="party">${S.party.map((uid) => { const h = S.heroes.find((x) => x.uid === uid); const st = G.heroStats(h); return `<div class="pcard" data-hero="${uid}">${portrait(D.CLASSES[h.cls].img)}<div class="grow" style="min-width:0"><div class="nm">${esc(h.name)}</div><div class="tiny muted">Lv ${h.level} · ${fmt(st.hp)} hp</div></div></div>`; }).join('')}</div>
        ${S.party.length < G.partySizeCap() ? '<div class="tiny muted mt">Slots free — add heroes in the Heroes tab.</div>' : ''}
        </div>`;
      html += `<div class="panel"><h3>Waystone <small>${esc(bf.biome.name)}</small></h3>
        <div class="chips">${ws.map((f) => `<button class="chip ${f === S.ui.startFloor ? 'active' : ''}" data-ws="${f}">Floor ${f}</button>`).join('')}</div>
        <div class="tiny muted mt">${esc(bf.biome.flavor)} ${G.isBossFloor(S.ui.startFloor + 4) ? '' : ''}Bosses every ${D.BOSS_EVERY} floors. Extract after any floor to bank your loot.</div>
        <button class="btn primary big mt pulse" id="btn-start">DESCEND</button></div>`;
    } else {
      html += `<div class="panel"><div class="party">${R.party.map((p) => { const h = S.heroes.find((x) => x.uid === p.uid); return `<div class="pcard ${p.alive ? '' : 'dead'}" data-hero="${p.uid}">${portrait(D.CLASSES[h.cls].img)}<div class="grow" style="min-width:0"><div class="nm">${esc(h.name)}</div><div class="bar"><i style="width:${pct(p.hp / p.maxhp)}"></i><span class="sh" style="width:${pct(Math.min(1, p.shield / p.maxhp))}"></span></div><div class="tiny muted">L${h.level} · ${fmt(p.hp)}/${fmt(p.maxhp)}</div></div></div>`; }).join('')}</div>
        ${R.phase === 'combat' ? `<div class="enemies mt">${R.enemies.filter((e) => e.alive).map((e) => `<div class="erow" data-enemy="${e.id}"><span class="nm ${e.boss ? 'blood' : ''}">${e.boss ? '☠ ' : ''}${esc(e.name)}</span><div class="bar"><i style="width:${pct(e.hp / e.maxhp)}"></i></div><span class="tiny muted hp">${fmt(e.hp)}</span></div>`).join('')}</div>` : ''}
        <div class="row between mt small"><span>Bag <b>${R.bag.length}</b> · Gold <b class="gold">${fmt(R.gold)}</b> · Kills <b>${R.kills}</b></span><span class="muted">${R.potions > 0 ? '⚗ ' + R.potions : ''} ${R.floorsCleared ? '· ' + R.floorsCleared + ' floors' : ''}</span></div>
        ${R.bag.length ? `<div class="row mt" style="flex-wrap:wrap;gap:4px">${R.bag.slice(-8).map((it) => `<span class="tiny c${it.rarity}">${esc(it.name)}</span>`).join('<span class="dim tiny">·</span>')}</div>` : ''}
        </div>`;
      if (R.phase === 'floorclear') {
        const next = G.biomeFor(R.floor + 1); const newBiome = R.floor % D.FLOORS_PER_BIOME === 0;
        const alive = R.party.filter((p) => p.alive); const avg = alive.reduce((a, p) => a + p.hp / p.maxhp, 0) / alive.length;
        const auto = G.guildLevel() >= 1 && S.settings.autoDescend;
        html += `<div class="panel decision"><div class="center small muted mb">${newBiome ? `<span class="gold">A new dungeon opens below: ${esc(next.biome.name)}.</span> ` : ''}Party health ${pct(avg)}${alive.length < R.party.length ? ` · <span class="blood">${R.party.length - alive.length} fallen</span>` : ''}${auto ? ' · <span class="green">auto-deciding…</span>' : ''}</div>
          <div class="btnrow"><button class="btn big" id="btn-extract">EXTRACT<small>bank ${R.bag.length} items · ${fmt(R.gold)} gold</small></button><button class="btn big primary" id="btn-descend">GO DEEPER<small>Floor ${R.floor + 1}${G.isBossFloor(R.floor + 1) ? ' · BOSS' : ''}${newBiome ? ' · ' + esc(next.biome.name) : ''}</small></button></div></div>`;
      } else {
        html += `<div class="row" style="padding:0 10px"><button class="btn small ghost" id="btn-abandon">Abandon run</button><span class="grow"></span><span class="tiny muted">${R.phase === 'travel' ? 'Advancing…' : 'Fighting'}</span></div>`;
      }
    }
    panel.innerHTML = html;
    $$('[data-ws]', panel).forEach((b) => b.addEventListener('click', () => { S.ui.startFloor = +b.dataset.ws; renderDungeon(); }));
    $$('[data-hero]', panel).forEach((b) => b.addEventListener('click', () => heroSheet(b.dataset.hero)));
    const bs = $('#btn-start'); if (bs) bs.addEventListener('click', () => { if (err(G.startRun(S.ui.startFloor))) { markAll(); } });
    const be = $('#btn-extract'); if (be) be.addEventListener('click', () => err(G.extract()));
    const bd = $('#btn-descend'); if (bd) bd.addEventListener('click', () => err(G.descend()));
    const ba = $('#btn-abandon'); if (ba) ba.addEventListener('click', () => { const m = modal(`<h2>Abandon the run?</h2><p class="small muted">Everything in the bag is lost. Heroes keep their experience.</p><div class="btnrow"><button class="btn" data-close>Stay</button><button class="btn danger" id="abandon-yes">Abandon</button></div>`); $('#abandon-yes').addEventListener('click', () => { m.close(); G.abandonRun(); markAll(); }); });
    dirty.dungeon = false;
  }
  function renderLog() {
    const el = $('#log'); el.innerHTML = S.log.slice(-6).reverse().map((l) => `<div class="${l.k}">${esc(l.t)}</div>`).join('');
  }

  // ---------- Heroes tab ----------
  function renderHeroes() {
    const el = $('#tab-heroes');
    let html = `<div class="panel"><h3>Roster <small>${S.heroes.length}/${G.rosterCap()} · party ${S.party.length}/${G.partySizeCap()}</small></h3><div class="tiny muted">Tap a hero for gear and skills. Toggle who joins the descent.</div></div>`;
    for (const h of S.heroes) {
      const cls = D.CLASSES[h.cls]; const st = G.heroStats(h); const inP = S.party.includes(h.uid);
      html += `<div class="hcard ${inP ? 'inparty' : ''}" data-hero="${h.uid}">${portrait(cls.img, 'lg')}<div class="info"><div class="nm">${esc(h.name)} <small>Lv ${h.level} ${cls.role}</small></div>
        <div class="bar xp"><i style="width:${pct(h.xp / G.xpToNext(h.level))}"></i></div>
        <div class="tiny muted mt" style="margin-top:4px">HP ${fmt(st.hp)} · ATK ${fmt(st.atk)} · DEF ${fmt(st.def)} · SPD ${st.spd} · CRIT ${st.crit}%</div>
        <div class="row mt" style="margin-top:6px"><span class="tag ${inP ? 'party' : ''}">${inP ? 'In party' : 'Resting'}</span><span class="grow"></span><button class="btn small" data-toggle="${h.uid}">${inP ? 'Bench' : 'Add to party'}</button></div></div></div>`;
    }
    // recruit
    const cost = G.recruitCost();
    const avail = Object.keys(D.CLASSES).filter((c) => G.classUnlocked(c));
    html += `<div class="panel"><h3>Tavern <small>recruit for ${fmt(cost)} gold</small></h3>${S.heroes.length >= G.rosterCap() ? '<div class="small blood">Roster full — upgrade the Tavern in the Village.</div>' : ''}
      <div class="pick-grid mt">${avail.map((c) => { const cls = D.CLASSES[c]; return `<div class="pick" data-recruit="${c}">${portrait(cls.img, 'lg')}<div class="nm">${cls.name}</div><div class="tl">${esc(cls.tagline)}</div><div class="st">${cls.role.toUpperCase()} · ${cls.trait.name}</div></div>`; }).join('')}</div>
      ${Object.keys(D.CLASSES).filter((c) => !G.classUnlocked(c)).length ? `<div class="tiny muted mt">Locked: ${Object.keys(D.CLASSES).filter((c) => !G.classUnlocked(c)).map((c) => D.CLASSES[c].name).join(', ')} — found deeper in the dungeon.</div>` : ''}</div>`;
    if (S.relics.length) html += `<div class="panel"><h3>Relics</h3>${S.relics.map((id) => { const r = D.RELICS.find((x) => x.id === id); return `<span class="relic" title="${esc(r.desc)}">${esc(r.name)} <span class="muted">${esc(r.desc)}</span></span>`; }).join('')}</div>`;
    el.innerHTML = html;
    $$('[data-hero]', el).forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-toggle]')) return; heroSheet(b.dataset.hero); }));
    $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.toggleParty(b.dataset.toggle))) markAll(); }));
    $$('[data-recruit]', el).forEach((b) => b.addEventListener('click', () => { const cls = D.CLASSES[b.dataset.recruit]; const m = modal(`<h2>Recruit ${cls.name}?</h2><div class="row">${portrait(cls.img, 'xl')}<div><div class="small"><i>${esc(cls.tagline)}</i></div><div class="small mt"><b>${cls.trait.name}:</b> ${esc(cls.trait.desc)}</div><div class="tiny muted mt">Weapons: ${cls.weapons.map((w) => D.WEAPON_TYPES[w].name).join(', ')}</div></div></div><div class="mt small">Skills: ${cls.skills.map((s) => D.SKILLS[s].name).join(', ')}</div><div class="btnrow"><button class="btn" data-close>Not now</button><button class="btn primary" id="rec-yes">Recruit · ${fmt(G.recruitCost())} gold</button></div>`); $('#rec-yes').addEventListener('click', () => { if (err(G.recruit(b.dataset.recruit))) { m.close(); markAll(); } }); }));
    dirty.heroes = false;
  }
  function itemCard(it, opts) {
    opts = opts || {};
    return `<div class="item r${it.rarity} ${opts.better ? 'better' : ''}" data-item="${it.id}" style="background-image:url(assets/img/${D.SLOT_ICON[it.slot]}.webp)"><span class="lv">${it.ilvl}</span>${it.up ? `<span class="up">+${it.up}</span>` : ''}${opts.eq ? '<span class="eq">E</span>' : ''}</div>`;
  }
  function heroSheet(uid) {
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return;
    const cls = D.CLASSES[h.cls]; const st = G.heroStats(h); const inP = S.party.includes(uid);
    const skills = cls.skills.map((sid) => D.SKILLS[sid]);
    const html = `<h2>${esc(h.name)} <span class="muted small">Lv ${h.level} ${cls.name}</span></h2>
      <div class="row">${portrait(cls.img, 'xl')}<div class="grow"><div class="small"><i>${esc(cls.tagline)}</i></div><div class="bar xp mt"><i style="width:${pct(h.xp / G.xpToNext(h.level))}"></i></div><div class="tiny muted">${fmt(h.xp)} / ${fmt(G.xpToNext(h.level))} xp · power ${fmt(G.heroPower(h))}</div>
        <div class="small mt"><b>${cls.trait.name}</b> — ${esc(cls.trait.desc)}</div></div></div>
      <div class="stat-grid mt"><span>HP <b>${fmt(st.hp)}</b></span><span>ATK <b>${fmt(st.atk)}</b></span><span>DEF <b>${fmt(st.def)}</b></span><span>SPD <b>${st.spd}</b></span><span>CRIT <b>${st.crit}%</b></span><span>Leech <b>${st.lifesteal}%</b></span>${st.gold ? `<span>Gold <b>+${st.gold}%</b></span>` : ''}${st.xp ? `<span>XP <b>+${st.xp}%</b></span>` : ''}${st.loot ? `<span>Loot <b>+${st.loot}%</b></span>` : ''}${st.thorns ? `<span>Thorns <b>${st.thorns}%</b></span>` : ''}</div>
      <h3 class="mt gold" style="font-family:var(--serif);font-size:14px;margin-bottom:4px">Equipment</h3>
      <div class="slots">${D.SLOTS.map((s) => { const it = h.equip[s]; return it ? itemCard(it) : `<div class="item empty" data-slot="${s}">${D.SLOT_NAMES[s]}</div>`; }).join('')}</div>
      <div class="slots">${D.SLOTS.map((s) => `<div class="slot-name">${D.SLOT_NAMES[s]}</div>`).join('')}</div>
      <div class="btnrow"><button class="btn" id="hs-best">Equip best</button><button class="btn ${inP ? '' : 'primary'}" id="hs-toggle">${inP ? 'Bench' : 'Add to party'}</button></div>
      <h3 class="mt gold" style="font-family:var(--serif);font-size:14px;margin-bottom:4px">Skills</h3>
      ${skills.map((sk) => `<div class="skill ${sk.unlock <= h.level ? '' : 'locked'}"><span class="cd">${sk.unlock <= h.level ? 'cd ' + sk.cd : 'Lv ' + sk.unlock}</span><b>${sk.name}</b> — ${esc(sk.desc.replace('{mult}', Math.round((sk.mult || 0) * 100 * (1 + S.buildings.library * 0.05))))}</div>`).join('')}
      <div class="mt"><button class="btn small ghost" id="hs-dismiss">Dismiss hero</button></div>`;
    const m = modal(html);
    $$('[data-item]', m.el).forEach((b) => b.addEventListener('click', () => itemSheet(b.dataset.item, uid)));
    $$('[data-slot]', m.el).forEach((b) => b.addEventListener('click', () => pickForSlot(uid, b.dataset.slot)));
    $('#hs-best', m.el).addEventListener('click', () => { if (S.run && inP) return err('Cannot change gear mid-run.'); const n = G.autoEquip(uid); toast(n ? `Equipped ${n} item${n > 1 ? 's' : ''}.` : 'Nothing better in the stash.'); m.close(); heroSheet(uid); markAll(); });
    $('#hs-toggle', m.el).addEventListener('click', () => { if (err(G.toggleParty(uid))) { m.close(); markAll(); } });
    $('#hs-dismiss', m.el).addEventListener('click', () => { const c = modal(`<h2>Dismiss ${esc(h.name)}?</h2><p class="small muted">Their gear returns to the stash. This cannot be undone.</p><div class="btnrow"><button class="btn" data-close>Keep</button><button class="btn danger" id="dis-yes">Dismiss</button></div>`); $('#dis-yes').addEventListener('click', () => { if (err(G.dismiss(uid))) { c.close(); m.close(); markAll(); } }); });
  }
  function pickForSlot(uid, slot) {
    const h = S.heroes.find((x) => x.uid === uid);
    const items = S.stash.filter((it) => it.slot === slot && G.canEquip(h, it)).sort((a, b) => G.itemScore(b, h) - G.itemScore(a, h));
    const cur = h.equip[slot];
    const m = modal(`<h2>${D.SLOT_NAMES[slot]} for ${esc(h.name)}</h2>${items.length ? '' : '<p class="small muted">Nothing suitable in the stash.</p>'}<div class="grid" style="padding:0">${items.map((it) => itemCard(it, { better: cur ? G.itemScore(it, h) > G.itemScore(cur, h) : true })).join('')}</div>`);
    $$('[data-item]', m.el).forEach((b) => b.addEventListener('click', () => { m.close(); itemSheet(b.dataset.item, uid); }));
  }

  // ---------- Items ----------
  function statLine(it, compareTo) {
    const st = G.itemStats(it); const cs = compareTo ? G.itemStats(compareTo) : null;
    const names = { hp: 'HP', atk: 'ATK', def: 'DEF', spd: 'SPD', crit: 'CRIT%', lifesteal: 'Leech%', gold: 'Gold%', xp: 'XP%', loot: 'Loot%', thorns: 'Thorns%' };
    return Object.keys(st).map((k) => { const v = Math.round(st[k] * 10) / 10; let cmp = ''; if (cs) { const d = Math.round((v - (cs[k] || 0)) * 10) / 10; if (d) cmp = ` <span class="compare ${d > 0 ? 'pos' : 'neg'}">(${d > 0 ? '+' : ''}${d})</span>`; } return `<span>${names[k] || k} <b>${v}</b>${cmp}</span>`; }).join('');
  }
  function itemSheet(id, heroUid) {
    const f = G.findItem(id); if (!f) return;
    const it = f.item; const rar = D.RARITIES[it.rarity];
    const heroes = S.heroes.filter((h) => G.canEquip(h, it));
    const targetHero = heroUid ? S.heroes.find((h) => h.uid === heroUid) : null;
    const cur = targetHero ? targetHero.equip[it.slot] : null;
    const uc = G.upgradeCost(it); const ec = G.enchantCost(it); const sv = G.salvageYield(it);
    const html = `<h2 class="c${it.rarity}">${esc(it.name)}</h2>
      <div class="row">${itemCard(it)}<div class="grow small"><div>${rar.name} ${it.slot === 'weapon' ? D.WEAPON_TYPES[it.wtype].name : D.SLOT_NAMES[it.slot]} · item level ${it.ilvl}${it.up ? ` · <span class="gold">+${it.up}</span>` : ''}</div><div class="tiny muted">${f.where === 'hero' ? 'Equipped by ' + esc(f.hero.name) : f.where === 'stash' ? 'In stash' : 'In the bag'}</div></div></div>
      <div class="stat-grid mt">${statLine(it, cur && cur.id !== it.id ? cur : null)}</div>
      ${it.affixes.length ? `<div class="mt">${it.affixes.map((a) => { const d = D.AFFIXES.find((x) => x.id === a.id); return `<div class="affix">✦ ${d.name} — +${a.v}${d.pct ? '%' : ''} ${d.stat.toUpperCase()}</div>`; }).join('')}</div>` : ''}
      ${cur && cur.id !== it.id ? `<div class="tiny muted mt">Compared with ${esc(cur.name)} (${rarName(cur)} ${cur.ilvl}${cur.up ? '+' + cur.up : ''}).</div>` : ''}
      <div class="btnrow" style="flex-wrap:wrap">
        ${f.where !== 'bag' ? heroes.map((h) => `<button class="btn small" data-equip="${h.uid}">Equip · ${esc(h.name)}</button>`).join('') : ''}
        ${f.where === 'hero' ? `<button class="btn small" id="is-unequip">Unequip</button>` : ''}
      </div>
      ${f.where !== 'bag' ? `<div class="btnrow" style="flex-wrap:wrap">
        ${S.unlocked.blacksmith ? `<button class="btn small" id="is-up">Upgrade +${it.up + 1} · ${fmt(uc.gold)}g ${uc.scrap} scrap${it.up >= G.upgradeCap() ? ' (cap)' : ''}</button>` : ''}
        ${S.unlocked.enchant && rar.affixes ? `<button class="btn small" id="is-ench">Reroll affixes · ${ec} essence</button>` : ''}
      </div>
      <div class="btnrow">
        ${S.unlocked.blacksmith ? `<button class="btn small" id="is-sell">Sell · ${fmt(G.sellPrice(it))}g</button><button class="btn small" id="is-salvage">Salvage · ${Object.entries(sv).map(([k, v]) => v + ' ' + D.MATERIALS[k].name.split(' ')[0]).join(', ')}</button>` : '<span class="tiny muted">Selling and salvage unlock at the Blacksmith (floor 3).</span>'}
      </div>` : ''}`;
    const m = modal(html);
    $$('[data-equip]', m.el).forEach((b) => b.addEventListener('click', () => { if (err(G.equipItem(b.dataset.equip, id))) { m.close(); markAll(); closeModals(); if (heroUid) heroSheet(heroUid); } }));
    const uq = $('#is-unequip', m.el); if (uq) uq.addEventListener('click', () => { if (err(G.unequip(f.hero.uid, it.slot))) { m.close(); markAll(); closeModals(); } });
    const up = $('#is-up', m.el); if (up) up.addEventListener('click', () => { if (err(G.upgrade(id))) { m.close(); itemSheet(id, heroUid); markAll(); } });
    const en = $('#is-ench', m.el); if (en) en.addEventListener('click', () => { if (err(G.enchant(id))) { m.close(); itemSheet(id, heroUid); markAll(); } });
    const se = $('#is-sell', m.el); if (se) se.addEventListener('click', () => { const g = G.sellPrice(it); if (err(G.sellItem(id))) { toast(`Sold for ${fmt(g)} gold.`); m.close(); markAll(); } });
    const sa = $('#is-salvage', m.el); if (sa) sa.addEventListener('click', () => { if (err(G.salvageItem(id))) { toast('Salvaged.'); m.close(); markAll(); } });
  }
  function renderStash() {
    const el = $('#tab-stash');
    const items = S.stash.slice().sort((a, b) => b.rarity - a.rarity || b.ilvl - a.ilvl);
    const filtered = stashFilter === 'all' ? items : items.filter((it) => it.slot === stashFilter);
    const bestFor = (it) => S.heroes.some((h) => G.canEquip(h, it) && (!h.equip[it.slot] || G.itemScore(it, h) > G.itemScore(h.equip[it.slot], h)));
    let html = `<div class="panel"><h3>Stash <small>${S.stash.length}/${G.stashCap()}</small></h3>
      <div class="mats">${Object.keys(D.MATERIALS).filter((k) => k !== 'ember' && (S.mats[k] > 0 || ['scrap', 'leather', 'essence'].includes(k))).map((k) => `<span title="${esc(D.MATERIALS[k].desc)}"><i style="background:${D.MATERIALS[k].color}"></i>${D.MATERIALS[k].name} <b>${fmt(S.mats[k] || 0)}</b></span>`).join('')}</div>
      <div class="btnrow"><button class="btn small" id="st-best">Equip best on all</button>${S.unlocked.blacksmith ? `<button class="btn small" id="st-sell">Sell junk</button><button class="btn small" id="st-salv">Salvage junk</button>` : ''}</div>
      <div class="tiny muted mt">Junk = common and uncommon gear that no hero would use. ▲ marks an upgrade for someone.</div></div>
      <div class="chips" style="padding:0 10px 8px"><button class="chip ${stashFilter === 'all' ? 'active' : ''}" data-f="all">All</button>${D.SLOTS.map((s) => `<button class="chip ${stashFilter === s ? 'active' : ''}" data-f="${s}">${D.SLOT_NAMES[s]}</button>`).join('')}</div>
      <div class="grid">${filtered.map((it) => itemCard(it, { better: bestFor(it) })).join('')}</div>${filtered.length ? '' : '<div class="center muted small" style="padding:20px">Empty. Loot is banked when you extract.</div>'}`;
    el.innerHTML = html;
    $$('[data-item]', el).forEach((b) => b.addEventListener('click', () => itemSheet(b.dataset.item)));
    $$('[data-f]', el).forEach((b) => b.addEventListener('click', () => { stashFilter = b.dataset.f; renderStash(); }));
    $('#st-best', el).addEventListener('click', () => { const n = G.autoEquipAll(); toast(n ? `Equipped ${n} item${n > 1 ? 's' : ''}.` : 'Everyone already wears their best.'); markAll(); });
    const junk = () => S.stash.filter((it) => it.rarity <= 1 && !bestFor(it));
    const ss = $('#st-sell', el); if (ss) ss.addEventListener('click', () => { const j = junk(); let g = 0; for (const it of j) { g += G.sellPrice(it); G.sellItem(it.id); } toast(j.length ? `Sold ${j.length} items for ${fmt(g)} gold.` : 'No junk to sell.'); markAll(); });
    const sv = $('#st-salv', el); if (sv) sv.addEventListener('click', () => { const j = junk(); for (const it of j) G.salvageItem(it.id); toast(j.length ? `Salvaged ${j.length} items.` : 'No junk to salvage.'); markAll(); });
    dirty.stash = false;
  }

  // ---------- Forge ----------
  function renderForge() {
    const el = $('#tab-forge');
    if (!S.unlocked.blacksmith) { el.innerHTML = `<div class="panel center"><h3>The Forge is cold</h3><div class="small muted">Reach floor 3 to unlock the Blacksmith: sell, salvage and upgrade gear. Floor 5 unlocks crafting.</div></div>`; dirty.forge = false; return; }
    let html = '';
    if (S.unlocked.craft) {
      const cost = G.craftCost(craftSlot); const il = G.craftIlvl();
      const bioMats = Object.keys(D.MATERIALS).filter((k) => !['scrap', 'leather', 'essence', 'ember'].includes(k) && (S.mats[k] || 0) > 0);
      html += `<div class="panel"><h3>Craft <small>item level ${il} · Blacksmith ${S.buildings.blacksmith}</small></h3>
        <div class="chips">${D.SLOTS.map((s) => `<button class="chip ${craftSlot === s ? 'active' : ''}" data-cs="${s}">${D.SLOT_NAMES[s]}</button>`).join('')}</div>
        <div class="small mt">Cost: <b class="gold">${fmt(cost.gold)} gold</b> · <b>${cost.scrap} scrap</b>${cost.leather ? ` · <b>${cost.leather} hide</b>` : ''}</div>
        <div class="small mt">Bonus material (3×, +50% chance of higher rarity): <div class="chips mt">${bioMats.length ? bioMats.map((k) => `<button class="chip ${craftMat === k ? 'active' : ''}" data-cm="${k}">${D.MATERIALS[k].name} ×${S.mats[k]}</button>`).join('') : '<span class="tiny muted">None yet — dungeon materials drop from floor chests and bosses.</span>'}</div></div>
        <div class="tiny muted mt">Crafted gear is always at least Uncommon. Higher Blacksmith levels raise item level and rarity odds.</div>
        <button class="btn primary big mt" id="craft-btn">FORGE ${D.SLOT_NAMES[craftSlot].toUpperCase()}</button></div>`;
    } else html += `<div class="panel"><h3>Craft</h3><div class="small muted">Reach floor 5 to forge new gear from scrap and hide.</div></div>`;
    // upgrade overview: equipped gear across party
    html += `<div class="panel"><h3>Upgrade <small>cap +${G.upgradeCap()}</small></h3><div class="tiny muted mb">Tap equipped gear to upgrade${S.unlocked.enchant ? ' or reroll affixes' : ''}.</div>`;
    for (const h of S.heroes) {
      html += `<div class="row mt" style="align-items:flex-start">${portrait(D.CLASSES[h.cls].img)}<div class="grow"><div class="slots">${D.SLOTS.map((s) => { const it = h.equip[s]; return it ? itemCard(it) : `<div class="item empty">${D.SLOT_NAMES[s]}</div>`; }).join('')}</div></div></div>`;
    }
    html += '</div>';
    if (!S.unlocked.enchant) html += `<div class="panel"><h3>Enchanting</h3><div class="small muted">Reach floor 20 to reroll affixes with Dark Essence.</div></div>`;
    el.innerHTML = html;
    $$('[data-cs]', el).forEach((b) => b.addEventListener('click', () => { craftSlot = b.dataset.cs; renderForge(); }));
    $$('[data-cm]', el).forEach((b) => b.addEventListener('click', () => { craftMat = craftMat === b.dataset.cm ? null : b.dataset.cm; renderForge(); }));
    $$('[data-item]', el).forEach((b) => b.addEventListener('click', () => itemSheet(b.dataset.item)));
    const cb = $('#craft-btn', el); if (cb) cb.addEventListener('click', () => { if (err(G.craft(craftSlot, craftMat))) { const it = S.stash[S.stash.length - 1]; toast(`Forged <span class="c${it.rarity}">${esc(it.name)}</span>`); if ((S.mats[craftMat] || 0) < 3) craftMat = null; markAll(); } });
    dirty.forge = false;
  }

  // ---------- Village ----------
  function renderVillage() {
    const el = $('#tab-village');
    let html = `<div class="village-hero" style="background-image:url(assets/img/bg_village.webp)"><h2>Ashford</h2></div>`;
    if (S.buildings.mine) html += `<div class="panel row between"><div><b>Mine</b> <span class="small muted">${fmt(S.mineStock.gold)} gold · ${fmt(S.mineStock.scrap)} scrap waiting</span></div><button class="btn small primary" id="v-mine">Collect</button></div>`;
    for (const bid of Object.keys(D.BUILDINGS)) {
      const b = D.BUILDINGS[bid]; const lv = S.buildings[bid]; const avail = G.buildingAvailable(bid); const c = G.buildingCost(bid); const maxed = lv >= b.max;
      const can = avail && !maxed && S.gold >= c.gold && (!c.scrap || S.mats.scrap >= c.scrap);
      const ms = D.MILESTONES.find((m) => m.id === b.unlock);
      html += `<div class="bcard ${avail ? '' : 'locked'}"><div class="bi">${b.icon}</div><div class="info"><div class="nm">${b.name}<small>${avail ? (lv ? 'Lv ' + lv : 'Not built') : 'Locked'}</small></div><div class="tiny muted">${esc(b.desc)}</div><div class="small mt" style="margin-top:3px">${avail ? esc(b.effect(lv)) : `Unlocks at floor ${ms ? ms.cond.floor : '?'}`}</div>${avail && !maxed ? `<div class="tiny muted mt" style="margin-top:3px">Next: ${esc(b.effect(lv + 1))}</div>` : ''}</div>
        <div>${avail ? (maxed ? '<span class="tag">MAX</span>' : `<button class="btn small ${can ? 'primary' : ''}" data-build="${bid}" ${can ? '' : 'disabled'}>${fmt(c.gold)}g${c.scrap ? '<br>' + c.scrap + ' scrap' : ''}</button>`) : ''}</div></div>`;
    }
    // guild automation
    if (S.unlocked.guild) {
      const gl = G.guildLevel(); const st = S.settings;
      html += `<div class="panel"><h3>Guild orders <small>automation level ${gl}</small></h3>
        <div class="toggle"><span>Auto-descend after clearing a floor ${gl < 1 ? '<span class="tiny muted">(Guild 1)</span>' : ''}</span><div class="sw ${st.autoDescend ? 'on' : ''}" data-set="autoDescend"></div></div>
        <div class="toggle" style="flex-direction:column;align-items:stretch"><div class="row between"><span>Extract when party health below <b>${pct(st.autoExtractHp)}</b> or someone falls ${gl < 2 ? '<span class="tiny muted">(Guild 2)</span>' : ''}</span></div><input type="range" min="10" max="80" step="5" value="${Math.round(st.autoExtractHp * 100)}" data-range="autoExtractHp" ${gl < 2 ? 'disabled' : ''}></div>
        <div class="toggle"><span>Stop and extract at floor</span><select data-sel="stopAtFloor"><option value="0">never</option>${[5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100].map((f) => `<option value="${f}" ${st.stopAtFloor === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="toggle"><span>Auto-sell on extraction ${gl < 3 ? '<span class="tiny muted">(Guild 3)</span>' : ''}</span><select data-sel="autoSell" ${gl < 3 ? 'disabled' : ''}><option value="none" ${st.autoSell === 'none' ? 'selected' : ''}>nothing</option><option value="common" ${st.autoSell === 'common' ? 'selected' : ''}>commons</option><option value="uncommon" ${st.autoSell === 'uncommon' ? 'selected' : ''}>uncommon &amp; below</option><option value="rare" ${st.autoSell === 'rare' ? 'selected' : ''}>rare &amp; below</option></select></div>
        <div class="toggle"><span>Salvage instead of selling ${gl < 4 ? '<span class="tiny muted">(Guild 4)</span>' : ''}</span><div class="sw ${st.autoSalvage ? 'on' : ''}" data-set="autoSalvage"></div></div>
        <div class="toggle"><span>Auto-equip best gear after extraction ${gl < 5 ? '<span class="tiny muted">(Guild 5)</span>' : ''}</span><div class="sw ${st.autoEquip ? 'on' : ''}" data-set="autoEquip"></div></div>
        <div class="toggle"><span>Set out again after each run ${gl < 6 ? '<span class="tiny muted">(Guild 6)</span>' : ''}</span><div class="sw ${st.autoRestart ? 'on' : ''}" data-set="autoRestart"></div></div>
        <div class="tiny muted mt">Guild 6: the company keeps delving while the game is closed (up to 4 hours). Three wipes in a row halt automatic runs until you send them out yourself.</div></div>`;
    }
    // ascension
    if (S.unlocked.ascension || S.ascensions > 0) {
      html += `<div class="panel"><h3>Ascension <small>${S.ascensions} so far · ${S.embers} Embers</small></h3>
        <div class="small muted">Reset the dungeon, gold, gear and relics. Keep heroes, levels, village and milestones. Gain <b class="gold">${G.ascensionReward()} Embers</b>. Enemies +30% per ascension; loot, gold and XP richer.</div>
        <button class="btn danger big mt" id="v-ascend" ${G.canAscend() && !S.run ? '' : 'disabled'}>ASCEND${S.maxFloor < 60 ? ' (reach floor 60)' : ''}</button>
        <div class="mt">${D.ASCENSION_PERKS.map((p) => { const r = S.perks[p.id] || 0; return `<div class="perk"><div class="grow"><b>${p.name}</b> <span class="muted">${r}/${p.max}</span><div class="tiny muted">${p.desc}</div></div><button class="btn small" data-perk="${p.id}" ${r >= p.max || S.embers < p.cost(r) ? 'disabled' : ''}>${r >= p.max ? 'MAX' : p.cost(r) + ' ✦'}</button></div>`; }).join('')}</div></div>`;
    }
    // milestones
    const next = D.MILESTONES.filter((m) => !S.unlocked[m.id]).slice(0, 3);
    html += `<div class="panel"><h3>Milestones <small>deepest floor ${S.maxFloor}</small></h3>${D.MILESTONES.map((m) => `<div class="milestone-row ${S.unlocked[m.id] ? 'done' : next.includes(m) ? 'next' : 'dim'}"><span class="fl">F${m.cond.floor}</span><span><b>${m.name}</b> — ${esc(m.unlocks)}</span></div>`).join('')}</div>`;
    // stats & settings
    const st = S.stats;
    html += `<div class="panel"><h3>Chronicle</h3><div class="stat-grid"><span>Runs <b>${st.runs}</b></span><span>Extractions <b>${st.extractions}</b></span><span>Wipes <b>${st.wipes}</b></span><span>Kills <b>${fmt(st.kills)}</b></span><span>Bosses <b>${st.bossKills}</b></span><span>Items <b>${fmt(st.itemsFound)}</b></span><span>Gold earned <b>${fmt(st.goldEarned)}</b></span><span>Deepest <b>${st.deepest}</b></span><span>Play time <b>${Math.floor(st.playTicks / 36000)}h ${Math.floor((st.playTicks % 36000) / 600)}m</b></span></div></div>`;
    el.innerHTML = html;
    $$('[data-build]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.upgradeBuilding(b.dataset.build))) { toast(`${D.BUILDINGS[b.dataset.build].name} → level ${S.buildings[b.dataset.build]}`); markAll(); } }));
    const vm = $('#v-mine', el); if (vm) vm.addEventListener('click', () => { G.collectMine(); markAll(); });
    $$('[data-set]', el).forEach((b) => b.addEventListener('click', () => { S.settings[b.dataset.set] = !S.settings[b.dataset.set]; renderVillage(); }));
    $$('[data-range]', el).forEach((b) => b.addEventListener('change', () => { S.settings[b.dataset.range] = +b.value / 100; renderVillage(); }));
    $$('[data-sel]', el).forEach((b) => b.addEventListener('change', () => { const v = b.value; S.settings[b.dataset.sel] = isNaN(+v) ? v : +v; renderVillage(); }));
    $$('[data-perk]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.buyPerk(b.dataset.perk))) markAll(); }));
    const va = $('#v-ascend', el); if (va) va.addEventListener('click', () => { const m = modal(`<h2>Ascend?</h2><p class="small">The dungeon reforms. You lose: gold, stash, equipped gear, relics, waystones. You keep: heroes and levels, village, milestones, materials. You gain <b class="gold">${G.ascensionReward()} Embers</b> for permanent perks.</p><div class="btnrow"><button class="btn" data-close>Not yet</button><button class="btn danger" id="asc-yes">Ascend</button></div>`); $('#asc-yes').addEventListener('click', () => { if (err(G.ascend())) { m.close(); markAll(); toast('<b>ASCENSION</b>The dungeon reforms below Ashford.', 'milestone', 4000); } }); });
    dirty.village = false;
  }

  // ---------- Settings ----------
  function settingsSheet() {
    const m = modal(`<h2>Settings</h2>
      <div class="toggle"><span>Game speed</span><div class="chips">${[1, 2, 3].map((s) => `<button class="chip ${S.settings.speed === s ? 'active' : ''}" data-speed="${s}">${s}×</button>`).join('')}</div></div>
      <div class="toggle"><span>Export save</span><button class="btn small" id="s-export">Copy</button></div>
      <div class="toggle" style="flex-direction:column;align-items:stretch"><span>Import save</span><textarea id="s-import" placeholder="paste save text"></textarea><button class="btn small mt" id="s-import-btn">Import</button></div>
      <div class="toggle"><span>Wipe everything</span><button class="btn small danger" id="s-reset">Reset</button></div>
      <div class="tiny muted mt">GRIMDELVE · an idle descent. Loot and gold are only safe once you extract. Fallen heroes stay down until you leave the dungeon.</div>`);
    $$('[data-speed]', m.el).forEach((b) => b.addEventListener('click', () => { S.settings.speed = +b.dataset.speed; m.close(); settingsSheet(); renderHud(); }));
    $('#s-export', m.el).addEventListener('click', () => { const s = G.exportSave(); const ta = $('#s-import', m.el); ta.value = s; ta.select(); try { document.execCommand('copy'); } catch (e) { /* */ } if (navigator.clipboard) navigator.clipboard.writeText(s).catch(() => {}); toast('Save copied to clipboard (and shown below).'); });
    $('#s-import-btn', m.el).addEventListener('click', () => { const e = G.importSave($('#s-import', m.el).value); if (err(e)) location.reload(); });
    $('#s-reset', m.el).addEventListener('click', () => { const c = modal(`<h2>Wipe the save?</h2><p class="small muted">All progress is lost. There is no undo.</p><div class="btnrow"><button class="btn" data-close>Keep</button><button class="btn danger" id="reset-yes">Wipe</button></div>`); $('#reset-yes').addEventListener('click', () => { G.resetAll(); location.reload(); }); });
  }

  // ---------- Intro / new game ----------
  function intro() {
    const el = $('#intro'); el.classList.remove('hidden');
    const chosen = new Set();
    const render = () => {
      el.innerHTML = `<div class="inner"><h1>GRIMDELVE</h1><div class="sub">There is no bottom. There is only further.</div>
        <div class="small center mb">Choose <b>three</b> to form the first company.</div>
        <div class="pick-grid">${D.STARTER_CLASSES.map((c) => { const cls = D.CLASSES[c]; return `<div class="pick ${chosen.has(c) ? 'sel' : ''}" data-c="${c}">${portrait(cls.img, 'lg')}<div class="nm">${cls.name}</div><div class="tl">${esc(cls.tagline)}</div><div class="st">${cls.role.toUpperCase()} · ${cls.trait.name}</div></div>`; }).join('')}</div>
        <button class="btn primary big mt ${chosen.size === 3 ? 'pulse' : ''}" id="intro-go" ${chosen.size === 3 ? '' : 'disabled'}>ENTER THE CATACOMBS</button>
        <div class="tiny muted center mt">Your heroes fight, loot and descend on their own. After every floor, choose: extract with what you carry, or go deeper for better loot. Die, and the bag is lost.</div></div>`;
      $$('[data-c]', el).forEach((b) => b.addEventListener('click', () => { const c = b.dataset.c; if (chosen.has(c)) chosen.delete(c); else if (chosen.size < 3) chosen.add(c); render(); }));
      $('#intro-go', el).addEventListener('click', () => { if (chosen.size !== 3) return; G.newGame(Array.from(chosen)); S = G.S; el.classList.add('hidden'); el.innerHTML = ''; markAll(); renderAll(); showTab('dungeon'); });
    };
    render();
  }

  // ---------- run end / offline summaries ----------
  function runEndSheet(r) {
    const dead = r.type === 'wipe';
    const title = dead ? 'THE COMPANY FALLS' : r.type === 'abandon' ? 'RETREAT' : 'EXTRACTED';
    const rows = [['Floor reached', r.floor], ['Floors cleared', r.floors], ['Kills', r.kills], ['Gold banked', fmt(r.gold)]];
    if (dead) rows.push(['Gold lost', fmt(r.goldLost)], ['Items recovered', r.items], ['Items lost', r.itemsLost]);
    else if (r.type === 'extract') { rows.push(['Items banked', r.kept]); if (r.sold) rows.push(['Auto-sold', r.sold]); if (r.salvaged) rows.push(['Auto-salvaged', r.salvaged]); const ms = Object.entries(r.mats || {}); if (ms.length) rows.push(['Materials', ms.map(([k, v]) => v + ' ' + D.MATERIALS[k].name).join(', ')]); }
    else rows.push(['Items lost', r.itemsLost]);
    const m = modal(`<div class="big-title ${dead ? 'dead' : 'good'}">${title}</div>${rows.map(([k, v]) => `<div class="summary-stat"><span class="muted">${k}</span><b>${v}</b></div>`).join('')}
      <div class="tiny muted mt">${dead ? 'The Shrine keeps a share of the bag when the company dies. Rest, re-equip, and try again.' : 'Sell or salvage the junk, equip the best, upgrade the village — then go again.'}</div>
      <div class="btnrow"><button class="btn" data-close>Village</button><button class="btn primary" id="re-again">Descend again</button></div>`);
    $('#re-again', m.el).addEventListener('click', () => { m.close(); const ws = G.waystones(); if (err(G.startRun(S.ui && ws.includes(S.ui.startFloor) ? S.ui.startFloor : ws[ws.length - 1]))) markAll(); });
  }
  function offlineSheet(rep) {
    if (!rep) return;
    const h = Math.floor(rep.hours), mnt = Math.round((rep.hours - h) * 60);
    const rows = [['Away for', `${h}h ${mnt}m`]];
    if (rep.mineGold || rep.mineScrap) rows.push(['Mine produced', `${fmt(rep.mineGold)} gold, ${fmt(rep.mineScrap)} scrap`]);
    if (rep.ticks) {
      rows.push(['Floors cleared', rep.floors]);
      if (rep.goldGained > 0) rows.push(['Gold banked', fmt(rep.goldGained)]);
      if (rep.itemsGained > 0) rows.push(['Items found', rep.itemsGained]);
      if (rep.ended.length) rows.push(['Runs', rep.ended.slice(0, 4).map((e) => (e.type === 'wipe' ? 'wiped on ' + e.floor : e.type === 'extract' ? 'extracted from ' + e.floor : 'abandoned')).join(', ') + (rep.ended.length > 4 ? ', …' : '')]);
      if (S.run) rows.push(['Now', `on floor ${S.run.floor}`]);
    }
    if (rows.length === 1 && !S.run) return;
    if (rows.length === 1 && S.run) rows.push(['The company', 'waited for orders (Guild 6 lets them delve while you are away)']);
    modal(`<div class="big-title good">WHILE YOU WERE AWAY</div>${rows.map(([k, v]) => `<div class="summary-stat"><span class="muted">${k}</span><b>${v}</b></div>`).join('')}<div class="btnrow"><button class="btn primary" data-close>Continue</button></div>`);
  }

  // ---------- tabs ----------
  function showTab(name) {
    currentTab = name;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    if (name === 'dungeon') window.Render.resize();
    renderTab(name);
  }
  function renderTab(name) {
    if (name === 'dungeon') { renderDungeon(); renderLog(); }
    else if (name === 'heroes') renderHeroes();
    else if (name === 'stash') renderStash();
    else if (name === 'forge') renderForge();
    else if (name === 'village') renderVillage();
  }
  function markAll() { for (const k in dirty) dirty[k] = true; }
  function renderAll() { renderHud(); renderTab(currentTab); }
  let lastPartyRender = 0;
  function tickUI(now) {
    if (dirty.hud) renderHud();
    if (currentTab === 'dungeon') {
      if (dirty.dungeon) { renderDungeon(); renderLog(); }
      else if (S.run && now - lastPartyRender > 400) { lastPartyRender = now; // cheap HP bar refresh
        S.run.party.forEach((p) => { const card = $(`#dungeon-panel .pcard[data-hero="${p.uid}"]`); if (!card) return; const bar = $('.bar > i', card); if (bar) bar.style.width = pct(p.hp / p.maxhp); const sh = $('.sh', card); if (sh) sh.style.width = pct(Math.min(1, p.shield / p.maxhp)); const t = $('.tiny.muted', card); if (t) t.textContent = `L${S.heroes.find((h) => h.uid === p.uid).level} · ${fmt(p.hp)}/${fmt(p.maxhp)}`; card.classList.toggle('dead', !p.alive); });
        S.run.enemies.forEach((e) => { const row = $(`#dungeon-panel .erow[data-enemy="${e.id}"]`); if (!row) { if (e.alive) dirty.dungeon = true; return; } if (!e.alive) { row.remove(); return; } $('.bar > i', row).style.width = pct(e.hp / e.maxhp); $('.hp', row).textContent = fmt(e.hp); });
      }
    } else if (dirty[currentTab]) renderTab(currentTab);
  }

  function bind() {
    G = window.Game; S = G.S;
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
    $('#btn-speed').addEventListener('click', () => { const s = [1, 2, 3]; S.settings.speed = s[(s.indexOf(S.settings.speed) + 1) % s.length]; renderHud(); });
    $('#btn-settings').addEventListener('click', settingsSheet);
    G.on('newgame', () => { S = G.S; });
    G.on('log', () => { if (!S) return; if (currentTab === 'dungeon') renderLog(); dirty.hud = true; });
    G.on('milestone', (m) => { toast(`<b>${esc(m.name)}</b>${esc(m.unlocks)}`, 'milestone', 5000); markAll(); });
    G.on('levelup', () => { dirty.heroes = true; dirty.hud = true; });
    G.on('runstart', () => { markAll(); });
    G.on('runend', (r) => { markAll(); closeModals(); runEndSheet(r); });
    G.on('floorclear', () => { dirty.dungeon = true; dirty.hud = true; });
    G.on('floor', () => { dirty.dungeon = true; });
    G.on('encounter', () => { dirty.dungeon = true; });
    G.on('roomclear', () => { dirty.dungeon = true; });
    G.on('death', () => { dirty.dungeon = true; });
    G.on('revive', () => { dirty.dungeon = true; });
    G.on('loot', () => { dirty.dungeon = true; });
    G.on('potion', () => { dirty.dungeon = true; });
    G.on('kill', () => { dirty.hud = true; });
    G.on('inv', () => { markAll(); });
    G.on('village', () => { markAll(); });
    G.on('roster', () => { markAll(); });
    G.on('relic', (r) => toast(`<b>RELIC</b>${esc(r.name)} — ${esc(r.desc)}`, 'milestone', 4000));
    G.on('ascend', () => markAll());
  }

  window.UI = { bind, intro, showTab, renderAll, tickUI, markAll, toast, offlineSheet, setState: (s) => { S = s; } };
})();
