/* GRIMDELVE — isometric renderer for the overworld and the dungeon.
 * Static sprites moved in code: the party walks corridors and open country, picks foes and closes in,
 * monsters hover or charge, projectiles and sky-borne spells land with bursts. Includes the zone minimap.
 */
(function () {
  'use strict';
  const D = window.DATA;
  const DG = window.Dungeon;
  const WD = () => window.World;
  const IMG = {}, loading = {};
  function img(key) {
    if (!key) return null;
    if (IMG[key]) return IMG[key].complete && IMG[key].naturalWidth ? IMG[key] : null;
    if (!loading[key]) { const im = new Image(); im.src = 'assets/img/' + key + '.webp'; IMG[key] = im; loading[key] = true; }
    return null;
  }
  function preload(keys) { keys.forEach(img); }

  const TW = 48, TH = 24, WALLH = 34, LOWH = 7, SPR_H = 48, BOSS_H = 74, ROCKH = 16;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let W = 390, H = 300, DPR = 1;
  const cam = { x: 0, y: 0, init: false };
  const ents = {};
  const fx = [];
  const floats = [];
  const tileCache = {};
  const doorAnim = {};
  let banner = null, shakeT = 0, lastT = 0, torchPhase = 0, lastFloorKey = '', lastZoneKey = '';
  const trail = []; // leader trail for the snake formation on the surface
  let minimap = null, minimapCount = -1, minimapZone = '';
  const serif = () => getComputedStyle(document.body).getPropertyValue('--serif');
  const RANGED_ENEMY = { plague_cultist: 'dark', imp: 'fire', watcher: 'dark', void_spawn: 'dark', myconid: 'poison', mother_spore: 'poison', the_unmaker: 'dark', starved_god: 'dark', frost_king: 'ice', frost_wight: 'ice', forge_master: 'fire', spore_crawler: 'poison', faceless: 'dark' };
  const FLYING = { grave_bat: 1, imp: 1, watcher: 1, void_spawn: 1 };
  const HERO_RANGED = { ranger: 'arrow', pyromancer: 'fire', necromancer: 'bolt', priest: 'holy' };
  const CLASS_COLOR = { knight: '#e8e0d0', rogue: '#c9d6ff', priest: '#ffe6a0', pyromancer: '#ff8a3a', ranger: '#cfe8b0', necromancer: '#8ff09a', berserker: '#ff6a5a', paladin: '#ffd66a' };
  const PROJ_COLOR = { arrow: '#d8d0c0', fire: '#ff8a2a', bolt: '#7dff8a', holy: '#ffe08a', dark: '#b57cff', poison: '#9be36a', ice: '#a9d1ff' };
  const POI_SPRITE = { camp: ['prop_camp', 84], dungeon: ['prop_dungeon', 70], shrine: ['prop_shrine', 54], chest: ['prop_chest', 30], lair: ['prop_lair', 74], exit: ['prop_exit', 84], town: ['prop_town', 96], waypoint: ['prop_shrine', 54] };

  function resize() {
    const wrap = canvas.parentElement; const w = wrap.clientWidth || 390;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = Math.round(w * 0.95);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    for (const k in tileCache) delete tileCache[k];
  }
  window.addEventListener('resize', resize);

  // ---------- projection ----------
  const iso = (x, y) => ({ sx: (x - y) * TW / 2, sy: (x + y) * TH / 2 });
  function toScreen(x, y) { const p = iso(x, y), c = iso(cam.x, cam.y); return { x: W / 2 + p.sx - c.sx, y: H * 0.56 + p.sy - c.sy }; }

  // ---------- tile prerender ----------
  function groundTile(key, dark) {
    const ck = key + (dark ? 'd' : '');
    if (tileCache[ck]) return tileCache[ck];
    const im = img(key); if (!im) return null;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(TW * DPR); cv.height = Math.ceil(TH * DPR);
    const g = cv.getContext('2d'); g.scale(DPR, DPR);
    g.translate(TW / 2, TH / 2); g.scale(1, 0.5); g.rotate(Math.PI / 4);
    const s = TW / Math.SQRT2 + 1.5;
    g.drawImage(im, -s / 2, -s / 2, s, s);
    if (dark) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-s / 2, -s / 2, s, s); }
    tileCache[ck] = cv; return cv;
  }
  function diamond(px, py, w, h) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + w / 2, py + h / 2); ctx.lineTo(px, py + h); ctx.lineTo(px - w / 2, py + h / 2); ctx.closePath(); }
  // ---- continuous ground: patterns filled in world space so textures run seamlessly across tiles ----
  const patCache = {};
  function pattern(key, tilesPer, shift) {
    const ck = key + ':' + tilesPer; let p = patCache[ck];
    if (!p) { const im = img(key); if (!im) return null; p = ctx.createPattern(im, 'repeat'); if (!p) return null; p.__w = im.naturalWidth; p.__h = im.naturalHeight; patCache[ck] = p; }
    try { p.setTransform(new DOMMatrix([tilesPer / p.__w, 0, 0, tilesPer / p.__h, shift || 0, 0])); } catch (e) { /* old browsers keep the unscaled pattern */ }
    return p;
  }
  function isoTransform() { const c = iso(cam.x, cam.y); ctx.setTransform(DPR * TW / 2, DPR * TH / 2, -DPR * TW / 2, DPR * TH / 2, DPR * (W / 2 - c.sx), DPR * (H * 0.56 - c.sy)); }
  function resetTransform() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
  function worldBounds() {
    const c = iso(cam.x, cam.y); const inv = (sx, sy) => { const rx = sx - (W / 2 - c.sx), ry = sy - (H * 0.56 - c.sy); return { x: (rx / (TW / 2) + ry / (TH / 2)) / 2, y: (ry / (TH / 2) - rx / (TW / 2)) / 2 }; };
    const pts = [inv(0, -90), inv(W, -90), inv(0, H + 40), inv(W, H + 40)];
    return { x0: Math.floor(Math.min(...pts.map((q) => q.x))) - 1, x1: Math.ceil(Math.max(...pts.map((q) => q.x))) + 1, y0: Math.floor(Math.min(...pts.map((q) => q.y))) - 1, y1: Math.ceil(Math.max(...pts.map((q) => q.y))) + 1 };
  }
  // soft fog of war: a quarter-resolution mask upscaled with smoothing gives blurred edges for free
  let fogCv = null, fogCtx = null; const FOG_SCALE = 0.25;
  function drawFogLayer(revealed) {
    const fw = Math.ceil(W * FOG_SCALE), fh = Math.ceil(H * FOG_SCALE);
    if (!fogCv || fogCv.width !== fw || fogCv.height !== fh) { fogCv = document.createElement('canvas'); fogCv.width = fw; fogCv.height = fh; fogCtx = fogCv.getContext('2d'); }
    const g = fogCtx; g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.fillStyle = '#030302'; g.fillRect(0, 0, fw, fh);
    const c = iso(cam.x, cam.y); const s = FOG_SCALE;
    g.setTransform(s * TW / 2, s * TH / 2, -s * TW / 2, s * TH / 2, s * (W / 2 - c.sx), s * (H * 0.56 - c.sy));
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fill(revealed);
    g.setTransform(1, 0, 0, 1, 0, 0);
    resetTransform(); ctx.imageSmoothingEnabled = true; ctx.drawImage(fogCv, 0, 0, fw, fh, 0, 0, W, H);
  }
  function wallFace(im, x0, y0, dx, dy, hgt, slice, shade) {
    const w = 64, h = 256;
    ctx.save();
    if (im) { ctx.transform(dx / w, dy / w, 0, hgt / h, x0, y0 - hgt); ctx.drawImage(im, slice, 0, 64, 256, 0, 0, w, h); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
    ctx.beginPath(); ctx.moveTo(x0, y0 - hgt); ctx.lineTo(x0 + dx, y0 + dy - hgt); ctx.lineTo(x0 + dx, y0 + dy); ctx.lineTo(x0, y0); ctx.closePath();
    if (!im) { ctx.fillStyle = '#2a2420'; ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,' + shade + ')'; ctx.fill();
    ctx.restore();
  }
  function drawBlock(tx, ty, p, wallKey, topTile, hgt, hidden, tint) {
    const im = img(wallKey);
    const slice = ((tx * 53 + ty * 17) % 3) * 64;
    wallFace(im, p.x - TW / 2, p.y + TH / 2, TW / 2, TH / 2, hgt, slice, hidden ? 0.8 : 0.42);
    wallFace(im, p.x, p.y + TH, TW / 2, -TH / 2, hgt, (slice + 64) % 192, hidden ? 0.8 : 0.22);
    if (topTile) ctx.drawImage(topTile, p.x - TW / 2, p.y - hgt, TW, TH);
    diamond(p.x, p.y - hgt, TW, TH);
    ctx.fillStyle = hidden ? 'rgba(4,3,2,0.95)' : (tint || 'rgba(0,0,0,0.5)'); ctx.fill();
    ctx.strokeStyle = hidden ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function drawDoor(tx, ty, dir, open, hidden) {
    const a = dir === 'ns' ? toScreen(tx, ty + 0.5) : toScreen(tx + 0.5, ty), b = dir === 'ns' ? toScreen(tx + 1, ty + 0.5) : toScreen(tx + 0.5, ty + 1);
    const im = img('tile_door');
    const k = 1 - open * 0.82;
    const dx = (b.x - a.x) * k, dy = (b.y - a.y) * k;
    if (open > 0) { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.beginPath(); ctx.moveTo(a.x, a.y - WALLH); ctx.lineTo(b.x, b.y - WALLH); ctx.lineTo(b.x, b.y); ctx.lineTo(a.x, a.y); ctx.closePath(); ctx.fill(); }
    ctx.save();
    if (im) { ctx.transform(dx / 256, dy / 256, 0, WALLH / 256, a.x, a.y - WALLH); ctx.drawImage(im, 0, 0, 256, 256); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
    ctx.beginPath(); ctx.moveTo(a.x, a.y - WALLH); ctx.lineTo(a.x + dx, a.y + dy - WALLH); ctx.lineTo(a.x + dx, a.y + dy); ctx.lineTo(a.x, a.y); ctx.closePath();
    if (!im) { ctx.fillStyle = '#3a2a18'; ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,' + (hidden ? 0.7 : 0.25) + ')'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  function drawStairs(p) {
    diamond(p.x, p.y, TW, TH); ctx.fillStyle = '#050403'; ctx.fill();
    for (let i = 0; i < 4; i++) { const t = i / 4; ctx.strokeStyle = 'rgba(120,105,85,' + (0.5 - t * 0.4) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x - TW / 2 + t * TW / 2, p.y + TH / 2 - t * TH / 2 + 3); ctx.lineTo(p.x + t * TW / 2, p.y + TH - t * TH / 2 - 2); ctx.stroke(); }
  }
  function drawProp(p, k, accent) {
    ctx.save(); ctx.translate(p.x, p.y + TH / 2);
    if (k === 0) { ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a4634'; ctx.fillRect(-9, -13, 18, 13); ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-9, -8, 18, 2); ctx.beginPath(); ctx.ellipse(0, -13, 9, 5, 0, 0, Math.PI * 2); ctx.fillStyle = '#6a5440'; ctx.fill(); }
    else if (k === 1) { ctx.strokeStyle = '#cfc4a8'; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-8 + i * 5, 2 - (i % 2) * 3); ctx.lineTo(-2 + i * 4, -5 + (i % 2) * 4); ctx.stroke(); } ctx.fillStyle = '#d8ccb0'; ctx.beginPath(); ctx.arc(5, -2, 3, 0, Math.PI * 2); ctx.fill(); }
    else if (k === 2) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = accent; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = '#2c2622'; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(0, -11); ctx.lineTo(7, 0); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function drawTorch(p) {
    const f = 0.8 + Math.sin(torchPhase * 9 + p.x) * 0.15 + Math.sin(torchPhase * 23 + p.y) * 0.08;
    const fx0 = p.x - TW / 4, fy0 = p.y + TH * 0.75 - WALLH * 0.55;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(fx0, fy0 + 12, 3, fx0, fy0 + 12, TW * 1.6 * f);
    g.addColorStop(0, 'rgba(255,150,60,0.28)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(fx0, fy0 + 12, TW * 1.6 * f, TH * 1.6 * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(fx0 - 1, fy0, 2.5, 9);
    ctx.fillStyle = 'rgba(255,140,40,0.9)'; ctx.beginPath(); ctx.ellipse(fx0, fy0 - 2, 3 * f, 5.5 * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,140,0.95)'; ctx.beginPath(); ctx.ellipse(fx0, fy0 - 1.5, 1.6 * f, 3 * f, 0, 0, Math.PI * 2); ctx.fill();
  }
  function drawSpriteImg(key, p, h, opts) {
    opts = opts || {};
    const im = img(key); if (!im) return false;
    const w = h * im.naturalWidth / im.naturalHeight;
    if (opts.shadow !== false) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, w * 0.35, w * 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.save(); if (opts.alpha != null) ctx.globalAlpha = opts.alpha; if (opts.dark) ctx.filter = 'brightness(0.55) saturate(0.6)';
    ctx.drawImage(im, p.x - w / 2, p.y - h + (opts.dy || 0), w, h); ctx.restore(); return true;
  }

  // ---------- entities ----------
  function ent(id, x, y, kind) {
    let e = ents[id];
    if (!e) { e = ents[id] = { id, x, y, kind, face: kind === 'hero' ? 1 : -1, lunge: 0, ldx: 0, ldy: 0, lvx: 0, lvy: 0, flash: 0, deadT: 0, bob: Math.random() * 6, init: false }; }
    return e;
  }
  function drawSprite(re, key, portraitKey, opts) {
    const p = toScreen(re.x + re.ldx, re.y + re.ldy);
    const im = img(key);
    const h = (opts.boss ? BOSS_H : SPR_H) * (opts.scale || 1);
    const bob = opts.walking ? Math.abs(Math.sin(re.bob)) * 2.5 : 0;
    const hover = opts.flying && !opts.dead ? 14 + Math.sin(re.bob * 0.5 + re.x) * 4 : 0;
    ctx.fillStyle = 'rgba(0,0,0,' + (hover ? 0.3 : 0.45) + ')'; ctx.beginPath(); ctx.ellipse(p.x, p.y, (opts.boss ? 18 : 11) * (hover ? 0.7 : 1), (opts.boss ? 8 : 5) * (hover ? 0.7 : 1), 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y - bob - hover);
    if (opts.dead) { ctx.globalAlpha = 0.55; ctx.rotate(re.face > 0 ? 1.35 : -1.35); ctx.filter = 'grayscale(1) brightness(0.6)'; }
    if (re.face < 0 !== (opts.nativeLeft || false)) ctx.scale(-1, 1);
    if (im) {
      const w = h * im.naturalWidth / im.naturalHeight;
      ctx.drawImage(im, -w / 2, -h, w, h);
      if (re.flash > 0) { ctx.globalAlpha = Math.min(1, re.flash) * 0.9; ctx.filter = 'brightness(3) saturate(0.2)'; ctx.drawImage(im, -w / 2, -h, w, h); }
    } else {
      const pim = img(portraitKey); const r = opts.boss ? 20 : 13;
      ctx.beginPath(); ctx.arc(0, -r - 3, r, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); ctx.save(); ctx.clip(); if (pim) ctx.drawImage(pim, -r, -r * 2 - 3, r * 2, r * 2); ctx.restore(); ctx.strokeStyle = opts.boss ? '#e0403a' : '#3b3128'; ctx.lineWidth = 2; ctx.stroke();
      if (re.flash > 0) { ctx.fillStyle = 'rgba(255,80,60,' + Math.min(1, re.flash) * 0.6 + ')'; ctx.fill(); }
    }
    ctx.restore();
    return { x: p.x, y: p.y - hover, h: h + hover };
  }
  function hpBar(p, w, pct, shieldPct, boss, yoff) {
    const y = p.y + (yoff || 5);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, (boss ? 5 : 3) + 2);
    ctx.fillStyle = '#3a1512'; ctx.fillRect(p.x - w / 2, y, w, boss ? 5 : 3);
    ctx.fillStyle = boss ? '#d0473c' : '#b5392e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, Math.min(1, pct)), boss ? 5 : 3);
    if (shieldPct > 0) { ctx.fillStyle = 'rgba(122,167,216,0.9)'; ctx.fillRect(p.x - w / 2, y, w * Math.min(1, shieldPct), 1.5); }
  }
  function nameTag(x, y, text, color) {
    ctx.font = '600 9px ' + serif(); ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 8; ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - w / 2, y - 8, w, 11);
    ctx.fillStyle = color || '#e6dcc6'; ctx.fillText(text, x, y);
  }
  // steer an entity toward a desired point, avoiding blocked tiles; returns whether it moved
  function steer(re, tx, ty, dt, speed, blocked) {
    const dx = tx - re.x, dy = ty - re.y; const dist = Math.hypot(dx, dy);
    if (dist < 0.05) return false;
    const step = Math.min(dist, speed * dt);
    let nx = re.x + dx / dist * step, ny = re.y + dy / dist * step;
    if (blocked) { if (blocked(nx, ny)) { if (!blocked(nx, re.y)) ny = re.y; else if (!blocked(re.x, ny)) nx = re.x; else return false; } }
    re.face = (nx - re.x) - (ny - re.y) >= -0.0001 ? 1 : -1;
    re.x = nx; re.y = ny; re.bob += dt * 10; return true;
  }
  function separate(list, dt) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]; const dx = b.x - a.x, dy = b.y - a.y; const d = Math.hypot(dx, dy) || 0.001;
      if (d < 0.55) { const push = (0.55 - d) * 0.5 * Math.min(1, dt * 8); a.x -= dx / d * push; a.y -= dy / d * push; b.x += dx / d * push; b.y += dy / d * push; }
    }
  }
  // combat movement for both theatres: everyone closes on (or keeps range from) their chosen target
  function combatMove(B, dt, speed, blocked, area) {
    const heroes = B.party.filter((p) => p.alive && ents[p.uid]).map((p) => ({ p, re: ents[p.uid] }));
    const enemies = B.enemies.filter((e) => e.alive && ents[e.id]).map((e) => ({ e, re: ents[e.id] }));
    for (const { p, re } of heroes) {
      const h = window.Game.S.heroes.find((x) => x.uid === p.uid); if (!h) continue;
      let t = enemies.find((x) => x.e.id === p.target) || nearest(re, enemies.map((x) => x.re));
      if (!t) continue; const tr = t.re || t;
      const ranged = !!HERO_RANGED[h.cls]; const want = ranged ? 2.6 : 0.85;
      const d = Math.hypot(tr.x - re.x, tr.y - re.y);
      if (re.lunge <= 0) {
        if (d > want + 0.15) re.moving = steer(re, tr.x, tr.y, dt, 3 * speed, blocked);
        else if (ranged && d < want - 0.8) re.moving = steer(re, re.x - (tr.x - re.x), re.y - (tr.y - re.y), dt, 2 * speed, blocked);
        else { re.moving = false; re.face = (tr.x - re.x) - (tr.y - re.y) >= 0 ? 1 : -1; }
      }
    }
    for (const { e, re } of enemies) {
      let t = heroes.find((x) => x.p.uid === e.target) || nearest(re, heroes.map((x) => x.re));
      if (!t) continue; const tr = t.re || t;
      const ranged = !!RANGED_ENEMY[e.eid]; const want = ranged ? 2.4 : 0.85;
      const d = Math.hypot(tr.x - re.x, tr.y - re.y);
      if (re.lunge <= 0) {
        if (d > want + 0.15) re.moving = steer(re, tr.x, tr.y, dt, (FLYING[e.eid] ? 3.4 : 2.4) * speed, blocked);
        else { re.moving = false; re.face = (tr.x - re.x) - (tr.y - re.y) >= 0 ? 1 : -1; }
      }
    }
    separate([...heroes.map((x) => x.re), ...enemies.map((x) => x.re)], dt);
    if (area) for (const x of [...heroes, ...enemies]) { const re = x.re; re.x = Math.max(area.x0, Math.min(area.x1, re.x)); re.y = Math.max(area.y0, Math.min(area.y1, re.y)); }
  }
  function nearest(re, list) { let best = null, bd = Infinity; for (const o of list) { const d = Math.hypot(o.x - re.x, o.y - re.y); if (d < bd) { bd = d; best = o; } } return best; }
  function updateLunges(dt) {
    for (const id in ents) { const e = ents[id]; if (e.lunge > 0) { e.lunge -= dt; const kk = Math.max(0, e.lunge) / 0.32; const s = Math.sin((1 - kk) * Math.PI); e.ldx = e.lvx * s; e.ldy = e.lvy * s; if (e.lunge <= 0) { e.lunge = 0; e.ldx = 0; e.ldy = 0; } } if (e.flash > 0) e.flash -= dt * 3; }
  }

  // ---------- effects ----------
  function addFx(o) { o.t = 0; fx.push(o); }
  function entPos(id) { const e = ents[id]; return e ? { x: e.x + e.ldx, y: e.y + e.ldy } : null; }
  function projectile(fromId, toId, kind, big) { const a = entPos(fromId), b = entPos(toId); if (!a || !b) return; addFx({ type: 'proj', kind, a, b, dur: 0.28, big, toId }); }
  function fallOn(toId, kind, big, delay) { const b = entPos(toId); if (!b) return; addFx({ type: 'fall', kind, b, dur: 0.42, big, toId, delay: delay || 0 }); }
  function slashAt(id, color, big, delay) { const p = entPos(id); if (!p) return; addFx({ type: 'slash', p, color, big, dur: 0.28, delay: delay || 0, rot: Math.random() * 1.2 - 0.6 }); }
  function burstAt(pos, color, big) { addFx({ type: 'burst', p: pos, color, dur: 0.35, big }); }
  function lungeTo(id, targetId) {
    const e = ents[id], t = ents[targetId]; if (!e) return;
    const dx = t ? t.x - e.x : (e.kind === 'hero' ? 1 : -1), dy = t ? t.y - e.y : 0;
    const len = Math.hypot(dx, dy) || 1; e.lunge = 0.32; e.lvx = dx / len * 0.5; e.lvy = dy / len * 0.5;
    if (t) e.face = (dx - dy) >= 0 ? 1 : -1;
  }
  function glowBall(p, r, c) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5); g.addColorStop(0, c); g.addColorStop(0.4, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  function drawFx(f, dt) {
    f.t += dt;
    if (f.delay && f.t < f.delay) return true;
    const k = (f.t - (f.delay || 0)) / f.dur;
    if (f.type === 'proj') {
      const x = f.a.x + (f.b.x - f.a.x) * k, y = f.a.y + (f.b.y - f.a.y) * k - Math.sin(k * Math.PI) * 0.3;
      const p = toScreen(x, y); p.y -= 20;
      const c = PROJ_COLOR[f.kind] || '#fff';
      if (f.kind === 'arrow') { const q = toScreen(f.a.x, f.a.y); const ang = Math.atan2(p.y - (q.y - 20), p.x - q.x); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(5, 0); ctx.stroke(); ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(2, -2.5); ctx.lineTo(2, 2.5); ctx.closePath(); ctx.fill(); ctx.restore(); }
      else glowBall(p, f.big ? 7 : 5, c);
      if (k >= 1) { burstAt(f.b, c, f.big); const t = ents[f.toId]; if (t) t.flash = 0.5; return false; }
      return true;
    }
    if (f.type === 'fall') { // sky-borne: drops from above onto the target
      const p = toScreen(f.b.x, f.b.y); const c = PROJ_COLOR[f.kind] || '#fff';
      const y = p.y - 20 - (1 - k) * 150;
      if (f.kind === 'arrow') { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x + 3, y - 12); ctx.lineTo(p.x, y); ctx.stroke(); }
      else if (f.kind === 'holy') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7; const g = ctx.createLinearGradient(0, y - 60, 0, p.y); g.addColorStop(0, 'rgba(255,240,180,0)'); g.addColorStop(1, c); ctx.fillStyle = g; ctx.fillRect(p.x - 8, y - 60, 16, p.y - y + 60); ctx.restore(); }
      else { glowBall({ x: p.x, y }, f.big ? 10 : 6, c); for (let i = 1; i <= 3; i++) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 / i; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x + i * 2, y - i * 14, (f.big ? 8 : 5) * (1 - i * 0.2), 0, Math.PI * 2); ctx.fill(); ctx.restore(); } }
      if (k >= 1) { burstAt(f.b, c, f.big); if (f.big) addFx({ type: 'ring', p: f.b, color: c, radius: 1.4, dur: 0.4, fill: true }); const t = ents[f.toId]; if (t) t.flash = 0.5; return false; }
      return true;
    }
    if (f.type === 'slash') {
      if (k >= 1) return false;
      const p = toScreen(f.p.x, f.p.y); p.y -= 18;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(f.rot + k * 0.6); ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = f.color; ctx.lineWidth = f.big ? 4 : 2.5; ctx.lineCap = 'round'; ctx.shadowColor = f.color; ctx.shadowBlur = 8;
      const r = (f.big ? 20 : 14) * (0.7 + k * 0.5);
      ctx.beginPath(); ctx.arc(0, 0, r, -0.9 + k * 2.2, 0.6 + k * 2.2); ctx.stroke();
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, r * 0.6, -0.6 + k * 2.2, 0.5 + k * 2.2); ctx.stroke();
      ctx.restore(); return true;
    }
    if (f.type === 'burst') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y); p.y -= 16;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k; const r = (f.big ? 28 : 17) * (0.3 + k);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, f.color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = f.color; ctx.lineWidth = 1.5; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + k; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * r * 0.4, p.y + Math.sin(a) * r * 0.4 * 0.6); ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.6); ctx.stroke(); }
      ctx.restore(); return true;
    }
    if (f.type === 'ring') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 3 * (1 - k) + 1; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
      const r = f.radius * TW * k; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
      if (f.fill) { ctx.globalAlpha = (1 - k) * 0.25; ctx.fillStyle = f.color; ctx.fill(); }
      ctx.restore(); return true;
    }
    if (f.type === 'rise') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f.color; ctx.strokeStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 6;
      for (let i = 0; i < 7; i++) { const a = (i * 2.399 + f.seed) % (Math.PI * 2); const kk = (k + i * 0.13) % 1; const x = p.x + Math.cos(a) * 12, y = p.y - 6 - kk * 44; ctx.globalAlpha = (1 - kk) * 0.9; if (f.plus) { ctx.fillRect(x - 1, y - 3, 2, 6); ctx.fillRect(x - 3, y - 1, 6, 2); } else { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 8); ctx.lineWidth = 2; ctx.stroke(); } }
      ctx.restore(); return true;
    }
    if (f.type === 'pillar') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8; const g = ctx.createLinearGradient(0, p.y - 100, 0, p.y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.color); ctx.fillStyle = g; ctx.fillRect(p.x - 11, p.y - 100, 22, 100); ctx.restore(); return true;
    }
    if (f.type === 'aura') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 2.5; ctx.shadowColor = f.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 17 + k * 5, 8 + k * 2, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return true;
    }
    return false;
  }
  function addFloat(id, text, kind) {
    const p = entPos(id); if (!p) return;
    const colors = { dmg: '#f0e6d2', hurt: '#ff6a5a', crit: '#ffd24a', heal: '#7fe07a', gold: '#f2c14e', miss: '#9a9a9a', shield: '#9cc4ff', status: '#c9b7ff', dot: '#b7e37a', loot: '#d9a0ff' };
    floats.push({ wx: p.x, wy: p.y, dx: (Math.random() - 0.5) * 16, dy: -46, vy: kind === 'crit' ? -1.4 : -0.9, life: kind === 'crit' || kind === 'loot' ? 1.6 : 1.1, text, color: colors[kind] || '#fff', size: kind === 'crit' ? 15 : kind === 'status' || kind === 'loot' ? 10 : 12, bold: kind === 'crit' });
  }
  function showBanner(text, color, dur) { banner = { text, color: color || '#e8b45a', t: dur || 2, dur: dur || 2 }; }
  function shake() { shakeT = 0.35; }

  // ---------- main frame ----------
  function frame(now) {
    const dt = Math.min(0.1, (now - lastT) / 1000 || 0.016); lastT = now;
    const G = window.Game; const S = G.S;
    if (!S) { requestAnimationFrame(frame); return; }
    const R = S.run; const speed = S.settings.speed || 1;
    torchPhase += dt;
    ctx.save();
    if (shakeT > 0) { shakeT -= dt; ctx.translate((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6); }
    if (R && R.map) drawDungeon(S, R, dt, speed); else if (S.world) drawWorld(S, S.world, dt, speed); else { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); }
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.life -= dt; f.dy += f.vy * 60 * dt; if (f.life <= 0) { floats.splice(i, 1); continue; }
      const p = toScreen(f.wx, f.wy);
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = (f.bold ? '800 ' : '700 ') + f.size + 'px ' + (f.bold ? serif() : 'sans-serif'); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(f.text, p.x + f.dx, p.y + f.dy); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x + f.dx, p.y + f.dy);
      ctx.globalAlpha = 1;
    }
    if (banner) {
      banner.t -= dt; if (banner.t <= 0) banner = null;
      else { const a = Math.min(1, banner.t * 2, (banner.dur - banner.t) * 3); ctx.globalAlpha = a; ctx.font = '700 ' + Math.round(H * 0.085) + 'px ' + serif(); ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(banner.text, W / 2, H * 0.3); ctx.fillStyle = banner.color; ctx.fillText(banner.text, W / 2, H * 0.3); ctx.globalAlpha = 1; }
    }
    if (R && R.phase === 'floorclear') { ctx.font = '700 ' + Math.round(H * 0.065) + 'px ' + serif(); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.16); ctx.fillStyle = '#e8b45a'; ctx.fillText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.16); }
    if (!R && S.world) drawMinimap(S.world);
    ctx.restore();
    requestAnimationFrame(frame);
  }

  function vignette(fogColor, cycle) {
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (cycle > 0) { ctx.fillStyle = cycle === 1 ? 'rgba(120,20,40,0.16)' : 'rgba(60,0,90,0.22)'; ctx.fillRect(0, 0, W, H); }
  }

  // ---------- dungeon ----------
  function drawDungeon(S, R, dt, speed) {
    const G = window.Game; const map = R.map; const bf = G.biomeFor(R.floor); const biome = bf.biome;
    const floorKey = 'd' + R.floor + ':' + R.seed;
    if (floorKey !== lastFloorKey) { lastFloorKey = floorKey; lastZoneKey = ''; for (const k in doorAnim) delete doorAnim[k]; for (const k in ents) delete ents[k]; fx.length = 0; cam.init = false; }
    const rooms = map.rooms; const seg = map.segs[R.room + 1]; const inTravel = R.phase === 'travel' && seg;
    const need = G.travelNeed(); const prog = inTravel ? (R.travelT / need) * seg.path.length : 0;
    const room = rooms[map.route[R.room].room];
    const blocked = (x, y) => { const tx = Math.floor(x), ty = Math.floor(y); if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true; const v = map.tiles[ty * map.w + tx]; return v !== DG.FLOOR && v !== DG.DOOR; };
    // ---- party ----
    R.party.forEach((p, i) => {
      const h = S.heroes.find((x) => x.uid === p.uid); if (!h) return;
      const re = ent(p.uid, room.cx + 0.5, room.cy + 0.5, 'hero'); re.cls = h.cls;
      if (!re.init) { re.x = room.x + 1.5 + (i % 2); re.y = room.cy + 0.5 + (Math.floor(i / 2) - 1) * 0.9; re.init = true; }
      re.alive = p.alive;
      if (inTravel) {
        const my = prog - i * 1.0; if (my > 0) { const t = pathPos(seg, my); re.moving = steer(re, t.x, t.y, dt, 6 * speed, null); }
      } else if (R.phase !== 'combat') { // gather loosely near the room's centre-left
        const gx = room.x + room.w * 0.35 + (i % 2) * 0.9, gy = room.cy + 0.5 + (Math.floor(i / 2) - 1) * 1.0;
        re.moving = steer(re, gx, gy, dt, 3 * speed, blocked); if (!re.moving) re.face = 1;
      }
    });
    // ---- enemies: in combat, or waiting behind the next door ----
    const nextStop = map.route[R.room + 1];
    const list = R.phase === 'combat' ? R.enemies : (inTravel && nextStop && nextStop.enc ? (R.next || []) : []);
    const enemyRoom = R.phase === 'combat' ? room : (nextStop ? rooms[nextStop.room] : null);
    if (enemyRoom) list.forEach((e) => {
      const re = ent(e.id, 0, 0, 'enemy'); re.eid = e.eid; re.img = e.img; re.boss = e.boss;
      if (!re.init) { re.x = enemyRoom.x + enemyRoom.w * 0.45 + e.ox * (enemyRoom.w * 0.5 - 1); re.y = enemyRoom.y + 0.5 + e.oy * (enemyRoom.h - 1); if (e.boss) { re.x = enemyRoom.x + enemyRoom.w * 0.7; re.y = enemyRoom.cy + 0.5; } re.init = true; }
      re.alive = e.alive; if (!e.alive) re.deadT += dt; re.bob += dt * 2;
    });
    if (R.phase === 'combat') combatMove(R, dt, speed, blocked, { x0: room.x + 0.3, x1: room.x + room.w - 0.3, y0: room.y + 0.3, y1: room.y + room.h - 0.3 });
    updateLunges(dt);
    // doors: previous segments fully open; the current one opens as the leader reaches each door
    for (let k = 1; k <= R.room; k++) { const s = map.segs[k]; if (s) for (const d of s.doors) doorAnim[d.x + ',' + d.y] = 1; }
    if (inTravel) for (const d of seg.doors) { if (prog >= d.idx - 1) { const key = d.x + ',' + d.y; doorAnim[key] = Math.min(1, (doorAnim[key] || 0) + dt * 2.5); } }
    // ---- camera ----
    const leader = ents[R.party[0] && R.party[0].uid];
    let camT;
    if (R.phase === 'combat') { const alive = R.enemies.filter((e) => e.alive && ents[e.id]); const hs = R.party.filter((p) => ents[p.uid]); const hx = hs.reduce((a, p) => a + ents[p.uid].x, 0) / Math.max(1, hs.length), hy = hs.reduce((a, p) => a + ents[p.uid].y, 0) / Math.max(1, hs.length); const ex = alive.length ? alive.reduce((a, e) => a + ents[e.id].x, 0) / alive.length : hx, ey = alive.length ? alive.reduce((a, e) => a + ents[e.id].y, 0) / alive.length : hy; camT = { x: (hx + ex) / 2, y: (hy + ey) / 2 }; }
    else if (leader) camT = { x: leader.x + 0.6, y: leader.y - 0.2 }; else camT = { x: map.start.x, y: map.start.y };
    if (!cam.init) { cam.x = camT.x; cam.y = camT.y; cam.init = true; } else { const k = Math.min(1, dt * 3 * Math.max(1, speed)); cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; }
    // ---- background ----
    ctx.fillStyle = '#070605'; ctx.fillRect(0, 0, W, H);
    const bgim = img(biome.bg);
    if (bgim) { ctx.globalAlpha = 0.22; const ir = bgim.naturalWidth / bgim.naturalHeight; let dw = W, dh = W / ir; if (dh < H) { dh = H; dw = H * ir; } ctx.drawImage(bgim, (W - dw) / 2 - (cam.x - cam.y) * 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); }
    // ---- visibility ----
    const visibleOwner = (o) => { if (o < 0) return false; if (o >= 100) return o - 100 <= R.room + (inTravel ? 1 : 0); const vo = map.visitOrder[o]; if (vo === undefined) return false; return vo <= R.room || (vo === R.room + 1 && R.doorOpen); };
    const tiles = map.tiles, mw = map.w, mh = map.h;
    const inView = (p, pad) => p.x > -TW - pad && p.x < W + TW + pad && p.y > -WALLH - TH - pad && p.y < H + TH + pad;
    const ftd = groundTile('tile_' + biome.id + '_floor', true);
    const drawables = []; const floorP = new Path2D(), hiddenP = new Path2D();
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      const v = tiles[ty * mw + tx]; if (v === DG.VOID) continue;
      const p = toScreen(tx, ty); if (!inView(p, 0)) continue;
      const o = map.owner[ty * mw + tx]; const vis = visibleOwner(o);
      if (v === DG.FLOOR || v === DG.DOOR) {
        floorP.rect(tx, ty, 1, 1); if (!vis) hiddenP.rect(tx, ty, 1, 1);
        if (tx === map.exit.x && ty === map.exit.y) drawables.push({ d: tx + ty + 0.5, f: () => drawStairs(p) });
        if (v === DG.DOOR) { const dir = doorDir(map, tx, ty); drawables.push({ d: tx + ty + 1, f: () => drawDoor(tx, ty, dir, doorAnim[tx + ',' + ty] || 0, !vis) }); }
      } else if (v === DG.WALL) {
        const behind = (x2, y2) => { const t2 = x2 < 0 || y2 < 0 || x2 >= mw || y2 >= mh ? DG.VOID : tiles[y2 * mw + x2]; return t2 === DG.FLOOR || t2 === DG.DOOR; };
        const low = behind(tx - 1, ty) || behind(tx, ty - 1) || behind(tx - 1, ty - 1);
        drawables.push({ d: tx + ty + 1, f: () => drawBlock(tx, ty, p, 'tile_' + biome.id + '_wall', ftd, low ? LOWH : WALLH, !vis) });
      }
    }
    for (const pr of map.props) { const o = map.owner[pr.y * mw + pr.x]; if (!visibleOwner(o)) continue; const p = toScreen(pr.x, pr.y); if (!inView(p, 0)) continue; drawables.push({ d: pr.x + pr.y + 1, f: () => drawProp(p, pr.k, biome.accent) }); }
    for (const t of map.torches) { const o = map.owner[(t.y + 1) * mw + t.x]; if (!visibleOwner(o)) continue; const p = toScreen(t.x, t.y); if (!inView(p, 40)) continue; drawables.push({ d: t.x + t.y + 1.01, f: () => drawTorch(p) }); }
    isoTransform(); const fp = pattern('tile_' + biome.id + '_floor', 3); ctx.fillStyle = fp || biome.tint; ctx.fill(floorP); ctx.fillStyle = 'rgba(0,0,0,0.84)'; ctx.fill(hiddenP); resetTransform();
    if (R.phase === 'floorclear') { const r = rooms[rooms.length - 1]; const p = toScreen(r.cx, r.cy); drawables.push({ d: r.cx + r.cy + 1, f: () => { drawSpriteImg('prop_chest', { x: p.x, y: p.y + TH / 2 + 4 }, 26) || (() => { ctx.fillStyle = '#4a3418'; ctx.fillRect(p.x - 10, p.y - 8, 20, 12); })(); } }); }
    pushEntities(S, R, list, drawables, R.phase === 'combat' || R.doorOpen);
    drawables.sort((a, b) => a.d - b.d);
    for (const d of drawables) d.f();
    for (let i = fx.length - 1; i >= 0; i--) { if (!drawFx(fx[i], dt)) fx.splice(i, 1); }
    vignette(biome.fog, bf.cycle);
  }
  function doorDir(map, tx, ty) { for (const s of map.segs) { if (!s) continue; for (const d of s.doors) if (d.x === tx && d.y === ty) return d.dir; } return 'ew'; }
  function pathPos(seg, prog) {
    const path = seg.path; if (prog <= 0) return { x: path[0].x + 0.5, y: path[0].y + 0.5 };
    const i = Math.min(path.length - 1, Math.floor(prog)); const f = prog - i;
    const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
    return { x: a.x + (b.x - a.x) * f + 0.5, y: a.y + (b.y - a.y) * f + 0.5 };
  }
  function pushEntities(S, B, enemies, drawables, enemiesVisible) {
    const heroesById = {}; for (const h of S.heroes) heroesById[h.uid] = h;
    for (const p of B.party) {
      const re = ents[p.uid]; if (!re) continue; const h = heroesById[p.uid]; if (!h) continue;
      drawables.push({ d: re.x + re.y + re.ldx + re.ldy, f: () => { const sp = drawSprite(re, 'sp_' + h.cls, D.CLASSES[h.cls].img, { dead: !p.alive, walking: re.moving }); if (p.alive) hpBar(sp, 28, p.hp / p.maxhp, p.shield / p.maxhp, false); if (p.taunt > 0) nameTag(sp.x, sp.y - SPR_H - 6, 'TAUNT', '#ffd24a'); } });
    }
    if (!enemiesVisible) return;
    for (const e of enemies) {
      const re = ents[e.id]; if (!re) continue;
      if (!e.alive && re.deadT > 0.8) continue;
      const sz = e.boss ? 1 : Math.max(0.7, Math.min(1.3, 0.72 + (e.spec ? e.spec.hp : 1) * 0.22));
      drawables.push({ d: re.x + re.y + re.ldx + re.ldy, f: () => { if (!e.alive) ctx.globalAlpha = Math.max(0, 1 - re.deadT / 0.8); const sp = drawSprite(re, e.img.replace('en_', 'sp_'), e.img, { boss: e.boss, dead: !e.alive, nativeLeft: true, scale: sz, walking: re.moving, flying: !!FLYING[e.eid] }); ctx.globalAlpha = 1; if (e.alive) { hpBar({ x: sp.x, y: sp.y + (sp.h - SPR_H) * 0 }, e.boss ? 46 : 28, e.hp / e.maxhp, 0, e.boss, 5); if (e.boss) nameTag(sp.x, sp.y - sp.h - 6, e.name, '#ff7a6a'); if (e.stun > 0) nameTag(sp.x, sp.y + 16, 'stunned', '#c9b7ff'); } } });
    }
  }

  // ---------- overworld ----------
  function drawWorld(S, Wd, dt, speed) {
    const G = window.Game; const map = Wd.map; const theme = D.ZONE_THEMES.find((t) => t.id === map.theme);
    const zoneKey = 'z' + Wd.zone + ':' + Wd.seed;
    if (zoneKey !== lastZoneKey) { lastZoneKey = zoneKey; lastFloorKey = ''; for (const k in ents) delete ents[k]; fx.length = 0; cam.init = false; trail.length = 0; }
    const Wr = WD();
    const blocked = (x, y) => !Wr.walkable(map, Math.floor(x), Math.floor(y));
    // ---- party positions: leader follows the engine tile, the rest follow the trail ----
    const lead = { x: Wd.pos.x + 0.5, y: Wd.pos.y + 0.5 };
    Wd.party.forEach((p, i) => {
      const h = S.heroes.find((x) => x.uid === p.uid); if (!h) return;
      const re = ent(p.uid, lead.x, lead.y, 'hero'); re.cls = h.cls; re.alive = p.alive;
      if (!re.init) { re.x = lead.x - i * 0.7; re.y = lead.y + i * 0.4; re.init = true; }
      if (Wd.phase === 'combat') return;
      if (i === 0) { re.moving = steer(re, lead.x, lead.y, dt, 5 * speed, null); if (re.moving && (trail.length === 0 || Math.hypot(trail[0].x - re.x, trail[0].y - re.y) > 0.25)) { trail.unshift({ x: re.x, y: re.y }); if (trail.length > 40) trail.pop(); } }
      else { const t = trail[Math.min(trail.length - 1, i * 4)] || { x: lead.x - i * 0.7, y: lead.y + i * 0.4 }; re.moving = steer(re, t.x, t.y, dt, 5 * speed, null); }
    });
    // ---- enemies of the current encounter ----
    const E = Wd.phase === 'combat' ? Wd.enc : null;
    const poi = E ? map.pois.find((p) => p.id === E.poi) : null;
    if (E) {
      E.enemies.forEach((e) => {
        const re = ent(e.id, 0, 0, 'enemy'); re.eid = e.eid; re.img = e.img; re.boss = e.boss;
        if (!re.init) { const cx = poi ? poi.x + 0.5 : lead.x + 3, cy = poi ? poi.y + 0.5 : lead.y; re.x = cx + (e.ox - 0.5) * 4; re.y = cy + (e.oy - 0.5) * 4; if (blocked(re.x, re.y)) { re.x = cx; re.y = cy; } re.init = true; }
        re.alive = e.alive; if (!e.alive) re.deadT += dt; re.bob += dt * 2;
      });
      combatMove(E, dt, speed, blocked, null);
    }
    updateLunges(dt);
    // ---- camera ----
    const leader = ents[Wd.party[0] && Wd.party[0].uid];
    let camT = leader ? { x: leader.x, y: leader.y } : lead;
    if (E) { const alive = E.enemies.filter((e) => e.alive && ents[e.id]); if (alive.length && leader) { const ex = alive.reduce((a, e) => a + ents[e.id].x, 0) / alive.length, ey = alive.reduce((a, e) => a + ents[e.id].y, 0) / alive.length; camT = { x: (leader.x + ex) / 2, y: (leader.y + ey) / 2 }; } }
    if (!cam.init) { cam.x = camT.x; cam.y = camT.y; cam.init = true; } else { const k = Math.min(1, dt * 3 * Math.max(1, speed)); cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; }
    // ---- terrain: continuous textures in world space (no visible tile grid) ----
    ctx.fillStyle = '#050403'; ctx.fillRect(0, 0, W, H);
    const inView = (p, pad) => p.x > -TW - pad && p.x < W + TW + pad && p.y > -80 - pad && p.y < H + TH + pad;
    const drawables = [];
    const lx = leader ? leader.x : lead.x, ly = leader ? leader.y : lead.y;
    const tiles = map.tiles, mw = map.w, mh = map.h;
    const wb = worldBounds();
    const X0 = Math.max(0, wb.x0), X1 = Math.min(mw - 1, wb.x1), Y0 = Math.max(0, wb.y0), Y1 = Math.min(mh - 1, wb.y1);
    const groundP = new Path2D(), pathP = new Path2D(), pathSoft = new Path2D(), waterP = new Path2D(), shoreP = new Path2D(), revealed = new Path2D(), rockP = new Path2D();
    for (let ty = Y0; ty <= Y1; ty++) for (let tx = X0; tx <= X1; tx++) {
      const i = ty * mw + tx; if (!Wd.explored[i]) continue;
      revealed.rect(tx - 0.3, ty - 0.3, 1.6, 1.6);
      const v = tiles[i];
      if (v === Wr.WATER) { waterP.rect(tx, ty, 1, 1); shoreP.rect(tx - 0.3, ty - 0.3, 1.6, 1.6); }
      else { groundP.rect(tx, ty, 1, 1); if (v === Wr.PATH) { pathP.rect(tx, ty, 1, 1); pathSoft.rect(tx - 0.3, ty - 0.3, 1.6, 1.6); } }
      if (v === Wr.ROCK) {
        rockP.rect(tx, ty, 1, 1);
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const t2 = Wr.walkable(map, tx + dx, ty + dy); return t2; });
        if (edge && (tx * 7 + ty * 11) % 5 !== 0) drawables.push({ d: tx + ty + 1, f: () => { const p = toScreen(tx + 0.5, ty + 0.5); if (!drawSpriteImg('prop_rock', { x: p.x, y: p.y + 6 }, 26 + ((tx * 3 + ty * 5) % 3) * 8)) { ctx.fillStyle = '#2a2622'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 16, 9, 0, 0, Math.PI * 2); ctx.fill(); } } });
      }
      else if (v === Wr.TREE) drawables.push({ d: tx + ty + 1.2, f: () => { const p = toScreen(tx + 0.5, ty + 0.5); if (!drawSpriteImg(theme.tree, { x: p.x, y: p.y + 4 }, 58 + ((tx * 7 + ty * 3) % 3) * 8)) { ctx.fillStyle = '#1a2a12'; ctx.beginPath(); ctx.moveTo(p.x - 10, p.y + 4); ctx.lineTo(p.x, p.y - 30); ctx.lineTo(p.x + 10, p.y + 4); ctx.closePath(); ctx.fill(); } } });
    }
    isoTransform();
    const gp = pattern(theme.ground, 5), pp = pattern(theme.path, 4), wp = pattern('tile_water', 4, (torchPhase * 0.12) % 4);
    ctx.fillStyle = gp || theme.tint; ctx.fill(groundP);
    const rp = pattern('tile_rock', 4); ctx.fillStyle = rp || '#2a2622'; ctx.fill(rockP); ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fill(rockP);
    if (pp) { ctx.globalAlpha = 0.45; ctx.fillStyle = pp; ctx.fill(pathSoft); ctx.globalAlpha = 0.95; ctx.fill(pathP); ctx.globalAlpha = 1; }
    ctx.globalAlpha = 0.4; ctx.fillStyle = '#05090b'; ctx.fill(shoreP); ctx.globalAlpha = 1;
    ctx.fillStyle = '#0a1418'; ctx.fill(waterP);
    if (wp) { ctx.globalAlpha = 0.8; ctx.fillStyle = wp; ctx.fill(waterP); ctx.globalAlpha = 1; }
    resetTransform();
    // unify colours: theme tint plus large soft blotches of shade, like painted ground
    ctx.fillStyle = theme.tint; ctx.globalAlpha = 0.22; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    for (let k = 0; k < 9; k++) {
      const bx = ((Wd.seed >>> (k * 3)) % 41 + k * 5) % mw, by = ((Wd.seed >>> (k * 2 + 1)) % 37 + k * 7) % mh; const p = toScreen(bx, by);
      if (p.x < -220 || p.x > W + 220 || p.y < -220 || p.y > H + 220) continue;
      const r = 100 + (k % 3) * 45; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, k % 4 === 0 ? 'rgba(255,230,180,0.07)' : 'rgba(0,0,0,0.24)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
    }
    // POIs (only once discovered)
    for (const po of map.pois) {
      if (!po.found) continue; const p = toScreen(po.x, po.y); if (!inView(p, 60)) continue;
      const sp = POI_SPRITE[po.type]; if (!sp) continue;
      drawables.push({ d: po.x + po.y + 1.1, f: () => {
        const base = { x: p.x, y: p.y + TH / 2 + 6 };
        if (!drawSpriteImg(sp[0], base, sp[1], { dark: po.done && (po.type === 'camp' || po.type === 'lair' || po.type === 'chest') })) { ctx.fillStyle = '#7a6a4a'; ctx.beginPath(); ctx.arc(base.x, base.y - 12, 10, 0, Math.PI * 2); ctx.fill(); }
        if (po.type === 'camp' && !po.done) { const f = 0.8 + Math.sin(torchPhase * 8 + po.x) * 0.2; ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(base.x, base.y - 8, 2, base.x, base.y - 8, 40 * f); g.addColorStop(0, 'rgba(255,150,60,0.35)'); g.addColorStop(1, 'rgba(255,120,40,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(base.x, base.y - 8, 40 * f, 22 * f, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
        if (po.type === 'dungeon') { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(base.x, base.y - 10, 2, base.x, base.y - 10, 30); g.addColorStop(0, 'rgba(255,130,50,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(base.x - 30, base.y - 40, 60, 40); ctx.restore(); }
        const label = po.type === 'dungeon' ? po.name : po.type === 'exit' ? 'Road onward' : po.type === 'lair' ? (po.done ? 'Silent lair' : po.name) : po.type === 'town' ? 'Ashford' : po.type === 'waypoint' ? 'Waypoint' : po.type === 'camp' && !po.done ? po.name : null;
        if (label) nameTag(base.x, base.y - sp[1] - 6, label, po.type === 'dungeon' ? '#d9a0ff' : po.type === 'lair' ? '#ff7a6a' : po.type === 'exit' ? '#e8b45a' : '#e6dcc6');
      } });
    }
    pushEntities(S, { party: Wd.party }, E ? E.enemies : [], drawables, true);
    drawables.sort((a, b) => a.d - b.d);
    for (const d of drawables) d.f();
    for (let i = fx.length - 1; i >= 0; i--) { if (!drawFx(fx[i], dt)) fx.splice(i, 1); }
    // destination marker for orders
    if (Wd.order && Wd.dest) { const p = toScreen(Wd.dest.x + 0.5, Wd.dest.y + 0.5); const k = (torchPhase % 1); ctx.strokeStyle = 'rgba(232,180,90,' + (1 - k) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10 + k * 14, 5 + k * 7, 0, 0, Math.PI * 2); ctx.stroke(); }
    drawFogLayer(revealed);
    const lp = toScreen(lx, ly); const lg = ctx.createRadialGradient(lp.x, lp.y - 12, TW * 2.4, lp.x, lp.y - 12, TW * 8); lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0.5)'); ctx.fillStyle = lg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = theme.fog; ctx.globalAlpha = 0.18; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
    if (Wd.phase === 'dead') { ctx.fillStyle = 'rgba(60,0,0,0.45)'; ctx.fillRect(0, 0, W, H); ctx.font = '700 ' + Math.round(H * 0.08) + 'px ' + serif(); ctx.textAlign = 'center'; ctx.fillStyle = '#d0473c'; ctx.fillText('THE COMPANY FALLS', W / 2, H * 0.4); }
  }
  function drawMinimap(Wd) {
    const map = Wd.map; const size = Math.min(104, W * 0.28); const sc = size / Math.max(map.w, map.h);
    if (!minimap || minimapCount !== Wd.exploredCount || minimapZone !== Wd.zone + ':' + Wd.seed) {
      minimapZone = Wd.zone + ':' + Wd.seed; minimapCount = Wd.exploredCount;
      minimap = document.createElement('canvas'); minimap.width = Math.ceil(size * DPR); minimap.height = Math.ceil(size * DPR);
      const g = minimap.getContext('2d'); g.scale(DPR, DPR);
      g.fillStyle = 'rgba(5,4,3,0.85)'; g.fillRect(0, 0, size, size);
      const Wr = WD();
      const cols = { [Wr.GROUND]: '#4a4634', [Wr.PATH]: '#6e5a3a', [Wr.WATER]: '#1d3140', [Wr.ROCK]: '#2a2622', [Wr.TREE]: '#243019' };
      for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) { const i = y * map.w + x; if (!Wd.explored[i]) continue; g.fillStyle = cols[map.tiles[i]] || '#333'; g.fillRect(x * sc, y * sc, sc + 0.5, sc + 0.5); }
    }
    const x0 = W - size - 6, y0 = 6;
    ctx.drawImage(minimap, x0, y0, size, size);
    ctx.strokeStyle = 'rgba(200,170,110,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + 0.5, y0 + 0.5, size - 1, size - 1);
    const dot = (x, y, c, r) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x0 + (x + 0.5) * sc, y0 + (y + 0.5) * sc, r || 2, 0, Math.PI * 2); ctx.fill(); };
    const pc = { camp: '#ff8a3a', lair: '#e0403a', dungeon: '#c98bff', exit: '#e8b45a', shrine: '#7fe0e0', chest: '#ffe08a', town: '#ffffff', waypoint: '#ffffff' };
    for (const po of map.pois) if (po.found) dot(po.x, po.y, po.done && po.type !== 'dungeon' && po.type !== 'exit' ? 'rgba(120,120,120,0.6)' : pc[po.type] || '#fff', po.type === 'lair' || po.type === 'dungeon' || po.type === 'exit' ? 2.6 : 1.8);
    const blink = (Math.sin(torchPhase * 6) + 1) / 2;
    dot(Wd.pos.x, Wd.pos.y, 'rgba(255,255,255,' + (0.6 + blink * 0.4) + ')', 2.4);
    ctx.font = '600 9px ' + serif(); ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(230,220,200,0.85)'; ctx.fillText(Math.round(window.Game.exploredPct() * 100) + '% charted', x0 + size - 3, y0 + size + 11);
  }

  // ---------- engine bindings ----------
  function bind() {
    const G = window.Game;
    G.on('float', (f) => addFloat(f.id, f.text, f.kind));
    G.on('attack', (a) => {
      const src = ents[a.id]; if (!src) return;
      const B = G.cur(); if (!B) return;
      const targets = a.target === 'all' ? B.party.map((p) => p.uid) : [a.target];
      if (a.id.startsWith('h')) {
        const cls = src.cls; const ranged = HERO_RANGED[cls];
        if (ranged) { src.lunge = 0.2; src.lvx = -0.12; src.lvy = 0; targets.forEach((t) => projectile(a.id, t, ranged, false)); }
        else { lungeTo(a.id, targets[0]); targets.forEach((t) => slashAt(t, CLASS_COLOR[cls] || '#fff', false, 0.1)); const t = ents[targets[0]]; if (t) setTimeout(() => { t.flash = 0.6; }, 120); }
      } else {
        const kind = RANGED_ENEMY[src.eid];
        if (kind) { src.lunge = 0.2; src.lvx = 0.12; src.lvy = 0; targets.forEach((t) => projectile(a.id, t, kind, src.boss)); }
        else { lungeTo(a.id, targets[0]); if (FLYING[src.eid]) { src.lvy += 0.2; } targets.forEach((t) => { slashAt(t, '#ff5a4a', src.boss, 0.1); const te = ents[t]; if (te) setTimeout(() => { te.flash = 0.6; }, 120); }); }
      }
    });
    G.on('skill', (s) => {
      const src = ents[s.id]; const B = G.cur(); if (!src || !B) return;
      const sk = s.sid ? D.SKILLS[s.sid] : Object.values(D.SKILLS).find((x) => x.name === s.name); if (!sk) return;
      const cls = src.cls; const color = CLASS_COLOR[cls] || '#fff';
      const alive = B.enemies.filter((e) => e.alive && ents[e.id]); const allies = B.party.filter((p) => p.alive && ents[p.uid]);
      const centroid = (arr) => { if (!arr.length) return null; let x = 0, y = 0; for (const a of arr) { const e = ents[a.id]; x += e.x; y += e.y; } return { x: x / arr.length, y: y / arr.length }; };
      const lowest = allies.length ? allies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)) : null;
      const tgt = (s.target && ents[s.target] && alive.find((e) => e.id === s.target)) ? alive.find((e) => e.id === s.target) : alive[0];
      if (floats.filter((f) => f.skill).length < 3) floats.push({ wx: src.x, wy: src.y, dx: 0, dy: -60, vy: -0.5, life: 1.2, text: s.name, color: '#ffe0a0', size: 10, bold: true, skill: true });
      const projKind = HERO_RANGED[cls] || 'holy';
      switch (sk.type) {
        case 'dmg': { if (!tgt) break; if (sk.sky) { fallOn(tgt.id, cls === 'pyromancer' ? 'fire' : projKind, true, 0.05); src.lunge = 0.25; src.lvx = -0.1; } else if (HERO_RANGED[cls]) projectile(s.id, tgt.id, projKind, true); else { lungeTo(s.id, tgt.id); slashAt(tgt.id, color, true, 0.1); } break; }
        case 'aoe': { const c = centroid(alive); if (!c) break; if (sk.sky) { alive.forEach((e, i) => { for (let j = 0; j < (cls === 'ranger' ? 3 : 1); j++) fallOn(e.id, cls === 'pyromancer' ? 'fire' : cls === 'ranger' ? 'arrow' : 'holy', cls !== 'ranger', 0.05 + i * 0.07 + j * 0.05); }); } else { addFx({ type: 'ring', p: c, color, radius: 2.2, dur: 0.55, fill: cls === 'pyromancer' || cls === 'paladin' || cls === 'berserker' }); alive.forEach((e, i) => setTimeout(() => { const ee = ents[e.id]; if (ee) burstAt({ x: ee.x, y: ee.y }, color, true); }, 120 + i * 60)); if (sk.stun) shake(); } src.lunge = 0.25; src.lvx = 0.3; src.lvy = 0; break; }
        case 'dot': { const t = tgt || alive[Math.floor(Math.random() * alive.length)]; if (t) projectile(s.id, t.id, cls === 'pyromancer' ? 'fire' : 'poison', false); break; }
        case 'dotall': case 'debuffall': { const c = centroid(alive); if (c) addFx({ type: 'ring', p: c, color: cls === 'necromancer' ? '#7dff8a' : '#b57cff', radius: 2.2, dur: 0.6, fill: true }); break; }
        case 'debuff': { if (tgt) projectile(s.id, tgt.id, HERO_RANGED[cls] || 'dark', false); break; }
        case 'heal': { if (lowest) addFx({ type: 'rise', p: { x: ents[lowest.uid].x, y: ents[lowest.uid].y }, color: '#7fe07a', dur: 0.9, plus: true, seed: Math.random() * 6 }); break; }
        case 'healself': { addFx({ type: 'rise', p: { x: src.x, y: src.y }, color: '#7fe07a', dur: 0.9, plus: true, seed: Math.random() * 6 }); break; }
        case 'cleanse': case 'buffall': case 'shieldall': { allies.forEach((p) => addFx({ type: sk.type === 'shieldall' ? 'aura' : 'rise', p: { x: ents[p.uid].x, y: ents[p.uid].y }, color: sk.type === 'shieldall' ? '#9cc4ff' : sk.type === 'cleanse' ? '#ffe6a0' : '#ffd66a', dur: 0.8, seed: Math.random() * 6 })); break; }
        case 'shield': { addFx({ type: 'aura', p: { x: src.x, y: src.y }, color: '#9cc4ff', dur: 0.8 }); break; }
        case 'taunt': case 'selfbuff': { addFx({ type: 'rise', p: { x: src.x, y: src.y }, color: sk.type === 'taunt' ? '#ffd24a' : color, dur: 0.8, seed: Math.random() * 6 }); break; }
        default: break;
      }
      if (!s.id.startsWith('h') && s.target && ents[s.target]) addFx({ type: 'rise', p: { x: ents[s.target].x, y: ents[s.target].y }, color: '#7fe07a', dur: 0.8, plus: true, seed: 1 });
    });
    G.on('revive', (r) => { const e = ents[r.id]; if (e) addFx({ type: 'pillar', p: { x: e.x, y: e.y }, color: '#fff6d0', dur: 1.0 }); });
    G.on('kill', (k) => { if (k.boss) { showBanner('BOSS SLAIN', '#ff9a6a', 2.2); shake(); } });
    G.on('death', () => shake());
    G.on('loot', (l) => { const e = ents[l.id]; if (e) floats.push({ wx: e.x, wy: e.y, dx: 0, dy: -34, vy: -0.6, life: 1.8, text: l.item.name, color: D.RARITIES[l.item.rarity].color, size: 10, bold: true }); });
    G.on('chest', (c) => { const S = G.S; const id = S.run ? null : (S.world.party[0] && S.world.party[0].uid); const e = id && ents[id]; if (e) floats.push({ wx: e.x, wy: e.y, dx: 0, dy: -40, vy: -0.6, life: 2, text: c.item.name, color: D.RARITIES[c.item.rarity].color, size: 11, bold: true }); });
    G.on('door', (d) => { if (d.boss) { const R = G.S.run; const e = R.next && R.next.find((x) => x.boss); showBanner(e ? e.name.toUpperCase() : 'BOSS', '#e0403a', 2.5); } else if (d.side) showBanner('A HIDDEN ALCOVE', '#e8b45a', 1.6); });
    G.on('encounter', (e) => { if (e.world && e.boss) showBanner((e.poi && e.poi.name ? e.poi.name : 'THE LAIR').toUpperCase(), '#e0403a', 2.5); });
    G.on('floor', (f) => { const b = G.biomeFor(f.floor); if ((f.floor - 1) % D.FLOORS_PER_BIOME === 0) showBanner(b.biome.name.toUpperCase(), b.biome.accent, 3); });
    G.on('zone', (z) => { showBanner(z.map.title.toUpperCase(), '#e8b45a', 3); });
    G.on('poi', (p) => { if (p.type === 'dungeon') showBanner(p.name.toUpperCase(), '#d9a0ff', 2.5); else if (p.type === 'exit') showBanner('THE ROAD ONWARD', '#e8b45a', 2.2); else if (p.type === 'lair') showBanner('A LAIR', '#e0403a', 2); });
    G.on('quest', (q) => showBanner('QUEST COMPLETE', '#e8b45a', 2.2));
    G.on('runstart', () => { cam.init = false; for (const k in ents) delete ents[k]; fx.length = 0; floats.length = 0; });
    G.on('runend', () => { for (const k in ents) delete ents[k]; fx.length = 0; cam.init = false; trail.length = 0; });
    G.on('surface', () => { for (const k in ents) delete ents[k]; cam.init = false; trail.length = 0; });
    G.on('levelup', (l) => { const e = ents[l.hero.uid]; if (e) floats.push({ wx: e.x, wy: e.y, dx: 0, dy: -64, vy: -0.6, life: 1.8, text: 'LEVEL ' + l.hero.level, color: '#ffe08a', size: 12, bold: true }); });
  }

  function start() { resize(); requestAnimationFrame(frame); }
  function preloadAll() {
    const keys = ['bg_village', 'tile_door', 'tile_water', 'tile_rock', 'prop_chest', 'prop_camp', 'prop_dungeon', 'prop_shrine', 'prop_lair', 'prop_exit', 'prop_town', 'prop_rock'];
    for (const c in D.CLASSES) { keys.push('sp_' + c); keys.push(D.CLASSES[c].img); }
    for (const t of D.ZONE_THEMES) { keys.push(t.ground); keys.push(t.path); keys.push(t.tree); }
    for (const b of D.BIOMES) { keys.push('tile_' + b.id + '_floor'); keys.push('tile_' + b.id + '_wall'); keys.push(b.bg); }
    for (const s of D.SLOTS) keys.push(D.SLOT_ICON[s]);
    preload(keys);
    setTimeout(() => preload(Object.values(D.ENEMIES).map((e) => e.img.replace('en_', 'sp_'))), 1200);
    setTimeout(() => preload(Object.values(D.ENEMIES).map((e) => e.img)), 4000);
  }
  window.Render = { start, bind, preload, preloadAll, img, resize, showBanner, __ents: () => Object.values(ents).map((e) => ({ id: e.id, x: +e.x.toFixed(1), y: +e.y.toFixed(1), init: e.init, mv: !!e.moving, lunge: +e.lunge.toFixed(2) })) };
})();
