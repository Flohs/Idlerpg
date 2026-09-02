/* GRIMDELVE — isometric dungeon renderer
 * Draws the procedurally generated floor (rooms, corridors, doors), the party walking it,
 * monsters waiting behind doors, and attack / spell effects. Static sprites, moved and lunged in code.
 */
(function () {
  'use strict';
  const D = window.DATA;
  const DG = window.Dungeon;
  const IMG = {}, loading = {};
  function img(key) {
    if (!key) return null;
    if (IMG[key]) return IMG[key].complete && IMG[key].naturalWidth ? IMG[key] : null;
    if (!loading[key]) { const im = new Image(); im.src = 'assets/img/' + key + '.webp'; IMG[key] = im; loading[key] = true; }
    return null;
  }
  function preload(keys) { keys.forEach(img); }

  const TW = 64, TH = 32, WALLH = 46, LOWH = 9, SPR_H = 62, BOSS_H = 96;
  const canvas = document.getElementById('scene');
  const ctx = canvas.getContext('2d');
  let W = 390, H = 290, DPR = 1;
  const cam = { x: 0, y: 0, init: false };
  const ents = {};       // id -> render state
  const fx = [];         // visual effects
  const floats = [];     // floating texts
  const tileCache = {};  // biome -> {floor, floorDark}
  const doorAnim = {};   // room index -> open progress
  let banner = null, shakeT = 0, lastT = 0, torchPhase = 0, lastFloorKey = '';
  const serif = () => getComputedStyle(document.body).getPropertyValue('--serif');
  const RANGED_ENEMY = { plague_cultist: 'dark', imp: 'fire', watcher: 'dark', void_spawn: 'dark', myconid: 'poison', mother_spore: 'poison', the_unmaker: 'dark', starved_god: 'dark', frost_king: 'ice', frost_wight: 'ice', forge_master: 'fire', spore_crawler: 'poison', faceless: 'dark' };
  const HERO_RANGED = { ranger: 'arrow', pyromancer: 'fire', necromancer: 'bolt', priest: 'holy' };
  const CLASS_COLOR = { knight: '#e8e0d0', rogue: '#c9d6ff', priest: '#ffe6a0', pyromancer: '#ff8a3a', ranger: '#cfe8b0', necromancer: '#8ff09a', berserker: '#ff6a5a', paladin: '#ffd66a' };
  const PROJ_COLOR = { arrow: '#d8d0c0', fire: '#ff8a2a', bolt: '#7dff8a', holy: '#ffe08a', dark: '#b57cff', poison: '#9be36a', ice: '#a9d1ff' };

  function resize() {
    const wrap = canvas.parentElement; const w = wrap.clientWidth || 390;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = w; H = Math.round(w * 0.78);
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
  function floorTile(biome, dark) {
    const key = biome.id + (dark ? 'd' : '');
    if (tileCache[key]) return tileCache[key];
    const im = img('tile_' + biome.id + '_floor'); if (!im) return null;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(TW * DPR); cv.height = Math.ceil(TH * DPR);
    const g = cv.getContext('2d'); g.scale(DPR, DPR);
    g.translate(TW / 2, TH / 2); g.scale(1, 0.5); g.rotate(Math.PI / 4);
    const s = TW / Math.SQRT2 + 1.5;
    g.drawImage(im, -s / 2, -s / 2, s, s);
    if (dark) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-s / 2, -s / 2, s, s); }
    tileCache[key] = cv; return cv;
  }
  function diamond(px, py, w, h) { ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + w / 2, py + h / 2); ctx.lineTo(px, py + h); ctx.lineTo(px - w / 2, py + h / 2); ctx.closePath(); }

  // wall faces. p = top corner of the tile diamond. sw face: left->bottom edge; se face: bottom->right edge.
  function wallFace(im, x0, y0, dx, dy, hgt, slice, shade) {
    const w = 64, h = 256;
    ctx.save();
    if (im) { ctx.transform(dx / w, dy / w, 0, hgt / h, x0, y0 - hgt); ctx.drawImage(im, slice, 0, 64, 256, 0, 0, w, h); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
    ctx.beginPath(); ctx.moveTo(x0, y0 - hgt); ctx.lineTo(x0 + dx, y0 + dy - hgt); ctx.lineTo(x0 + dx, y0 + dy); ctx.lineTo(x0, y0); ctx.closePath();
    if (!im) { ctx.fillStyle = '#2a2420'; ctx.fill(); }
    ctx.fillStyle = 'rgba(0,0,0,' + shade + ')'; ctx.fill();
    ctx.restore();
  }
  function drawWall(tx, ty, p, biome, low, hidden) {
    const hgt = low ? LOWH : WALLH;
    const im = img('tile_' + biome.id + '_wall');
    const slice = ((tx * 53 + ty * 17) % 3) * 64;
    // sw face (facing +y)
    wallFace(im, p.x - TW / 2, p.y + TH / 2, TW / 2, TH / 2, hgt, slice, hidden ? 0.8 : 0.42);
    // se face (facing +x)
    wallFace(im, p.x, p.y + TH, TW / 2, -TH / 2, hgt, (slice + 64) % 192, hidden ? 0.8 : 0.22);
    // top: darkened floor texture so it reads as rough stone
    const ft = floorTile(biome, true);
    if (ft) ctx.drawImage(ft, p.x - TW / 2, p.y - hgt, TW, TH);
    diamond(p.x, p.y - hgt, TW, TH);
    ctx.fillStyle = hidden ? 'rgba(4,3,2,0.95)' : 'rgba(0,0,0,0.5)'; ctx.fill();
    ctx.strokeStyle = hidden ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.stroke();
  }
  function drawDoor(tx, ty, p, open, hidden) {
    // door stands on the plane x = tx + 0.5, spanning the tile in y; face drawn from its +x side
    const a = toScreen(tx + 0.5, ty), b = toScreen(tx + 0.5, ty + 1);
    const im = img('tile_door');
    const k = 1 - open * 0.82;
    const dx = (b.x - a.x) * k, dy = (b.y - a.y) * k;
    // dark opening behind the door
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
    for (let i = 0; i < 4; i++) { const t = i / 4; ctx.strokeStyle = 'rgba(120,105,85,' + (0.5 - t * 0.4) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(p.x - TW / 2 + t * TW / 2, p.y + TH / 2 - t * TH / 2 + 4); ctx.lineTo(p.x + t * TW / 2, p.y + TH - t * TH / 2 + 4 - 6); ctx.stroke(); }
  }
  function drawProp(p, k, biome) {
    ctx.save(); ctx.translate(p.x, p.y + TH / 2);
    if (k === 0) { ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 6, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#5a4634'; ctx.fillRect(-11, -16, 22, 16); ctx.fillStyle = '#3a2a1a'; ctx.fillRect(-11, -10, 22, 2); ctx.beginPath(); ctx.ellipse(0, -16, 11, 6, 0, 0, Math.PI * 2); ctx.fillStyle = '#6a5440'; ctx.fill(); }
    else if (k === 1) { ctx.strokeStyle = '#cfc4a8'; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(-10 + i * 6, 2 - (i % 2) * 3); ctx.lineTo(-2 + i * 5, -6 + (i % 2) * 4); ctx.stroke(); } ctx.fillStyle = '#d8ccb0'; ctx.beginPath(); ctx.arc(6, -2, 4, 0, Math.PI * 2); ctx.fill(); }
    else if (k === 2) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, 14, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = biome.accent; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.ellipse(0, 0, 10, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.fillStyle = '#2c2622'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(0, -14); ctx.lineTo(9, 0); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  }
  function drawTorch(p, biome) {
    const f = 0.8 + Math.sin(torchPhase * 9 + p.x) * 0.15 + Math.sin(torchPhase * 23 + p.y) * 0.08;
    const fx0 = p.x - TW / 4, fy0 = p.y + TH * 0.75 - WALLH * 0.55; // on the sw face of the north wall
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(fx0, fy0 + 14, 4, fx0, fy0 + 14, TW * 1.6 * f);
    g.addColorStop(0, 'rgba(255,150,60,0.28)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(fx0, fy0 + 14, TW * 1.6 * f, TH * 1.6 * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(fx0 - 1.5, fy0, 3, 12);
    ctx.fillStyle = 'rgba(255,140,40,0.9)'; ctx.beginPath(); ctx.ellipse(fx0, fy0 - 3, 4 * f, 7 * f, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,140,0.95)'; ctx.beginPath(); ctx.ellipse(fx0, fy0 - 2, 2 * f, 4 * f, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ---------- entities ----------
  function ent(id, x, y, kind) {
    let e = ents[id];
    if (!e) { e = ents[id] = { id, x, y, tx: x, ty: y, kind, face: kind === 'hero' ? 1 : -1, lunge: 0, ldx: 0, ldy: 0, flash: 0, deadT: 0, bob: Math.random() * 6 }; }
    return e;
  }
  function spriteKeyFor(e) { return e.uid ? 'sp_' + e.cls : e.img.replace('en_', 'sp_'); }
  function drawSprite(re, key, portraitKey, opts) {
    const p = toScreen(re.x + re.ldx, re.y + re.ldy);
    const im = img(key);
    const h = (opts.boss ? BOSS_H : SPR_H) * (opts.scale || 1);
    const bob = opts.walking ? Math.abs(Math.sin(re.bob)) * 3 : 0;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, opts.boss ? 22 : 14, opts.boss ? 10 : 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.translate(p.x, p.y - bob);
    if (opts.dead) { ctx.globalAlpha = 0.55; ctx.rotate(re.face > 0 ? 1.35 : -1.35); ctx.filter = 'grayscale(1) brightness(0.6)'; }
    if (re.face < 0 !== (opts.nativeLeft || false)) ctx.scale(-1, 1);
    if (im) {
      const w = h * im.naturalWidth / im.naturalHeight;
      ctx.drawImage(im, -w / 2, -h, w, h);
      if (re.flash > 0) { ctx.globalAlpha = Math.min(1, re.flash) * 0.9; ctx.filter = 'brightness(3) saturate(0.2)'; ctx.drawImage(im, -w / 2, -h, w, h); }
    } else {
      const pim = img(portraitKey); const r = opts.boss ? 26 : 17;
      ctx.beginPath(); ctx.arc(0, -r - 4, r, 0, Math.PI * 2); ctx.fillStyle = '#111'; ctx.fill(); ctx.save(); ctx.clip(); if (pim) ctx.drawImage(pim, -r, -r * 2 - 4, r * 2, r * 2); ctx.restore(); ctx.strokeStyle = opts.boss ? '#e0403a' : '#3b3128'; ctx.lineWidth = 2; ctx.stroke();
      if (re.flash > 0) { ctx.fillStyle = 'rgba(255,80,60,' + Math.min(1, re.flash) * 0.6 + ')'; ctx.fill(); }
    }
    ctx.restore();
    return p;
  }
  function hpBar(p, w, pct, shieldPct, boss, yoff) {
    const y = p.y + (yoff || 6);
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, (boss ? 6 : 4) + 2);
    ctx.fillStyle = '#3a1512'; ctx.fillRect(p.x - w / 2, y, w, boss ? 6 : 4);
    ctx.fillStyle = boss ? '#d0473c' : '#b5392e'; ctx.fillRect(p.x - w / 2, y, w * Math.max(0, Math.min(1, pct)), boss ? 6 : 4);
    if (shieldPct > 0) { ctx.fillStyle = 'rgba(122,167,216,0.9)'; ctx.fillRect(p.x - w / 2, y, w * Math.min(1, shieldPct), 2); }
  }
  function nameTag(x, y, text, color) {
    ctx.font = '600 10px ' + serif(); ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 8; ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - w / 2, y - 9, w, 12);
    ctx.fillStyle = color || '#e6dcc6'; ctx.fillText(text, x, y);
  }

  // formation spots inside a room (world tile centres)
  const HERO_SPOTS = [[2, 0], [1, -1], [1, 1], [2, -2], [2, 2], [1, 0]];
  const ENEMY_SPOTS = [[-3, 0], [-2, -1], [-2, 1], [-3, -2], [-3, 2], [-2, 0]];
  function spot(room, i, enemy, boss) {
    const s = enemy ? ENEMY_SPOTS[i % ENEMY_SPOTS.length] : HERO_SPOTS[i % HERO_SPOTS.length];
    let x = enemy ? room.x + room.w + s[0] : room.x + s[0];
    let y = room.cy + s[1];
    if (boss) { x = room.x + room.w - 3; y = room.cy; }
    x = Math.max(room.x, Math.min(room.x + room.w - 1, x)); y = Math.max(room.y, Math.min(room.y + room.h - 1, y));
    return { x: x + 0.5, y: y + 0.5 };
  }
  function pathPos(seg, prog) {
    const path = seg.path; if (prog <= 0) return { x: path[0].x + 0.5, y: path[0].y + 0.5 };
    const i = Math.min(path.length - 1, Math.floor(prog)); const f = prog - i;
    const a = path[i], b = path[Math.min(path.length - 1, i + 1)];
    return { x: a.x + (b.x - a.x) * f + 0.5, y: a.y + (b.y - a.y) * f + 0.5 };
  }

  // ---------- effects ----------
  function addFx(o) { o.t = 0; fx.push(o); }
  function entPos(id) { const e = ents[id]; return e ? { x: e.x + e.ldx, y: e.y + e.ldy } : null; }
  function projectile(fromId, toId, kind, big) {
    const a = entPos(fromId), b = entPos(toId); if (!a || !b) return;
    addFx({ type: 'proj', kind, a, b, dur: 0.28, big, toId });
  }
  function slashAt(id, color, big, delay) { const p = entPos(id); if (!p) return; addFx({ type: 'slash', p, color, big, dur: 0.28, delay: delay || 0, rot: Math.random() * 1.2 - 0.6 }); }
  function burstAt(pos, color, big) { addFx({ type: 'burst', p: pos, color, dur: 0.35, big }); }
  function lungeTo(id, targetId) {
    const e = ents[id], t = ents[targetId]; if (!e) return;
    const dx = t ? t.x - e.x : (e.kind === 'hero' ? 1 : -1), dy = t ? t.y - e.y : 0;
    const len = Math.hypot(dx, dy) || 1; e.lunge = 0.32; e.lvx = dx / len * 0.55; e.lvy = dy / len * 0.55;
    if (t) e.face = (dx - dy) >= 0 ? 1 : -1;
  }
  function drawFx(f, dt) {
    f.t += dt; const k = f.t / f.dur;
    if (f.type === 'proj') {
      const x = f.a.x + (f.b.x - f.a.x) * k, y = f.a.y + (f.b.y - f.a.y) * k - Math.sin(k * Math.PI) * 0.3;
      const p = toScreen(x, y); p.y -= 26;
      const c = PROJ_COLOR[f.kind] || '#fff';
      if (f.kind === 'arrow') { const q = toScreen(f.a.x, f.a.y); const ang = Math.atan2(p.y - (q.y - 26), p.x - q.x); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(ang); ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(6, 0); ctx.stroke(); ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(3, -3); ctx.lineTo(3, 3); ctx.closePath(); ctx.fill(); ctx.restore(); }
      else { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const r = f.big ? 9 : 6; const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.5); g.addColorStop(0, c); g.addColorStop(0.4, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.5, 0, Math.PI * 2); ctx.fill(); for (let i = 1; i <= 3; i++) { const kk = Math.max(0, k - i * 0.06); const tx2 = f.a.x + (f.b.x - f.a.x) * kk, ty2 = f.a.y + (f.b.y - f.a.y) * kk - Math.sin(kk * Math.PI) * 0.3; const tp = toScreen(tx2, ty2); ctx.globalAlpha = 0.35 / i; ctx.beginPath(); ctx.arc(tp.x, tp.y - 26, r * (1 - i * 0.2), 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
      if (k >= 1) { burstAt(f.b, c, f.big); const t = ents[f.toId]; if (t) t.flash = 0.5; return false; }
      return true;
    }
    if (f.type === 'slash') {
      if (f.t < f.delay) return true; const kk = (f.t - f.delay) / f.dur; if (kk >= 1) return false;
      const p = toScreen(f.p.x, f.p.y); p.y -= 24;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(f.rot + kk * 0.6); ctx.globalAlpha = 1 - kk;
      ctx.strokeStyle = f.color; ctx.lineWidth = f.big ? 5 : 3; ctx.lineCap = 'round'; ctx.shadowColor = f.color; ctx.shadowBlur = 8;
      const r = (f.big ? 26 : 18) * (0.7 + kk * 0.5);
      ctx.beginPath(); ctx.arc(0, 0, r, -0.9 + kk * 2.2, 0.6 + kk * 2.2); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, r * 0.6, -0.6 + kk * 2.2, 0.5 + kk * 2.2); ctx.stroke();
      ctx.restore(); return true;
    }
    if (f.type === 'burst') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y); p.y -= 22;
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k; const r = (f.big ? 34 : 22) * (0.3 + k);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, f.color); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = f.color; ctx.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + k; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(a) * r * 0.4, p.y + Math.sin(a) * r * 0.4 * 0.6); ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r * 0.6); ctx.stroke(); }
      ctx.restore(); return true;
    }
    if (f.type === 'ring') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 4 * (1 - k) + 1; ctx.shadowColor = f.color; ctx.shadowBlur = 12;
      const r = f.radius * TW * k; ctx.beginPath(); ctx.ellipse(p.x, p.y, r, r / 2, 0, 0, Math.PI * 2); ctx.stroke();
      if (f.fill) { ctx.globalAlpha = (1 - k) * 0.25; ctx.fillStyle = f.color; ctx.fill(); }
      ctx.restore(); return true;
    }
    if (f.type === 'rise') { // sparkles / streaks rising on a target (heal, buff)
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f.color; ctx.strokeStyle = f.color; ctx.shadowColor = f.color; ctx.shadowBlur = 6;
      for (let i = 0; i < 7; i++) { const a = (i * 2.399 + f.seed) % (Math.PI * 2); const kk = (k + i * 0.13) % 1; const x = p.x + Math.cos(a) * 16, y = p.y - 8 - kk * 52; ctx.globalAlpha = (1 - kk) * 0.9; if (f.plus) { ctx.fillRect(x - 1, y - 4, 2, 8); ctx.fillRect(x - 4, y - 1, 8, 2); } else { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 10); ctx.lineWidth = 2; ctx.stroke(); } }
      ctx.restore(); return true;
    }
    if (f.type === 'pillar') {
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8; const g = ctx.createLinearGradient(0, p.y - 120, 0, p.y); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, f.color); ctx.fillStyle = g; ctx.fillRect(p.x - 14, p.y - 120, 28, 120); ctx.restore(); return true;
    }
    if (f.type === 'aura') { // shield ring
      if (k >= 1) return false; const p = toScreen(f.p.x, f.p.y);
      ctx.save(); ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = f.color; ctx.lineWidth = 3; ctx.shadowColor = f.color; ctx.shadowBlur = 10; ctx.beginPath(); ctx.ellipse(p.x, p.y - 2, 22 + k * 6, 11 + k * 3, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); return true;
    }
    return false;
  }

  function addFloat(id, text, kind) {
    const p = entPos(id); if (!p) return;
    const s = toScreen(p.x, p.y);
    const colors = { dmg: '#f0e6d2', hurt: '#ff6a5a', crit: '#ffd24a', heal: '#7fe07a', gold: '#f2c14e', miss: '#9a9a9a', shield: '#9cc4ff', status: '#c9b7ff', dot: '#b7e37a', loot: '#d9a0ff' };
    floats.push({ wx: p.x, wy: p.y, dx: (Math.random() - 0.5) * 18, dy: -58, vy: kind === 'crit' ? -1.4 : -0.9, life: kind === 'crit' || kind === 'loot' ? 1.6 : 1.1, text, color: colors[kind] || '#fff', size: kind === 'crit' ? 16 : kind === 'status' || kind === 'loot' ? 11 : 13, bold: kind === 'crit' });
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
    if (!R || !R.map) drawVillage(S, dt); else drawDungeon(S, R, dt, speed);
    // floats
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i]; f.life -= dt; f.dy += f.vy * 60 * dt; if (f.life <= 0) { floats.splice(i, 1); continue; }
      const p = f.wx != null ? toScreen(f.wx, f.wy) : { x: f.x, y: f.y };
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = (f.bold ? '800 ' : '700 ') + f.size + 'px ' + (f.bold ? serif() : 'sans-serif'); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.strokeText(f.text, p.x + f.dx, p.y + f.dy); ctx.fillStyle = f.color; ctx.fillText(f.text, p.x + f.dx, p.y + f.dy);
      ctx.globalAlpha = 1;
    }
    if (banner) {
      banner.t -= dt; if (banner.t <= 0) banner = null;
      else { const a = Math.min(1, banner.t * 2, (banner.dur - banner.t) * 3); ctx.globalAlpha = a; ctx.font = '700 ' + Math.round(H * 0.09) + 'px ' + serif(); ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(banner.text, W / 2, H * 0.3); ctx.fillStyle = banner.color; ctx.fillText(banner.text, W / 2, H * 0.3); ctx.globalAlpha = 1; }
    }
    if (R && R.phase === 'floorclear') { ctx.font = '700 ' + Math.round(H * 0.07) + 'px ' + serif(); ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.16); ctx.fillStyle = '#e8b45a'; ctx.fillText('FLOOR ' + R.floor + ' CLEARED', W / 2, H * 0.16); }
    ctx.restore();
    requestAnimationFrame(frame);
  }

  function drawVillage(S, dt) {
    const im = img('bg_village');
    ctx.fillStyle = '#1a1612'; ctx.fillRect(0, 0, W, H);
    if (im) { const ir = im.naturalWidth / im.naturalHeight; let dw = W, dh = W / ir; if (dh < H) { dh = H; dw = H * ir; } ctx.drawImage(im, (W - dw) / 2, (H - dh) * 0.3, dw, dh); }
    const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.75)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // party standing at the gate
    cam.x = 0; cam.y = 0; cam.init = false;
    const n = S.party.length;
    S.party.forEach((uid, i) => {
      const h = S.heroes.find((x) => x.uid === uid); if (!h) return;
      const re = ent(uid, 0, 0, 'hero'); re.face = 1; re.ldx = 0; re.ldy = 0;
      const p = { x: W * 0.5 + (i - (n - 1) / 2) * 52, y: H * 0.9 - (i % 2) * 10 };
      const im2 = img('sp_' + h.cls);
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 14, 6, 0, 0, Math.PI * 2); ctx.fill();
      if (im2) { const hh = 70, ww = hh * im2.naturalWidth / im2.naturalHeight; ctx.drawImage(im2, p.x - ww / 2, p.y - hh + Math.sin(torchPhase * 2 + i) * 1.5, ww, hh); }
      else { const pim = img(D.CLASSES[h.cls].img); ctx.save(); ctx.beginPath(); ctx.arc(p.x, p.y - 24, 20, 0, Math.PI * 2); ctx.clip(); if (pim) ctx.drawImage(pim, p.x - 20, p.y - 44, 40, 40); ctx.restore(); }
    });
    ctx.font = 'italic 12px ' + serif(); ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(230,220,200,0.75)'; ctx.fillText('The company waits at the gate.', W / 2, H * 0.22);
  }

  function drawDungeon(S, R, dt, speed) {
    const G = window.Game; const map = R.map; const bf = G.biomeFor(R.floor); const biome = bf.biome;
    const floorKey = R.floor + ':' + R.seed;
    if (floorKey !== lastFloorKey) { lastFloorKey = floorKey; for (const k in doorAnim) delete doorAnim[k]; for (const k in ents) if (!k.startsWith('h')) delete ents[k]; fx.length = 0; }
    const rooms = map.rooms; const seg = map.segs[R.room]; const inTravel = R.phase === 'travel' && seg;
    const roomIdx = inTravel ? R.room : R.room; // room the party currently occupies (or is leaving)
    const need = G.travelNeed(); const prog = inTravel ? (R.travelT / need) * seg.path.length : 0;

    // ---- update party targets ----
    const walking = inTravel && prog > 0.05;
    R.party.forEach((p, i) => {
      const h = S.heroes.find((x) => x.uid === p.uid); if (!h) return;
      const room = rooms[R.room];
      const s = spot(room, i, false);
      const re = ent(p.uid, s.x, s.y, 'hero');
      re.cls = h.cls;
      let tgt;
      if (inTravel) { const my = prog - i * 1.05; tgt = my > 0 ? pathPos(seg, my) : s; if (my > 0) re.walking = true; }
      else tgt = s;
      if (!re.init) { re.x = tgt.x; re.y = tgt.y; re.init = true; }
      const k = Math.min(1, dt * 7 * Math.max(1, speed * 0.8));
      const dx = tgt.x - re.x, dy = tgt.y - re.y;
      re.moving = Math.hypot(dx, dy) > 0.03;
      if (re.moving && !re.lunge) re.face = (dx - dy) >= -0.0001 ? 1 : -1;
      if (!inTravel && !re.moving && !re.lunge) re.face = 1;
      re.x += dx * k; re.y += dy * k;
      if (re.moving) re.bob += dt * 10 * speed;
      re.alive = p.alive;
    });
    // ---- enemies: current combat, or waiting behind the next door ----
    const nextRoom = rooms[R.room + 1];
    const list = R.phase === 'combat' ? R.enemies : (inTravel ? (R.next || []) : []);
    const enemyRoom = R.phase === 'combat' ? rooms[R.room] : nextRoom;
    list.forEach((e, i) => {
      if (!enemyRoom) return;
      const s = spot(enemyRoom, i, true, e.boss);
      const re = ent(e.id, s.x, s.y, 'enemy'); re.eid = e.eid; re.img = e.img; re.boss = e.boss;
      if (!re.init) { re.x = s.x; re.y = s.y; re.init = true; }
      const k = Math.min(1, dt * 6); re.x += (s.x - re.x) * k; re.y += (s.y - re.y) * k;
      if (!re.lunge) re.face = -1;
      re.alive = e.alive; if (!e.alive) re.deadT += dt;
      re.bob += dt * 2;
    });
    // lunge / flash decay
    for (const id in ents) { const e = ents[id]; if (e.lunge > 0) { e.lunge -= dt; const kk = Math.max(0, e.lunge) / 0.32; const s = Math.sin((1 - kk) * Math.PI); e.ldx = e.lvx * s; e.ldy = e.lvy * s; if (e.lunge <= 0) { e.lunge = 0; e.ldx = 0; e.ldy = 0; } } if (e.flash > 0) e.flash -= dt * 3; }
    // door animation: a room's east door swings open as the party leaves; its west door once the party reaches it
    if (R.doorOpen && inTravel) doorAnim['w' + (R.room + 1)] = Math.min(1, (doorAnim['w' + (R.room + 1)] || 0) + dt * 2.5);
    if (inTravel) doorAnim['e' + R.room] = Math.min(1, (doorAnim['e' + R.room] || 0) + dt * 2.5);
    for (let i = 1; i <= R.room; i++) { doorAnim['w' + i] = 1; doorAnim['e' + (i - 1)] = 1; }

    // ---- camera ----
    let camT;
    const leader = ents[R.party[0] && R.party[0].uid];
    if (R.phase === 'combat') { const alive = R.enemies.filter((e) => e.alive && ents[e.id]); const ex = alive.length ? alive.reduce((a, e) => a + ents[e.id].x, 0) / alive.length : leader.x, ey = alive.length ? alive.reduce((a, e) => a + ents[e.id].y, 0) / alive.length : leader.y; camT = { x: (leader.x + ex) / 2, y: (leader.y + ey) / 2 }; }
    else if (leader) camT = { x: leader.x + 0.8, y: leader.y - 0.3 };
    else camT = { x: map.start.x, y: map.start.y };
    if (!cam.init) { cam.x = camT.x; cam.y = camT.y; cam.init = true; }
    else { const k = Math.min(1, dt * 3); cam.x += (camT.x - cam.x) * k; cam.y += (camT.y - cam.y) * k; }

    // ---- background ----
    ctx.fillStyle = '#070605'; ctx.fillRect(0, 0, W, H);
    const bgim = img(biome.bg);
    if (bgim) { ctx.globalAlpha = 0.22; const ir = bgim.naturalWidth / bgim.naturalHeight; let dw = W, dh = W / ir; if (dh < H) { dh = H; dw = H * ir; } ctx.drawImage(bgim, (W - dw) / 2 - (cam.x - cam.y) * 2, (H - dh) / 2, dw, dh); ctx.globalAlpha = 1; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); }

    // ---- visibility ----
    const visibleOwner = (o) => { if (o < 0) return false; if (o >= 100) return o - 100 <= R.room; return o < R.room || o === R.room || (o === R.room + 1 && R.doorOpen); };
    const tiles = map.tiles, mw = map.w, mh = map.h;
    // visible tile range (cull by screen bounds)
    const inView = (p, pad) => p.x > -TW - pad && p.x < W + TW + pad && p.y > -WALLH - TH - pad && p.y < H + TH + pad;

    // ---- floors ----
    const ft = floorTile(biome, false), ftd = floorTile(biome, true);
    const drawables = [];
    for (let ty = 0; ty < mh; ty++) for (let tx = 0; tx < mw; tx++) {
      const v = tiles[ty * mw + tx]; if (v === DG.VOID) continue;
      const p = toScreen(tx, ty); if (!inView(p, 0)) continue;
      const o = map.owner[ty * mw + tx]; const vis = visibleOwner(o);
      if (v === DG.FLOOR || v === DG.DOOR) {
        const tile = ((tx * 7 + ty * 13) % 5 === 0) ? ftd : ft;
        if (tile) ctx.drawImage(tile, p.x - TW / 2, p.y, TW, TH); else { diamond(p.x, p.y, TW, TH); ctx.fillStyle = biome.tint; ctx.fill(); }
        if (!vis) { diamond(p.x, p.y, TW, TH); ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fill(); }
        if (tx === map.exit.x && ty === map.exit.y) drawStairs(p);
        if (v === DG.DOOR) drawables.push({ d: tx + ty + 1, f: () => drawDoor(tx, ty, p, doorAnim[roomOfDoor(map, tx, ty)] || 0, !vis) });
      } else if (v === DG.WALL) {
        const behind = (x2, y2) => { const t2 = x2 < 0 || y2 < 0 || x2 >= mw || y2 >= mh ? DG.VOID : tiles[y2 * mw + x2]; return t2 === DG.FLOOR || t2 === DG.DOOR; };
        const low = behind(tx - 1, ty) || behind(tx, ty - 1) || behind(tx - 1, ty - 1);
        drawables.push({ d: tx + ty + 1, f: () => drawWall(tx, ty, p, biome, low, !vis) });
      }
    }
    // props, torches
    for (const pr of map.props) { const o = map.owner[pr.y * mw + pr.x]; if (!visibleOwner(o)) continue; const p = toScreen(pr.x, pr.y); if (!inView(p, 0)) continue; drawables.push({ d: pr.x + pr.y + 1, f: () => drawProp(p, pr.k, biome) }); }
    for (const t of map.torches) { const o = map.owner[(t.y + 1) * mw + t.x]; if (!visibleOwner(o)) continue; const p = toScreen(t.x, t.y); if (!inView(p, 40)) continue; drawables.push({ d: t.x + t.y + 1.01, f: () => drawTorch(p, biome) }); }
    // floor chest at the exit when the floor is cleared
    if (R.phase === 'floorclear') { const r = rooms[rooms.length - 1]; const p = toScreen(r.cx, r.cy); drawables.push({ d: r.cx + r.cy + 1, f: () => { ctx.save(); ctx.translate(p.x, p.y + TH / 2); ctx.fillStyle = '#4a3418'; ctx.fillRect(-12, -14, 24, 14); ctx.fillStyle = '#7a5a2a'; ctx.fillRect(-12, -18, 24, 6); ctx.fillStyle = '#e8b45a'; ctx.fillRect(-2, -12, 4, 4); ctx.restore(); } }); }
    // entities
    const heroesById = {}; for (const h of S.heroes) heroesById[h.uid] = h;
    for (const p of R.party) {
      const re = ents[p.uid]; if (!re) continue; const h = heroesById[p.uid]; if (!h) continue;
      drawables.push({ d: re.x + re.y + re.ldx + re.ldy, f: () => { const sp = drawSprite(re, 'sp_' + h.cls, D.CLASSES[h.cls].img, { dead: !p.alive, walking: re.moving }); if (p.alive) hpBar(sp, 34, p.hp / p.maxhp, p.shield / p.maxhp, false); if (p.taunt > 0) nameTag(sp.x, sp.y - SPR_H - 8, 'TAUNT', '#ffd24a'); } });
    }
    for (const e of list) {
      const re = ents[e.id]; if (!re) continue;
      const roomVisible = R.phase === 'combat' || R.doorOpen;
      if (!roomVisible) continue;
      if (!e.alive && re.deadT > 0.8) continue;
      const sz = e.boss ? 1 : Math.max(0.7, Math.min(1.3, 0.72 + (e.spec ? e.spec.hp : 1) * 0.22));
      drawables.push({ d: re.x + re.y + re.ldx + re.ldy, f: () => { if (!e.alive) ctx.globalAlpha = Math.max(0, 1 - re.deadT / 0.8); const sp = drawSprite(re, e.img.replace('en_', 'sp_'), e.img, { boss: e.boss, dead: !e.alive, nativeLeft: true, scale: sz }); ctx.globalAlpha = 1; if (e.alive) { hpBar(sp, e.boss ? 56 : 34, e.hp / e.maxhp, 0, e.boss); if (e.boss || (R.phase === 'combat' && list.length <= 2)) nameTag(sp.x, sp.y - (e.boss ? BOSS_H : SPR_H) - 8, e.name, e.boss ? '#ff7a6a' : '#e6dcc6'); if (e.stun > 0) nameTag(sp.x, sp.y + 18, 'stunned', '#c9b7ff'); } } });
    }
    drawables.sort((a, b) => a.d - b.d);
    for (const d of drawables) d.f();
    // effects
    for (let i = fx.length - 1; i >= 0; i--) { if (!drawFx(fx[i], dt)) fx.splice(i, 1); }
    // vignette / fog
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.7)'); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    if (bf.cycle > 0) { ctx.fillStyle = bf.cycle === 1 ? 'rgba(120,20,40,0.16)' : 'rgba(60,0,90,0.22)'; ctx.fillRect(0, 0, W, H); }
  }
  function roomOfDoor(map, tx, ty) { // 'w'+i: west door of room i; 'e'+i: east door of room i
    for (let i = 0; i < map.rooms.length; i++) { const r = map.rooms[i]; if (tx === r.x - 1) return 'w' + i; if (tx === r.x + r.w) return 'e' + i; }
    return 'w0';
  }

  // ---------- engine bindings ----------
  function bind() {
    const G = window.Game;
    G.on('float', (f) => addFloat(f.id, f.text, f.kind));
    G.on('attack', (a) => {
      const src = ents[a.id]; if (!src) return;
      const S = G.S, R = S.run; if (!R) return;
      const targets = a.target === 'all' ? R.party.map((p) => p.uid) : [a.target];
      if (a.id.startsWith('h')) {
        const cls = src.cls; const ranged = HERO_RANGED[cls];
        if (ranged) { src.lunge = 0.2; src.lvx = -0.15; src.lvy = 0; src.face = 1; targets.forEach((t) => projectile(a.id, t, ranged, false)); }
        else { lungeTo(a.id, targets[0]); targets.forEach((t) => slashAt(t, CLASS_COLOR[cls] || '#fff', false, 0.1)); const t = ents[targets[0]]; if (t) setTimeout(() => { t.flash = 0.6; }, 120); }
      } else {
        const kind = RANGED_ENEMY[src.eid];
        if (kind) { src.lunge = 0.2; src.lvx = 0.15; src.lvy = 0; targets.forEach((t) => projectile(a.id, t, kind, src.boss)); }
        else { lungeTo(a.id, targets[0]); targets.forEach((t) => { slashAt(t, '#ff5a4a', src.boss, 0.1); const te = ents[t]; if (te) setTimeout(() => { te.flash = 0.6; }, 120); }); }
      }
    });
    G.on('skill', (s) => {
      const src = ents[s.id]; const S = G.S, R = S.run; if (!src || !R) return;
      const sk = Object.values(D.SKILLS).find((x) => x.name === s.name); if (!sk) return;
      const cls = src.cls; const color = CLASS_COLOR[cls] || '#fff';
      const alive = R.enemies.filter((e) => e.alive && ents[e.id]); const allies = R.party.filter((p) => p.alive && ents[p.uid]);
      const centroid = (arr, key) => { if (!arr.length) return null; let x = 0, y = 0; for (const a of arr) { const e = ents[key ? a[key] : a.id]; x += e.x; y += e.y; } return { x: x / arr.length, y: y / arr.length }; };
      const lowest = allies.length ? allies.reduce((a, b) => (a.hp / a.maxhp < b.hp / b.maxhp ? a : b)) : null;
      if (floats.filter((f) => f.skill).length < 3) floats.push({ wx: src.x, wy: src.y, dx: 0, dy: -70, vy: -0.5, life: 1.2, text: s.name, color: '#ffe0a0', size: 11, bold: true, skill: true });
      switch (sk.type) {
        case 'dmg': { const t = alive[0]; if (!t) break; const ranged = HERO_RANGED[cls]; if (ranged) projectile(s.id, t.id, ranged, true); else { lungeTo(s.id, t.id); slashAt(t.id, color, true, 0.1); } break; }
        case 'aoe': { const c = centroid(alive); if (c) { addFx({ type: 'ring', p: c, color, radius: 2.2, dur: 0.55, fill: cls === 'pyromancer' || cls === 'paladin' }); alive.forEach((e, i) => setTimeout(() => burstAt({ x: ents[e.id].x, y: ents[e.id].y }, color, true), 120 + i * 60)); } src.lunge = 0.25; src.lvx = 0.3; src.lvy = 0; break; }
        case 'dot': { const t = alive[Math.floor(Math.random() * alive.length)]; if (t) projectile(s.id, t.id, cls === 'pyromancer' ? 'fire' : 'poison', false); break; }
        case 'dotall': case 'debuffall': { const c = centroid(alive); if (c) addFx({ type: 'ring', p: c, color: cls === 'necromancer' ? '#7dff8a' : '#b57cff', radius: 2.2, dur: 0.6, fill: true }); break; }
        case 'debuff': { const t = alive[0]; if (t) projectile(s.id, t.id, HERO_RANGED[cls] || 'dark', false); break; }
        case 'heal': { if (lowest) addFx({ type: 'rise', p: { x: ents[lowest.uid].x, y: ents[lowest.uid].y }, color: '#7fe07a', dur: 0.9, plus: true, seed: Math.random() * 6 }); break; }
        case 'healself': { addFx({ type: 'rise', p: { x: src.x, y: src.y }, color: '#7fe07a', dur: 0.9, plus: true, seed: Math.random() * 6 }); break; }
        case 'cleanse': case 'buffall': case 'shieldall': { allies.forEach((p) => addFx({ type: sk.type === 'shieldall' ? 'aura' : 'rise', p: { x: ents[p.uid].x, y: ents[p.uid].y }, color: sk.type === 'shieldall' ? '#9cc4ff' : sk.type === 'cleanse' ? '#ffe6a0' : '#ffd66a', dur: 0.8, seed: Math.random() * 6 })); break; }
        case 'shield': { addFx({ type: 'aura', p: { x: src.x, y: src.y }, color: '#9cc4ff', dur: 0.8 }); break; }
        case 'taunt': case 'selfbuff': { addFx({ type: 'rise', p: { x: src.x, y: src.y }, color: sk.type === 'taunt' ? '#ffd24a' : color, dur: 0.8, seed: Math.random() * 6 }); break; }
        case 'revive': break; // handled by the revive event
      }
    });
    G.on('revive', (r) => { const e = ents[r.id]; if (e) addFx({ type: 'pillar', p: { x: e.x, y: e.y }, color: '#fff6d0', dur: 1.0 }); });
    G.on('kill', (k) => { if (k.boss) { showBanner('BOSS SLAIN', '#ff9a6a', 2.2); shake(); } });
    G.on('death', () => shake());
    G.on('loot', (l) => { const e = ents[l.id]; if (e) floats.push({ wx: e.x, wy: e.y, dx: 0, dy: -40, vy: -0.6, life: 1.8, text: l.item.name, color: D.RARITIES[l.item.rarity].color, size: 11, bold: true }); });
    G.on('door', (d) => { if (d.boss) { const R = G.S.run; const e = R.next && R.next.find((x) => x.boss); showBanner(e ? e.name.toUpperCase() : 'BOSS', '#e0403a', 2.5); } });
    G.on('floor', (f) => { const b = G.biomeFor(f.floor); if ((f.floor - 1) % D.FLOORS_PER_BIOME === 0) showBanner(b.biome.name.toUpperCase(), b.biome.accent, 3); cam.init = false; for (const k in ents) delete ents[k]; });
    G.on('runstart', () => { cam.init = false; for (const k in ents) delete ents[k]; fx.length = 0; floats.length = 0; });
    G.on('runend', () => { for (const k in ents) delete ents[k]; fx.length = 0; });
    G.on('levelup', (l) => { const e = ents[l.hero.uid]; if (e) floats.push({ wx: e.x, wy: e.y, dx: 0, dy: -76, vy: -0.6, life: 1.8, text: 'LEVEL ' + l.hero.level, color: '#ffe08a', size: 13, bold: true }); });
  }

  function start() { resize(); requestAnimationFrame(frame); }
  function preloadAll() {
    const keys = ['bg_village', 'tile_door'];
    for (const c in D.CLASSES) { keys.push('sp_' + c); keys.push(D.CLASSES[c].img); }
    for (const b of D.BIOMES) { keys.push('tile_' + b.id + '_floor'); keys.push('tile_' + b.id + '_wall'); keys.push(b.bg); }
    for (const s of D.SLOTS) keys.push(D.SLOT_ICON[s]);
    preload(keys);
    setTimeout(() => preload(Object.values(D.ENEMIES).map((e) => e.img.replace('en_', 'sp_'))), 1200);
    setTimeout(() => preload(Object.values(D.ENEMIES).map((e) => e.img)), 4000);
  }
  window.Render = { start, bind, preload, preloadAll, img, resize, showBanner };
})();
