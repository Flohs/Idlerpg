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
  let descendFloor = {};

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
    $$('#tabs button').forEach((b) => { const t = b.dataset.tab; b.classList.toggle('locked', t === 'forge' && !S.unlocked.blacksmith); });
    const badge = $('#tabs button[data-tab=village] .badge');
    const canAfford = Object.keys(D.BUILDINGS).some((bid) => G.buildingAvailable(bid) && S.buildings[bid] < D.BUILDINGS[bid].max && G.buildingCost(bid).gold <= S.gold && (!G.buildingCost(bid).scrap || G.buildingCost(bid).scrap <= S.mats.scrap)) || (S.mineStock.gold >= 50);
    if (canAfford && !badge) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = '!'; $('#tabs button[data-tab=village]').appendChild(b); }
    else if (!canAfford && badge) badge.remove();
    const hb = $('#tabs button[data-tab=heroes] .badge'); const pts = S.heroes.some((h) => h.points > 0 && !h.autoSkills);
    if (pts && !hb) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = '+'; $('#tabs button[data-tab=heroes]').appendChild(b); } else if (!pts && hb) hb.remove();
    dirty.hud = false;
  }

  // ---------- Delve tab ----------
  function partyCards(party) {
    return `<div class="party">${party.map((p) => { const h = S.heroes.find((x) => x.uid === p.uid); if (!h) return ''; return `<div class="pcard ${p.alive ? '' : 'dead'}" data-hero="${p.uid}">${portrait(D.CLASSES[h.cls].img)}<div class="grow" style="min-width:0"><div class="nm">${esc(h.name)}</div><div class="bar"><i style="width:${pct(p.hp / p.maxhp)}"></i><span class="sh" style="width:${pct(Math.min(1, p.shield / p.maxhp))}"></span></div><div class="tiny muted">L${h.level} · ${fmt(p.hp)}/${fmt(p.maxhp)}</div></div></div>`; }).join('')}</div>`;
  }
  function enemyRows(enemies) {
    return `<div class="enemies mt">${enemies.filter((e) => e.alive).map((e) => `<div class="erow" data-enemy="${e.id}"><span class="nm ${e.boss ? 'blood' : ''}">${e.boss ? '☠ ' : ''}${esc(e.name)}</span><div class="bar"><i style="width:${pct(e.hp / e.maxhp)}"></i></div><span class="tiny muted hp">${fmt(e.hp)}</span></div>`).join('')}</div>`;
  }
  function renderDungeon() {
    const R = S.run; const Wd = S.world; const panel = $('#dungeon-panel'); const label = $('#scene-label');
    let html = '';
    if (R) {
      const bf = G.biomeFor(R.floor); const encTotal = R.map.encounters; const stop = R.map.route[R.room];
      $('#quest-line').classList.add('hidden');
      label.innerHTML = `<span>Floor <b>${R.floor}</b> · <span class="biome">${esc(bf.biome.name)}${bf.cycle ? ' ' + 'I'.repeat(bf.cycle + 1) : ''}</span></span><span>${R.phase === 'floorclear' ? 'Exit' : (stop && stop.boss && R.phase === 'combat') ? 'BOSS' : (stop && stop.side && R.phase === 'combat') ? 'Alcove' : 'Room ' + Math.min(encTotal, (R.encDone || 0) + 1) + '/' + encTotal}</span>`;
      html += `<div class="panel">${partyCards(R.party)}${R.phase === 'combat' ? enemyRows(R.enemies) : ''}
        <div class="row between mt small"><span>Bag <b>${R.bag.length}</b> · Gold <b class="gold">${fmt(R.gold)}</b> · Kills <b>${R.kills}</b></span><span class="muted">${R.potions > 0 ? '⚗ ' + R.potions : ''} ${R.floorsCleared ? '· ' + R.floorsCleared + ' floors' : ''}</span></div>
        ${R.bag.length ? `<div class="row mt" style="flex-wrap:wrap;gap:4px">${R.bag.slice(-8).map((it) => `<span class="tiny c${it.rarity}">${esc(it.name)}</span>`).join('<span class="dim tiny">·</span>')}</div>` : ''}</div>`;
      if (R.phase === 'floorclear') {
        const next = G.biomeFor(R.floor + 1); const newBiome = R.floor % D.FLOORS_PER_BIOME === 0;
        const alive = R.party.filter((p) => p.alive); const avg = alive.reduce((a, p) => a + p.hp / p.maxhp, 0) / alive.length;
        const auto = G.guildLevel() >= 1 && S.settings.autoDescend;
        html += `<div class="panel decision"><div class="center small muted mb">${newBiome ? `<span class="gold">A new dungeon opens below: ${esc(next.biome.name)}.</span> ` : ''}Party health ${pct(avg)}${alive.length < R.party.length ? ` · <span class="blood">${R.party.length - alive.length} fallen</span>` : ''}${auto ? ' · <span class="green">auto-deciding…</span>' : ''}</div>
          <div class="btnrow"><button class="btn big" id="btn-extract">EXTRACT<small>to the surface · bank ${R.bag.length} items · ${fmt(R.gold)} gold</small></button><button class="btn big primary" id="btn-descend">GO DEEPER<small>Floor ${R.floor + 1}${G.isBossFloor(R.floor + 1) ? ' · BOSS' : ''}${newBiome ? ' · ' + esc(next.biome.name) : ''}</small></button></div></div>`;
      } else html += `<div class="row" style="padding:0 10px"><button class="btn small ghost" id="btn-abandon">Abandon run</button><span class="grow"></span><span class="tiny muted">${R.phase === 'travel' ? 'Advancing…' : 'Fighting'}</span></div>`;
    } else if (Wd) {
      const m = Wd.map; const theme = D.ZONE_THEMES.find((t) => t.id === m.theme);
      const phase = Wd.phase === 'combat' ? 'Fighting' : Wd.phase === 'dead' ? 'Fallen…' : Wd.order ? (Wd.order.type === 'exit' ? 'Marching to the road onward' : 'Marching to the ' + esc((m.pois.find((p) => p.id === Wd.order.poi) || {}).name || 'dungeon')) : Wd.uncovered ? 'Zone charted' : 'Exploring';
      label.innerHTML = `<span>Zone <b>${Wd.zone}</b> · <span class="biome">${esc(m.title)}</span></span><span>${phase}</span>`;
      const aq = G.activeQuest(); const ql = $('#quest-line'); ql.classList.remove('hidden');
      ql.innerHTML = aq ? `<b>${esc(aq.name)}</b>${aq.target ? ` <span class="q-prog">${aq.progress || 0}/${aq.target}</span>` : ''}<span class="q-desc"> — ${esc(aq.desc)}</span>` : `<b>${esc(m.title)} is done.</b><span class="q-desc"> — march on when you are ready.</span>`;
      html += `<div class="panel">${partyCards(Wd.party)}${Wd.phase === 'combat' && Wd.enc ? enemyRows(Wd.enc.enemies) : ''}
        <div class="row between mt small"><span>Charted <b>${Math.round(G.exploredPct() * 100)}%</b> · Camps <b>${m.pois.filter((p) => p.type === 'camp' && p.done).length}/${m.pois.filter((p) => p.type === 'camp').length}</b></span><span class="muted">${Wd.potions > 0 ? '⚗ ' + Wd.potions : ''}</span></div></div>`;
      // orders
      const dungeons = G.foundDungeons();
      html += `<div class="panel"><h3>Orders <small>${Wd.order ? 'in effect' : 'the company explores on its own'}</small></h3>`;
      if (Wd.order) html += `<div class="row between small"><span>${phase}.</span><button class="btn small" id="btn-cancel-order">Cancel</button></div>`;
      if (dungeons.length) {
        for (const d of dungeons) {
          const ws = G.waystones().filter((f) => f >= d.baseFloor); if (!ws.includes(d.baseFloor)) ws.unshift(d.baseFloor);
          if (!descendFloor[d.id] || !ws.includes(descendFloor[d.id])) descendFloor[d.id] = ws[ws.length - 1];
          const cleared = (Wd.cleared || {})[d.id] >= d.baseFloor;
          html += `<div class="mt"><div class="row between"><b class="c3">${esc(d.name)}</b><span class="tiny muted">floor ${d.baseFloor}+ ${cleared ? '· cleared' : ''}</span></div>
            ${ws.length > 1 ? `<div class="chips mt">${ws.map((f) => `<button class="chip ${descendFloor[d.id] === f ? 'active' : ''}" data-ws="${d.id}:${f}">Floor ${f}</button>`).join('')}</div>` : ''}
            <button class="btn primary big mt ${Wd.order && Wd.order.poi === d.id ? '' : 'pulse'}" data-descend="${d.id}" ${Wd.order && Wd.order.poi === d.id ? 'disabled' : ''}>DESCEND · ${esc(d.name).toUpperCase()}<small style="display:block;font-size:11px;letter-spacing:0;font-family:var(--sans);font-weight:400">the company walks to the entrance and goes down at floor ${descendFloor[d.id]}</small></button></div>`;
        }
      } else if (!Wd.order) html += `<div class="tiny muted mt">No way down found yet.</div>`;
      const can = G.canAdvance();
      if (can) html += `<button class="btn big mt primary" id="btn-exit" ${!(Wd.order && Wd.order.type === 'exit') ? '' : 'disabled'}>MARCH TO THE NEXT ZONE<small style="display:block;font-size:11px;letter-spacing:0;font-family:var(--sans);font-weight:400">the road onward is open</small></button>`;
      html += '</div>';
    }
    panel.innerHTML = html;
    $$('[data-hero]', panel).forEach((b) => b.addEventListener('click', () => heroSheet(b.dataset.hero)));
    $$('[data-ws]', panel).forEach((b) => b.addEventListener('click', () => { const [id, f] = b.dataset.ws.split(':'); descendFloor[id] = +f; renderDungeon(); }));
    $$('[data-descend]', panel).forEach((b) => b.addEventListener('click', () => { if (err(G.order('dungeon', b.dataset.descend, descendFloor[b.dataset.descend]))) markAll(); }));
    const bx = $('#btn-exit'); if (bx) bx.addEventListener('click', () => { if (err(G.order('exit'))) markAll(); });
    const bc = $('#btn-cancel-order'); if (bc) bc.addEventListener('click', () => { G.order('cancel'); markAll(); });
    const be = $('#btn-extract'); if (be) be.addEventListener('click', () => err(G.extract()));
    const bd = $('#btn-descend'); if (bd) bd.addEventListener('click', () => err(G.descend()));
    const ba = $('#btn-abandon'); if (ba) ba.addEventListener('click', () => { const m = modal(`<h2>Abandon the run?</h2><p class="small muted">Everything in the bag is lost. Heroes keep their experience.</p><div class="btnrow"><button class="btn" data-close>Stay</button><button class="btn danger" id="abandon-yes">Abandon</button></div>`); $('#abandon-yes').addEventListener('click', () => { m.close(); G.abandonRun(); markAll(); }); });
    dirty.dungeon = false;
  }
  function renderLog() { const el = $('#log'); el.innerHTML = S.log.slice(-6).reverse().map((l) => `<div class="${l.k}">${esc(l.t)}</div>`).join(''); }

  // ---------- Heroes tab ----------
  function renderHeroes() {
    const el = $('#tab-heroes');
    let html = `<div class="panel"><h3>Roster <small>${S.heroes.length}/${G.rosterCap()} · party ${S.party.length}/${G.partySizeCap()}</small></h3><div class="tiny muted">Tap a hero for gear, skill tree and points. Toggle who joins the company.</div></div>`;
    for (const h of S.heroes) {
      const cls = D.CLASSES[h.cls]; const st = G.heroStats(h); const inP = S.party.includes(h.uid);
      html += `<div class="hcard ${inP ? 'inparty' : ''}" data-hero="${h.uid}">${portrait(cls.img, 'lg')}<div class="info"><div class="nm">${esc(h.name)} <small>Lv ${h.level} ${cls.role}</small>${h.points > 0 ? ` <span class="tag" style="color:var(--gold2);border-color:var(--gold)">${h.points} pt${h.points > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="bar xp"><i style="width:${pct(h.xp / G.xpToNext(h.level))}"></i></div>
        <div class="tiny muted mt" style="margin-top:4px">HP ${fmt(st.hp)} · ATK ${fmt(st.atk)} · DEF ${fmt(st.def)} · SPD ${st.spd} · CRIT ${st.crit}%</div>
        <div class="row mt" style="margin-top:6px"><span class="tag ${inP ? 'party' : ''}">${inP ? 'In party' : 'Resting'}</span><span class="grow"></span><button class="btn small" data-toggle="${h.uid}">${inP ? 'Bench' : 'Add to party'}</button></div></div></div>`;
    }
    const cost = G.recruitCost();
    const avail = Object.keys(D.CLASSES).filter((c) => G.classUnlocked(c));
    html += `<div class="panel"><h3>Tavern <small>recruit for ${fmt(cost)} gold</small></h3>${S.heroes.length >= G.rosterCap() ? '<div class="small blood">Roster full — upgrade the Tavern in the Village.</div>' : ''}
      <div class="pick-grid mt">${avail.map((c) => { const cls = D.CLASSES[c]; return `<div class="pick" data-recruit="${c}">${portrait(cls.img, 'lg')}<div class="nm">${cls.name}</div><div class="tl">${esc(cls.tagline)}</div><div class="st">${cls.role.toUpperCase()} · ${cls.trait.name}</div></div>`; }).join('')}</div>
      ${Object.keys(D.CLASSES).filter((c) => !G.classUnlocked(c)).length ? `<div class="tiny muted mt">Locked: ${Object.keys(D.CLASSES).filter((c) => !G.classUnlocked(c)).map((c) => D.CLASSES[c].name).join(', ')} — found deeper in the dungeons.</div>` : ''}</div>`;
    if (S.relics.length) html += `<div class="panel"><h3>Relics</h3>${S.relics.map((id) => { const r = D.RELICS.find((x) => x.id === id); return `<span class="relic" title="${esc(r.desc)}">${esc(r.name)} <span class="muted">${esc(r.desc)}</span></span>`; }).join('')}</div>`;
    el.innerHTML = html;
    $$('[data-hero]', el).forEach((b) => b.addEventListener('click', (e) => { if (e.target.closest('[data-toggle]')) return; heroSheet(b.dataset.hero); }));
    $$('[data-toggle]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.toggleParty(b.dataset.toggle))) markAll(); }));
    $$('[data-recruit]', el).forEach((b) => b.addEventListener('click', () => { const cls = D.CLASSES[b.dataset.recruit]; const m = modal(`<h2>Recruit ${cls.name}?</h2><div class="row">${portrait(cls.img, 'xl')}<div><div class="small"><i>${esc(cls.tagline)}</i></div><div class="small mt"><b>${cls.trait.name}:</b> ${esc(cls.trait.desc)}</div><div class="tiny muted mt">Weapons: ${cls.weapons.map((w) => D.WEAPON_TYPES[w].name).join(', ')}</div></div></div><div class="mt small">Skills: ${D.TREES[cls.id].map((n) => D.SKILLS[n.id].name).join(', ')}</div><div class="btnrow"><button class="btn" data-close>Not now</button><button class="btn primary" id="rec-yes">Recruit · ${fmt(G.recruitCost())} gold</button></div>`); $('#rec-yes').addEventListener('click', () => { if (err(G.recruit(b.dataset.recruit))) { m.close(); markAll(); } }); }));
    dirty.heroes = false;
  }
  function itemCard(it, opts) {
    opts = opts || {};
    return `<div class="item r${it.rarity} ${opts.better ? 'better' : ''}" data-item="${it.id}" style="background-image:url(assets/img/${D.SLOT_ICON[it.slot]}.webp)"><span class="lv">${it.ilvl}</span>${it.up ? `<span class="up">+${it.up}</span>` : ''}${opts.eq ? '<span class="eq">E</span>' : ''}</div>`;
  }
  function skillDesc(h, sid) {
    const sk = D.SKILLS[sid]; const r = G.rank(h, sid);
    if (sk.type === 'passive') return sk.desc.replace('{per}', sk.per) + (r ? ` <span class="green">Now: +${sk.per * r}%</span>` : '');
    const m = Math.round((sk.mult || 0) * 100 * G.skillMult(h, sk, sid));
    let d = sk.desc.replace('{mult}', m);
    const syn = sk.syn ? Object.keys(sk.syn).map((k) => `${D.SKILLS[k].name} +${sk.syn[k]}%/rank`).join(', ') : '';
    return d + (syn ? ` <span class="tiny muted">Synergy: ${syn}.</span>` : '');
  }
  function heroSheet(uid) {
    const h = S.heroes.find((x) => x.uid === uid); if (!h) return;
    const cls = D.CLASSES[h.cls]; const st = G.heroStats(h); const inP = S.party.includes(uid);
    const tree = D.TREES[h.cls];
    const tiers = [1, 2, 3].map((t) => tree.filter((n) => n.tier === t));
    const html = `<h2>${esc(h.name)} <span class="muted small">Lv ${h.level} ${cls.name}</span></h2>
      <div class="row">${portrait(cls.img, 'xl')}<div class="grow"><div class="small"><i>${esc(cls.tagline)}</i></div><div class="bar xp mt"><i style="width:${pct(h.xp / G.xpToNext(h.level))}"></i></div><div class="tiny muted">${fmt(h.xp)} / ${fmt(G.xpToNext(h.level))} xp · power ${fmt(G.heroPower(h))}</div>
        <div class="small mt"><b>${cls.trait.name}</b> — ${esc(cls.trait.desc)}</div></div></div>
      <div class="stat-grid mt"><span>HP <b>${fmt(st.hp)}</b></span><span>ATK <b>${fmt(st.atk)}</b></span><span>DEF <b>${fmt(st.def)}</b></span><span>SPD <b>${st.spd}</b></span><span>CRIT <b>${st.crit}%</b></span><span>Leech <b>${st.lifesteal}%</b></span>${st.evade ? `<span>Evade <b>${st.evade}%</b></span>` : ''}${st.critdmg ? `<span>Crit dmg <b>+${st.critdmg}%</b></span>` : ''}${st.gold ? `<span>Gold <b>+${st.gold}%</b></span>` : ''}${st.xp ? `<span>XP <b>+${st.xp}%</b></span>` : ''}${st.loot ? `<span>Loot <b>+${st.loot}%</b></span>` : ''}${st.thorns ? `<span>Thorns <b>${st.thorns}%</b></span>` : ''}</div>
      <h3 class="mt gold" style="font-family:var(--serif);font-size:14px;margin-bottom:4px">Equipment</h3>
      <div class="slots">${D.SLOTS.map((s) => { const it = h.equip[s]; return it ? itemCard(it) : `<div class="item empty" data-slot="${s}">${D.SLOT_NAMES[s]}</div>`; }).join('')}</div>
      <div class="slots">${D.SLOTS.map((s) => `<div class="slot-name">${D.SLOT_NAMES[s]}</div>`).join('')}</div>
      <div class="btnrow"><button class="btn" id="hs-best">Equip best</button><button class="btn ${inP ? '' : 'primary'}" id="hs-toggle">${inP ? 'Bench' : 'Add to party'}</button></div>
      <div class="row between mt"><h3 class="gold" style="font-family:var(--serif);font-size:14px;margin:0">Skill tree <small class="muted" style="font-family:var(--sans);font-weight:400;font-size:11px">${h.points} point${h.points === 1 ? '' : 's'} to spend</small></h3><span class="tiny row" style="gap:6px">Auto-spend <div class="sw ${h.autoSkills ? 'on' : ''}" id="hs-auto"></div></span></div>
      ${tiers.map((nodes, ti) => `<div class="tier"><div class="tiny muted" style="margin:6px 0 2px">Tier ${ti + 1} · level ${D.TIER_LEVEL[ti]}${h.level < D.TIER_LEVEL[ti] ? ' (locked)' : ''}</div>${nodes.map((n) => { const sk = D.SKILLS[n.id]; const r = G.rank(h, n.id); const can = G.canSpend(h, n.id); return `<div class="skill ${r ? '' : 'locked'} ${sk.type === 'passive' ? 'passive' : ''}"><div class="row between"><b>${sk.name} <span class="muted">${r}/${D.MAX_RANK}</span>${sk.type === 'passive' ? ' <span class="tag">passive</span>' : ` <span class="tiny muted">cd ${Math.max(1, sk.cd - Math.floor(r / 10))}</span>`}</b><button class="btn small ${can ? '' : 'primary'}" data-spend="${n.id}" ${can ? 'disabled' : ''} title="${can || ''}">+</button></div><div class="tiny">${skillDesc(h, n.id)}${n.req ? ` <span class="dim">Requires ${D.SKILLS[n.req].name}.</span>` : ''}</div></div>`; }).join('')}</div>`).join('')}
      <div class="btnrow"><button class="btn small ghost" id="hs-respec">Respec · ${fmt(G.respecCost(h))} gold</button><button class="btn small ghost" id="hs-dismiss">Dismiss hero</button></div>`;
    const m = modal(html);
    $$('[data-item]', m.el).forEach((b) => b.addEventListener('click', () => itemSheet(b.dataset.item, uid)));
    $$('[data-slot]', m.el).forEach((b) => b.addEventListener('click', () => pickForSlot(uid, b.dataset.slot)));
    $$('[data-spend]', m.el).forEach((b) => b.addEventListener('click', () => { if (err(G.spendPoint(uid, b.dataset.spend))) { const top = $('.sheet', m.el).scrollTop; m.close(); heroSheet(uid); $('.sheet').scrollTop = top; markAll(); } }));
    $('#hs-auto', m.el).addEventListener('click', () => { G.toggleAutoSkills(uid); const top = $('.sheet', m.el).scrollTop; m.close(); heroSheet(uid); $('.sheet').scrollTop = top; markAll(); });
    $('#hs-respec', m.el).addEventListener('click', () => { const c = modal(`<h2>Respec ${esc(h.name)}?</h2><p class="small muted">All skill points are refunded for ${fmt(G.respecCost(h))} gold.</p><div class="btnrow"><button class="btn" data-close>Keep</button><button class="btn danger" id="rs-yes">Respec</button></div>`); $('#rs-yes').addEventListener('click', () => { if (err(G.respec(uid))) { c.close(); m.close(); heroSheet(uid); markAll(); } }); });
    $('#hs-best', m.el).addEventListener('click', () => { if (S.run && inP) return err('Cannot change gear in the dungeon.'); const n = G.autoEquip(uid); toast(n ? `Equipped ${n} item${n > 1 ? 's' : ''}.` : 'Nothing better in the stash.'); m.close(); heroSheet(uid); markAll(); });
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
      <div class="grid">${filtered.map((it) => itemCard(it, { better: bestFor(it) })).join('')}</div>${filtered.length ? '' : '<div class="center muted small" style="padding:20px">Empty. Surface loot is banked at once; dungeon loot when you extract.</div>'}`;
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
    if (!S.unlocked.blacksmith) { el.innerHTML = `<div class="panel center"><h3>The Forge is cold</h3><div class="small muted">Reach dungeon floor 3 to unlock the Blacksmith: sell, salvage and upgrade gear. Floor 5 unlocks crafting.</div></div>`; dirty.forge = false; return; }
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
    html += `<div class="panel"><h3>Upgrade <small>cap +${G.upgradeCap()}</small></h3><div class="tiny muted mb">Tap equipped gear to upgrade${S.unlocked.enchant ? ' or reroll affixes' : ''}.</div>`;
    for (const h of S.heroes) html += `<div class="row mt" style="align-items:flex-start">${portrait(D.CLASSES[h.cls].img)}<div class="grow"><div class="slots">${D.SLOTS.map((s) => { const it = h.equip[s]; return it ? itemCard(it) : `<div class="item empty">${D.SLOT_NAMES[s]}</div>`; }).join('')}</div></div></div>`;
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
      html += `<div class="bcard ${avail ? '' : 'locked'}"><div class="bi">${b.icon}</div><div class="info"><div class="nm">${b.name}<small>${avail ? (lv ? 'Lv ' + lv : 'Not built') : 'Locked'}</small></div><div class="tiny muted">${esc(b.desc)}</div><div class="small mt" style="margin-top:3px">${avail ? esc(b.effect(lv)) : `Unlocks at dungeon floor ${ms ? ms.cond.floor : '?'}`}</div>${avail && !maxed ? `<div class="tiny muted mt" style="margin-top:3px">Next: ${esc(b.effect(lv + 1))}</div>` : ''}</div>
        <div>${avail ? (maxed ? '<span class="tag">MAX</span>' : `<button class="btn small ${can ? 'primary' : ''}" data-build="${bid}" ${can ? '' : 'disabled'}>${fmt(c.gold)}g${c.scrap ? '<br>' + c.scrap + ' scrap' : ''}</button>`) : ''}</div></div>`;
    }
    if (S.unlocked.guild) {
      const gl = G.guildLevel(); const st = S.settings;
      html += `<div class="panel"><h3>Guild orders <small>automation level ${gl}</small></h3>
        <div class="toggle"><span>Auto-descend after clearing a floor ${gl < 1 ? '<span class="tiny muted">(Guild 1)</span>' : ''}</span><div class="sw ${st.autoDescend ? 'on' : ''}" data-set="autoDescend"></div></div>
        <div class="toggle" style="flex-direction:column;align-items:stretch"><div class="row between"><span>Extract when party health below <b>${pct(st.autoExtractHp)}</b> or someone falls ${gl < 2 ? '<span class="tiny muted">(Guild 2)</span>' : ''}</span></div><input type="range" min="10" max="80" step="5" value="${Math.round(st.autoExtractHp * 100)}" data-range="autoExtractHp" ${gl < 2 ? 'disabled' : ''}></div>
        <div class="toggle"><span>Stop and extract at floor</span><select data-sel="stopAtFloor"><option value="0">never</option>${[5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100].map((f) => `<option value="${f}" ${st.stopAtFloor === f ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
        <div class="toggle"><span>Auto-sell on extraction ${gl < 3 ? '<span class="tiny muted">(Guild 3)</span>' : ''}</span><select data-sel="autoSell" ${gl < 3 ? 'disabled' : ''}><option value="none" ${st.autoSell === 'none' ? 'selected' : ''}>nothing</option><option value="common" ${st.autoSell === 'common' ? 'selected' : ''}>commons</option><option value="uncommon" ${st.autoSell === 'uncommon' ? 'selected' : ''}>uncommon &amp; below</option><option value="rare" ${st.autoSell === 'rare' ? 'selected' : ''}>rare &amp; below</option></select></div>
        <div class="toggle"><span>Delve found dungeons when the zone is done ${gl < 3 ? '<span class="tiny muted">(Guild 3)</span>' : ''}</span><div class="sw ${st.autoDelve ? 'on' : ''}" data-set="autoDelve"></div></div>
        <div class="toggle"><span>Salvage instead of selling ${gl < 4 ? '<span class="tiny muted">(Guild 4)</span>' : ''}</span><div class="sw ${st.autoSalvage ? 'on' : ''}" data-set="autoSalvage"></div></div>
        <div class="toggle"><span>Auto-equip best gear after extraction ${gl < 5 ? '<span class="tiny muted">(Guild 5)</span>' : ''}</span><div class="sw ${st.autoEquip ? 'on' : ''}" data-set="autoEquip"></div></div>
        <div class="toggle"><span>March to the next zone when all quests are done ${gl < 6 ? '<span class="tiny muted">(Guild 6)</span>' : ''}</span><div class="sw ${st.autoNextZone ? 'on' : ''}" data-set="autoNextZone"></div></div>
        <div class="tiny muted mt">Guild 6: the company keeps exploring and delving while the game is closed (up to 4 hours). Three dungeon wipes in a row halt automatic runs.</div></div>`;
    }
    if (S.unlocked.ascension || S.ascensions > 0) {
      html += `<div class="panel"><h3>Rebirth <small>${S.ascensions} so far · ${S.embers} Embers</small></h3>
        <div class="small muted">Reset the world, gold, gear and relics. Keep heroes, levels, skills, village and milestones. Gain <b class="gold">${G.ascensionReward()} Embers</b>. Enemies +30% per rebirth; loot, gold and XP richer.</div>
        <button class="btn danger big mt" id="v-ascend" ${G.canAscend() && !S.run ? '' : 'disabled'}>REBIRTH${S.maxFloor < 60 ? ' (reach floor 60)' : ''}</button>
        <div class="mt">${D.ASCENSION_PERKS.map((p) => { const r = S.perks[p.id] || 0; return `<div class="perk"><div class="grow"><b>${p.name}</b> <span class="muted">${r}/${p.max}</span><div class="tiny muted">${p.desc}</div></div><button class="btn small" data-perk="${p.id}" ${r >= p.max || S.embers < p.cost(r) ? 'disabled' : ''}>${r >= p.max ? 'MAX' : p.cost(r) + ' ✦'}</button></div>`; }).join('')}</div></div>`;
    }
    const next = D.MILESTONES.filter((m) => !S.unlocked[m.id]).slice(0, 3);
    html += `<div class="panel"><h3>Milestones <small>deepest floor ${S.maxFloor}</small></h3>${D.MILESTONES.map((m) => `<div class="milestone-row ${S.unlocked[m.id] ? 'done' : next.includes(m) ? 'next' : 'dim'}"><span class="fl">F${m.cond.floor}</span><span><b>${m.name}</b> — ${esc(m.unlocks)}</span></div>`).join('')}</div>`;
    const st = S.stats;
    html += `<div class="panel"><h3>Chronicle</h3><div class="stat-grid"><span>Zones <b>${S.world ? S.world.zone : 1}</b></span><span>Quests <b>${st.quests}</b></span><span>Camps <b>${st.campsCleared}</b></span><span>Runs <b>${st.runs}</b></span><span>Extractions <b>${st.extractions}</b></span><span>Wipes <b>${st.wipes}</b></span><span>Kills <b>${fmt(st.kills)}</b></span><span>Bosses <b>${st.bossKills}</b></span><span>Items <b>${fmt(st.itemsFound)}</b></span><span>Gold earned <b>${fmt(st.goldEarned)}</b></span><span>Deepest <b>${st.deepest}</b></span><span>Play time <b>${Math.floor(st.playTicks / 36000)}h ${Math.floor((st.playTicks % 36000) / 600)}m</b></span></div></div>`;
    el.innerHTML = html;
    $$('[data-build]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.upgradeBuilding(b.dataset.build))) { toast(`${D.BUILDINGS[b.dataset.build].name} → level ${S.buildings[b.dataset.build]}`); markAll(); } }));
    const vm = $('#v-mine', el); if (vm) vm.addEventListener('click', () => { G.collectMine(); markAll(); });
    $$('[data-set]', el).forEach((b) => b.addEventListener('click', () => { S.settings[b.dataset.set] = !S.settings[b.dataset.set]; renderVillage(); }));
    $$('[data-range]', el).forEach((b) => b.addEventListener('change', () => { S.settings[b.dataset.range] = +b.value / 100; renderVillage(); }));
    $$('[data-sel]', el).forEach((b) => b.addEventListener('change', () => { const v = b.value; S.settings[b.dataset.sel] = isNaN(+v) ? v : +v; renderVillage(); }));
    $$('[data-perk]', el).forEach((b) => b.addEventListener('click', () => { if (err(G.buyPerk(b.dataset.perk))) markAll(); }));
    const va = $('#v-ascend', el); if (va) va.addEventListener('click', () => { const m = modal(`<h2>Rebirth?</h2><p class="small">The world reforms. You lose: gold, stash, equipped gear, relics, the current zone. You keep: heroes, levels, skills, village, milestones, materials. You gain <b class="gold">${G.ascensionReward()} Embers</b> for permanent perks.</p><div class="btnrow"><button class="btn" data-close>Not yet</button><button class="btn danger" id="asc-yes">Rebirth</button></div>`); $('#asc-yes').addEventListener('click', () => { if (err(G.ascend())) { m.close(); markAll(); toast('<b>REBIRTH</b>The world reforms around Ashford.', 'milestone', 4000); } }); });
    dirty.village = false;
  }

  // ---------- Settings ----------
  function settingsSheet() {
    const m = modal(`<h2>Settings</h2>
      <div class="toggle"><span>Game speed</span><div class="chips">${[1, 2, 3].map((s) => `<button class="chip ${S.settings.speed === s ? 'active' : ''}" data-speed="${s}">${s}×</button>`).join('')}</div></div>
      <div class="toggle" style="flex-direction:column;align-items:stretch"><span>Sound effects <b>${Math.round(S.settings.sfx * 100)}%</b></span><input type="range" min="0" max="100" step="5" value="${Math.round(S.settings.sfx * 100)}" id="s-sfx"></div>
      <div class="toggle" style="flex-direction:column;align-items:stretch"><span>Music <b>${Math.round(S.settings.music * 100)}%</b></span><input type="range" min="0" max="100" step="5" value="${Math.round(S.settings.music * 100)}" id="s-music"></div>
      <div class="toggle"><span>Export save</span><button class="btn small" id="s-export">Copy</button></div>
      <div class="toggle" style="flex-direction:column;align-items:stretch"><span>Import save</span><textarea id="s-import" placeholder="paste save text"></textarea><button class="btn small mt" id="s-import-btn">Import</button></div>
      <div class="toggle"><span>Wipe everything</span><button class="btn small danger" id="s-reset">Reset</button></div>
      <div class="tiny muted mt">GRIMDELVE · an idle descent. Audio files go in assets/audio (see README). Dungeon loot is only safe once you extract; fallen heroes stay down until you leave the dungeon.</div>`);
    $$('[data-speed]', m.el).forEach((b) => b.addEventListener('click', () => { S.settings.speed = +b.dataset.speed; m.close(); settingsSheet(); renderHud(); }));
    const vol = () => { S.settings.sfx = +$('#s-sfx', m.el).value / 100; S.settings.music = +$('#s-music', m.el).value / 100; window.AudioFX.setVolumes(S.settings.sfx, S.settings.music); };
    $('#s-sfx', m.el).addEventListener('change', () => { vol(); window.AudioFX.play('hit'); });
    $('#s-music', m.el).addEventListener('change', vol);
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
        <div class="small center mb">Choose <b>one</b> hero to walk out of the gate. Others can be hired at the Tavern later.</div>
        <div class="pick-grid">${D.STARTER_CLASSES.map((c) => { const cls = D.CLASSES[c]; return `<div class="pick ${chosen.has(c) ? 'sel' : ''}" data-c="${c}">${portrait(cls.img, 'lg')}<div class="nm">${cls.name}</div><div class="tl">${esc(cls.tagline)}</div><div class="st">${cls.role.toUpperCase()} · ${cls.trait.name}</div></div>`; }).join('')}</div>
        <button class="btn primary big mt ${chosen.size === 1 ? 'pulse' : ''}" id="intro-go" ${chosen.size === 1 ? '' : 'disabled'}>LEAVE THE GATE</button>
        <div class="tiny muted center mt">Your hero starts with nothing but a basic attack; every level brings a skill point to spend in the tree. They explore the blighted land on their own: fight, loot, chart every zone. When they find a way underground, order them down. In the dungeon, after every floor you choose: extract with what you carry, or go deeper. Die below, and the bag is lost.</div></div>`;
      $$('[data-c]', el).forEach((b) => b.addEventListener('click', () => { const c = b.dataset.c; chosen.clear(); chosen.add(c); render(); }));
      $('#intro-go', el).addEventListener('click', () => { if (chosen.size !== 1) return; G.newGame(Array.from(chosen)); S = G.S; el.classList.add('hidden'); el.innerHTML = ''; markAll(); renderAll(); showTab('dungeon'); });
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
      <div class="tiny muted mt">${dead ? 'The company wakes at the zone\'s start. The Shrine keeps a share of the bag when they die below.' : 'The company climbs back into daylight at the entrance. Sell or salvage the junk, equip the best — then go again.'}</div>
      <div class="btnrow"><button class="btn" data-close>Surface</button>${r.entrance ? `<button class="btn primary" id="re-again">Descend again</button>` : ''}</div>`);
    const ra = $('#re-again', m.el); if (ra) ra.addEventListener('click', () => { m.close(); if (err(G.order('dungeon', r.entrance, S.ui.startFloor))) markAll(); });
  }
  function offlineSheet(rep) {
    if (!rep) return;
    const h = Math.floor(rep.hours), mnt = Math.round((rep.hours - h) * 60);
    const rows = [['Away for', `${h}h ${mnt}m`]];
    if (rep.mineGold || rep.mineScrap) rows.push(['Mine produced', `${fmt(rep.mineGold)} gold, ${fmt(rep.mineScrap)} scrap`]);
    if (rep.ticks) {
      if (rep.floors) rows.push(['Floors cleared', rep.floors]);
      if (rep.camps) rows.push(['Camps broken', rep.camps]);
      if (rep.quests) rows.push(['Quests done', rep.quests]);
      if (rep.goldGained > 0) rows.push(['Gold banked', fmt(rep.goldGained)]);
      if (rep.itemsGained > 0) rows.push(['Items found', rep.itemsGained]);
      if (rep.ended.length) rows.push(['Runs', rep.ended.slice(0, 4).map((e) => (e.type === 'wipe' ? 'wiped on ' + e.floor : e.type === 'extract' ? 'extracted from ' + e.floor : 'abandoned')).join(', ') + (rep.ended.length > 4 ? ', …' : '')]);
      rows.push(['Now', S.run ? `on floor ${S.run.floor}` : `zone ${S.world.zone}, ${Math.round(G.exploredPct() * 100)}% charted`]);
    }
    if (rows.length === 1) { rows.push(['The company', 'waited for orders (Guild 6 lets them carry on while you are away)']); }
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
  let lastPartyRender = 0, lastLabel = '';
  function tickUI(now) {
    if (dirty.hud) renderHud();
    if (currentTab === 'dungeon') {
      if (dirty.dungeon) { renderDungeon(); renderLog(); }
      else if (now - lastPartyRender > 400) {
        lastPartyRender = now;
        const B = S.run || (S.world && S.world.phase === 'combat' ? S.world.enc : null);
        const party = S.run ? S.run.party : (S.world ? S.world.party : []);
        party.forEach((p) => { const card = $(`#dungeon-panel .pcard[data-hero="${p.uid}"]`); if (!card) return; const bar = $('.bar > i', card); if (bar) bar.style.width = pct(p.hp / p.maxhp); const sh = $('.sh', card); if (sh) sh.style.width = pct(Math.min(1, p.shield / p.maxhp)); const t = $('.tiny.muted', card); if (t) t.textContent = `L${S.heroes.find((h) => h.uid === p.uid).level} · ${fmt(p.hp)}/${fmt(p.maxhp)}`; card.classList.toggle('dead', !p.alive); });
        if (B) B.enemies.forEach((e) => { const row = $(`#dungeon-panel .erow[data-enemy="${e.id}"]`); if (!row) { if (e.alive) dirty.dungeon = true; return; } if (!e.alive) { row.remove(); return; } $('.bar > i', row).style.width = pct(e.hp / e.maxhp); $('.hp', row).textContent = fmt(e.hp); });
        if (!S.run && S.world) { const aq = G.activeQuest(); const k = S.world.phase + '|' + (S.world.order ? S.world.order.type : '') + '|' + Math.round(G.exploredPct() * 100) + '|' + (aq ? aq.id + (aq.progress || 0) : 'none'); if (k !== lastLabel) { lastLabel = k; dirty.dungeon = true; } }
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
    G.on('quest', (q) => { toast(`<b>QUEST COMPLETE</b>${esc(q.name)}`, 'milestone', 4000); markAll(); });
    G.on('poi', (p) => { if (p.type === 'dungeon' || p.type === 'exit' || p.type === 'lair') { toast(`<b>${p.type === 'dungeon' ? 'A WAY DOWN' : p.type === 'exit' ? 'THE ROAD ONWARD' : 'A LAIR'}</b>${esc(p.name || (p.type === 'exit' ? 'The way to the next zone is found.' : 'Something rules here.'))}`, 'milestone', 3500); } markAll(); });
    G.on('levelup', () => { dirty.heroes = true; dirty.hud = true; });
    G.on('runstart', () => { markAll(); });
    G.on('runend', (r) => { markAll(); closeModals(); runEndSheet(r); });
    ['floorclear', 'floor', 'encounter', 'encounterend', 'roomclear', 'death', 'revive', 'loot', 'potion', 'chest', 'order', 'zone', 'surface', 'worldwipe', 'shrineused'].forEach((ev) => G.on(ev, () => { dirty.dungeon = true; dirty.hud = true; }));
    G.on('kill', () => { dirty.hud = true; });
    G.on('inv', () => { markAll(); });
    G.on('village', () => { markAll(); });
    G.on('roster', () => { markAll(); });
    G.on('relic', (r) => toast(`<b>RELIC</b>${esc(r.name)} — ${esc(r.desc)}`, 'milestone', 4000));
    G.on('ascend', () => markAll());
    G.on('worldwipe', (w) => toast(`<b>THE COMPANY FALLS</b>They wake at the start of the zone, ${fmt(w.lost)} gold poorer.`, 'bad', 4000));
  }

  window.UI = { bind, intro, showTab, renderAll, tickUI, markAll, toast, offlineSheet, setState: (s) => { S = s; } };
})();
