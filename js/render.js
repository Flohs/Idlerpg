/* GRIMDELVE — canvas scene renderer */
(function () {
  'use strict';
  const D = window.DATA;
  const IMG = {};
  const loading = {};
  function img(key) {
    if (!key) return null;
    if (IMG[key]) return IMG[key].complete && IMG[key].naturalWidth ? IMG[key] : null;
    if (!loading[key]) { const im = new Image(); im.src = 'assets/img/' + key + '.webp'; IMG[key] = im; loading[key] = true; }
    return null;
  }
  function preload(keys) { keys.forEach(img); }

  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let W = 390, H = 240, DPR = 1;
  const floats = [];   // {id?, x, y, vy, life, text, color, size}
  const anims = {};    // id -> {dx, t, type}
  const pos = {};      // id -> {x, y}
  let scroll = 0, lastT = 0, bgKey = null, bgAlpha = 1, prevBg = null, banner = null, shakeT = 0;
  let walkPhase = 0;

  function resize() {
    const wrap = canvas.parentElement; const w = wrap.clientWidth || 390;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = Math.round(w * 0.6);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);

  function drawCover(im, x, w, h, flip) {
    const ir = im.naturalWidth / im.naturalHeight; const r = w / h;
    let sw = im.naturalWidth, sh = im.naturalHeight, sx = 0, sy = 0;
    if (ir > r) { sw = sh * r; sx = (im.naturalWidth - sw) / 2; } else { sh = sw / r; sy = (im.naturalHeight - sh) / 2; }
    ctx.save();
    if (flip) { ctx.translate(x + w, 0); ctx.scale(-1, 1); ctx.drawImage(im, sx, sy, sw, sh, 0, 0, w, h); }
    else ctx.drawImage(im, sx, sy, sw, sh, x, 0, w, h);
    ctx.restore();
  }
  function drawBg(biome, cycle) {
    const key = biome ? biome.bg : 'bg_village';
    if (key !== bgKey) { prevBg = bgKey; bgKey = key; bgAlpha = 0; }
    const im = img(key);
    const bw = H * 16 / 9; // tile width
    const off = ((scroll % (bw * 2)) + bw * 2) % (bw * 2);
    ctx.fillStyle = biome ? biome.tint : '#1a1612'; ctx.fillRect(0, 0, W, H);
    const drawTiles = (image) => { for (let x = -off; x < W; x += bw * 2) { drawCover(image, x, bw, H, false); drawCover(image, x + bw, bw, H, true); } };
    if (prevBg && bgAlpha < 1) { const pim = img(prevBg); if (pim) drawTiles(pim); }
    if (im) { ctx.globalAlpha = bgAlpha; drawTiles(im); ctx.globalAlpha = 1; }
    // nightmare tint for later cycles
    if (cycle > 0) { ctx.fillStyle = cycle === 1 ? 'rgba(120,20,40,0.22)' : 'rgba(60,0,90,0.3)'; ctx.fillRect(0, 0, W, H); }
    // fog / vignette
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(0,0,0,0.35)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
  function token(x, y, r, key, opts) {
    opts = opts || {};
    const im = img(key);
    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.ellipse(x, y + r + 4, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = '#0a0908'; ctx.fill();
    ctx.save(); ctx.clip();
    if (im) { if (opts.dead) ctx.filter = 'grayscale(1) brightness(0.5)'; ctx.drawImage(im, x - r, y - r, r * 2, r * 2); ctx.filter = 'none'; }
    else { ctx.fillStyle = opts.color || '#333'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    if (opts.flash) { ctx.fillStyle = 'rgba(255,60,40,' + opts.flash + ')'; ctx.fillRect(x - r, y - r, r * 2, r * 2); }
    ctx.restore();
    ctx.lineWidth = opts.boss ? 3 : 2; ctx.strokeStyle = opts.ring || (opts.boss ? '#e0403a' : '#3b3128'); ctx.stroke();
    if (opts.dead) { ctx.strokeStyle = '#a8322a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 0.5, y + r * 0.5); ctx.moveTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x - r * 0.5, y + r * 0.5); ctx.stroke(); }
    ctx.restore();
  }
  function hpbar(x, y, w, pct, shieldPct, boss) {
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 1, y - 1, w + 2, (boss ? 7 : 5) + 2);
    ctx.fillStyle = '#3a1512'; ctx.fillRect(x, y, w, boss ? 7 : 5);
    const grad = ctx.createLinearGradient(0, y, 0, y + 5); grad.addColorStop(0, '#d0473c'); grad.addColorStop(1, '#8a2620');
    ctx.fillStyle = grad; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, pct)), boss ? 7 : 5);
    if (shieldPct > 0) { ctx.fillStyle = 'rgba(122,167,216,0.85)'; ctx.fillRect(x, y, w * Math.min(1, shieldPct), 2); }
  }
  function nameTag(x, y, text, color) {
    ctx.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--serif');
    ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.8)';
    const w = ctx.measureText(text).width + 8; ctx.fillRect(x - w / 2, y - 9, w, 12);
    ctx.fillStyle = color || '#e6dcc6'; ctx.fillText(text, x, y);
  }

  function addFloat(id, text, kind) {
    const p = pos[id]; if (!p) return;
    const colors = { dmg: '#f0e6d2', hurt: '#ff6a5a', crit: '#ffd24a', heal: '#7fe07a', gold: '#f2c14e', miss: '#9a9a9a', shield: '#9cc4ff', status: '#c9b7ff', dot: '#b7e37a', loot: '#d9a0ff' };
    floats.push({ x: p.x + (Math.random() - 0.5) * 20, y: p.y - 24, vy: kind === 'crit' ? -1.3 : -0.9, life: kind === 'crit' || kind === 'loot' ? 1.6 : 1.1, text, color: colors[kind] || '#fff', size: kind === 'crit' ? 16 : kind === 'status' || kind === 'loot' ? 11 : 13, bold: kind === 'crit' });
  }
  function lunge(id, dir) { anims[id] = { t: 0.35, dir }; }
  function flash(id) { anims[id] = Object.assign(anims[id] || {}, { flash: 0.5 }); }
  function showBanner(text, color, dur) { banner = { text, color: color || '#e8b45a', t: dur || 2, dur: dur || 2 }; }
  function shake() { shakeT = 0.35; }

  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016); lastT = now;
    const G = window.Game; const S = G.S;
    if (!S) { requestAnimationFrame(frame); return; }
    const R = S.run;
    const speed = S.settings.speed || 1;
    if (bgAlpha < 1) bgAlpha = Math.min(1, bgAlpha + dt * 1.5);
    ctx.save();
    if (shakeT > 0) { shakeT -= dt; ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); }
    const floor = R ? R.floor : (S.maxFloor ? Math.min(S.maxFloor, 1) : 1);
    const bf = R ? G.biomeFor(R.floor) : null;
    if (R && R.phase === 'travel') { scroll += dt * 70 * speed; walkPhase += dt * 8 * speed; }
    else if (R && R.phase === 'combat') walkPhase += dt * 2;
    drawBg(bf ? bf.biome : null, bf ? bf.cycle : 0);

    const ground = H * 0.68;
    // party
    const party = R ? R.party : S.party.map((uid) => ({ uid, hp: 1, maxhp: 1, alive: true, shield: 0 }));
    const n = party.length;
    const r = Math.max(18, Math.min(30, H * (n >= 4 ? 0.09 : 0.1)));
    party.forEach((p, i) => {
      const h = S.heroes.find((x) => x.uid === p.uid); if (!h) return;
      const cls = D.CLASSES[h.cls];
      const col = i % 2, rowi = Math.floor(i / 2); // col 0 = front line (right), col 1 = back line (left)
      const x = col === 0 ? W * 0.24 : W * 0.09;
      const y = ground - r * 0.7 - rowi * r * 2.5 - col * r * 1.25;
      const bob = R && R.phase === 'travel' && p.alive ? Math.sin(walkPhase + i) * 3 : 0;
      const a = anims[p.uid]; let dx = 0;
      if (a) { if (a.t > 0) { a.t -= dt; dx = Math.sin((0.35 - Math.max(0, a.t)) / 0.35 * Math.PI) * 26 * (a.dir || 1); } if (a.flash > 0) a.flash -= dt * 2; }
      pos[p.uid] = { x: x + dx, y: y + bob };
      token(x + dx, y + bob, r, cls.img, { dead: !p.alive, flash: a && a.flash > 0 ? a.flash : 0, ring: S.party[0] === p.uid ? '#5a4a2a' : null });
      hpbar(x - r, y + r + 8, r * 2, p.hp / p.maxhp, p.shield / p.maxhp);
      if (p.taunt > 0) nameTag(x, y - r - 6, 'TAUNT', '#ffd24a');
    });
    // enemies
    if (R && R.enemies.length && R.phase === 'combat') {
      const en = R.enemies; const m = en.length;
      en.forEach((e, i) => {
        const er = e.boss ? r * 1.5 : r;
        const col = i % 2, rowi = Math.floor(i / 2);
        const x = e.boss ? W * 0.8 : (col === 0 ? W * 0.76 : W * 0.91);
        const y = ground - er * 0.7 - rowi * r * 2.5 - col * r * 1.25;
        const a = anims[e.id]; let dx = 0;
        if (a) { if (a.t > 0) { a.t -= dt; dx = -Math.sin((0.35 - Math.max(0, a.t)) / 0.35 * Math.PI) * 26; } if (a.flash > 0) a.flash -= dt * 2; }
        if (!e.alive) { if (!a || a.deadT === undefined) { anims[e.id] = Object.assign(anims[e.id] || {}, { deadT: 0.5 }); } const d = anims[e.id]; d.deadT -= dt; if (d.deadT <= 0) return; ctx.globalAlpha = Math.max(0, d.deadT * 2); }
        pos[e.id] = { x: x + dx, y };
        token(x + dx, y, er, e.img, { boss: e.boss, flash: a && a.flash > 0 ? a.flash : 0, color: '#4a2a2a' });
        ctx.globalAlpha = 1;
        if (e.alive) { hpbar(x - er, y + er + 8, er * 2, e.hp / e.maxhp, 0, e.boss); if (e.boss || m <= 2) nameTag(x, y - er - 6, e.name, e.boss ? '#ff7a6a' : '#e6dcc6'); if (e.stun > 0) nameTag(x, y + er + 22, 'stunned', '#c9b7ff'); }
      });
    }
    // floats
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.life -= dt; f.y += f.vy * 60 * dt; if (f.life <= 0) { floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = (f.bold ? '800 ' : '700 ') + f.size + 'px ' + (f.bold ? getComputedStyle(document.body).getPropertyValue('--serif') : 'sans-serif');
      ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }
    // banner
    if (banner) {
      banner.t -= dt; if (banner.t <= 0) banner = null;
      else { const a = Math.min(1, banner.t * 2, (banner.dur - banner.t) * 3); ctx.globalAlpha = a; ctx.font = '700 ' + Math.round(H * 0.11) + 'px ' + getComputedStyle(document.body).getPropertyValue('--serif'); ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(banner.text, W / 2, H * 0.42); ctx.fillStyle = banner.color; ctx.fillText(banner.text, W / 2, H * 0.42); ctx.globalAlpha = 1; }
    }
    // idle hint
    if (!R) { ctx.font = 'italic 12px ' + getComputedStyle(document.body).getPropertyValue('--serif'); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(230,220,200,0.7)'; ctx.fillText('The company waits at the gate.', W / 2, H * 0.3); }
    else if (R.phase === 'floorclear') { ctx.font = '700 ' + Math.round(H * 0.08) + 'px ' + getComputedStyle(document.body).getPropertyValue('--serif'); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.3); ctx.fillStyle = '#e8b45a'; ctx.fillText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.3); }
    ctx.restore();
    requestAnimationFrame(frame);
  }

  function start() { resize(); requestAnimationFrame(frame); }

  // subscribe to engine events
  function bind() {
    const G = window.Game;
    G.on('float', (f) => addFloat(f.id, f.text, f.kind));
    G.on('attack', (a) => { lunge(a.id, a.id.startsWith('h') ? 1 : -1); if (a.target && a.target !== 'all') flash(a.target); else if (a.target === 'all') (G.S.run ? G.S.run.party : []).forEach((p) => flash(p.uid)); });
    G.on('skill', (s) => { lunge(s.id, 1); const p = pos[s.id]; if (p) floats.push({ x: p.x, y: p.y - 40, vy: -0.5, life: 1.2, text: s.name, color: '#ffe0a0', size: 11, bold: true }); });
    G.on('kill', (k) => { if (k.boss) { showBanner('BOSS SLAIN', '#ff9a6a', 2.2); shake(); } });
    G.on('death', () => shake());
    G.on('loot', (l) => { const p = pos[l.id]; if (p) floats.push({ x: p.x, y: p.y - 30, vy: -0.6, life: 1.8, text: l.item.name, color: D.RARITIES[l.item.rarity].color, size: 11, bold: true }); });
    G.on('encounter', (e) => { if (e.boss) showBanner(e.enemies[0].name.toUpperCase(), '#e0403a', 2.5); });
    G.on('floor', (f) => { const b = G.biomeFor(f.floor); if ((f.floor - 1) % D.FLOORS_PER_BIOME === 0) showBanner(b.biome.name.toUpperCase(), b.biome.accent, 3); });
    G.on('runstart', () => { scroll = 0; });
    G.on('levelup', (l) => { const p = pos[l.hero.uid]; if (p) floats.push({ x: p.x, y: p.y - 44, vy: -0.6, life: 1.8, text: 'LEVEL ' + l.hero.level, color: '#ffe08a', size: 13, bold: true }); });
  }

  window.Render = { start, bind, preload, img, resize, showBanner };
})();
