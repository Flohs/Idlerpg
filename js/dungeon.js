/* GRIMDELVE — procedural dungeon layouts (pure data, no DOM).
 * A floor is a chain of big doored rooms joined by corridors, Diablo-style, with optional side alcoves
 * branching north or south off the main rooms. The route visits main room, its alcove (and back), next main room…
 * Whatever waits inside a room is revealed when its door opens.
 */
(function () {
  'use strict';
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const VOID = 0, FLOOR = 1, WALL = 2, DOOR = 3;

  // rooms: number of main encounter rooms (the last is the boss/exit room). Room 0 is the entry hall.
  function generate(floor, rooms, seed) {
    const rnd = mulberry32(seed || (floor * 7919 + 13));
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const H = 30;
    const R = [];
    let x = 3;
    const n = rooms + 1;
    for (let i = 0; i < n; i++) {
      const w = i === 0 ? ri(5, 6) : i === n - 1 ? ri(11, 13) : ri(8, 12);
      const h = i === 0 ? ri(4, 5) : i === n - 1 ? ri(8, 10) : ri(6, 9);
      const y = ri(11, H - h - 11);
      R.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2), main: true, idx: i });
      x += w + ri(5, 9);
    }
    const W = x + 3;
    const t = new Array(W * H).fill(VOID);
    const owner = new Array(W * H).fill(-1); // room index, or 100+stop index for corridors
    const set = (px, py, v, o) => { if (px >= 0 && py >= 0 && px < W && py < H) { t[py * W + px] = v; if (o != null && owner[py * W + px] < 0) owner[py * W + px] = o; } };
    const get = (px, py) => (px < 0 || py < 0 || px >= W || py >= H ? VOID : t[py * W + px]);
    const carveRoom = (r, i) => { for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) set(xx, yy, FLOOR, i); };
    R.forEach(carveRoom);
    // side alcoves off main rooms 1..n-2, north or south
    const overlaps = (a, b, m) => !(a.x + a.w + m <= b.x || b.x + b.w + m <= a.x || a.y + a.h + m <= b.y || b.y + b.h + m <= a.y);
    for (let i = 1; i < n - 1; i++) {
      if (rnd() > 0.6) continue;
      const m = R[i]; const w = ri(5, 8), h = ri(4, 6); const gap = ri(3, 5);
      const north = rnd() < 0.5;
      const cx = m.x + ri(2, m.w - 3);
      const sx = Math.max(2, Math.min(W - w - 2, cx - Math.floor(w / 2) + ri(-2, 2)));
      const sy = north ? m.y - gap - h : m.y + m.h + gap;
      if (sy < 2 || sy + h > H - 2) continue;
      const s = { x: sx, y: sy, w, h, cx: sx + Math.floor(w / 2), cy: sy + Math.floor(h / 2), main: false, parent: i, north, attachX: cx };
      if (R.some((o) => overlaps(o, s, 2))) continue;
      s.idx = R.length; R.push(s); carveRoom(s, s.idx); m.side = s.idx;
    }
    // route: stops with the segment leading to each
    const route = [{ room: 0, enc: false }]; // segs[k] leads to route[k]
    const segs = [null];
    const carve = (path, stopIdx) => { for (const p of path) if (p.v !== undefined) set(p.x, p.y, p.v, 100 + stopIdx); };
    for (let i = 1; i < n; i++) {
      const a = R[i - 1], b = R[i];
      const k = route.length;
      segs.push(connectEast(a, b, k, set, ri)); route.push({ room: i, enc: true, boss: i === n - 1 });
      if (b.side != null) {
        const s = R[b.side]; const k2 = route.length;
        const there = connectVertical(b, s, k2, set);
        segs.push(there); route.push({ room: s.idx, enc: true, side: true });
        const back = { path: there.path.slice().reverse(), doors: there.doors.map((d) => ({ ...d, idx: there.path.length - 1 - d.idx })).reverse() };
        back.doorIdx = back.doors.length ? back.doors[back.doors.length - 1].idx : 0;
        segs.push(back); route.push({ room: b.idx, enc: false, ret: true });
      }
    }
    // walls around everything walkable
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      if (get(xx, yy) !== VOID) continue;
      let near = -1;
      for (let dy = -1; dy <= 1 && near < 0; dy++) for (let dx = -1; dx <= 1; dx++) { const v = get(xx + dx, yy + dy); if (v === FLOOR || v === DOOR) { near = owner[(yy + dy) * W + xx + dx]; break; } }
      if (near >= 0) set(xx, yy, WALL, near);
    }
    // decorations
    const torches = [], props = [];
    for (const r of R) {
      const k = Math.max(1, Math.floor(r.w / 3));
      for (let j = 0; j < k; j++) torches.push({ x: r.x + Math.floor((j + 0.5) * r.w / k), y: r.y - 1 });
      const pc = ri(0, 3);
      for (let j = 0; j < pc; j++) props.push({ x: ri(r.x, r.x + r.w - 1), y: ri(r.y, r.y + r.h - 1), k: ri(0, 3) });
    }
    // first visit order per room (for fog)
    const visitOrder = {}; route.forEach((s, k) => { if (visitOrder[s.room] === undefined) visitOrder[s.room] = k; });
    const last = R[n - 1];
    const exit = { x: last.x + last.w - 1, y: last.cy };
    // trim empty rows to keep the map compact
    return { w: W, h: H, tiles: t, owner, rooms: R, route, segs, visitOrder, torches, props, start: { x: R[0].cx, y: R[0].cy }, exit, encounters: route.filter((s) => s.enc).length };
  }
  // corridor from room a (east door) to room b (west door); path from a's centre to just inside b
  function connectEast(a, b, k, set, ri) {
    const path = [], doors = [];
    let px = a.cx, py = a.cy;
    const midX = a.x + a.w + 1 + Math.floor((b.x - 1 - (a.x + a.w + 1)) / 2);
    const step = (nx, ny, v) => { px = nx; py = ny; if (v !== undefined) set(px, py, v, 100 + k); path.push({ x: px, y: py }); };
    path.push({ x: px, y: py });
    while (px < a.x + a.w - 1) step(px + 1, py);
    step(px + 1, py, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ew' });
    while (px < midX) step(px + 1, py, FLOOR);
    while (py !== b.cy) step(px, py + (b.cy > py ? 1 : -1), FLOOR);
    while (px < b.x - 2) step(px + 1, py, FLOOR);
    step(px + 1, py, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ew' });
    step(px + 1, py);
    return { path, doors, doorIdx: doors[doors.length - 1].idx };
  }
  // corridor from main room m up/down to side room s (doors on m's top/bottom wall and s's bottom/top wall)
  function connectVertical(m, s, k, set) {
    const path = [], doors = [];
    let px = m.cx, py = m.cy;
    const step = (nx, ny, v) => { px = nx; py = ny; if (v !== undefined) set(px, py, v, 100 + k); path.push({ x: px, y: py }); };
    path.push({ x: px, y: py });
    while (px !== s.attachX) step(px + (s.attachX > px ? 1 : -1), py);
    if (s.north) {
      while (py > m.y) step(px, py - 1);
      step(px, py - 1, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ns' });
      const midY = s.y + s.h + Math.floor((m.y - 1 - (s.y + s.h)) / 2);
      while (py > midY) step(px, py - 1, FLOOR);
      while (px !== s.cx) step(px + (s.cx > px ? 1 : -1), py, FLOOR);
      while (py > s.y + s.h + 1) step(px, py - 1, FLOOR);
      step(px, py - 1, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ns' });
      step(px, py - 1);
    } else {
      while (py < m.y + m.h - 1) step(px, py + 1);
      step(px, py + 1, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ns' });
      const midY = m.y + m.h + Math.floor((s.y - 1 - (m.y + m.h)) / 2);
      while (py < midY) step(px, py + 1, FLOOR);
      while (px !== s.cx) step(px + (s.cx > px ? 1 : -1), py, FLOOR);
      while (py < s.y - 2) step(px, py + 1, FLOOR);
      step(px, py + 1, DOOR); doors.push({ idx: path.length - 1, x: px, y: py, dir: 'ns' });
      step(px, py + 1);
    }
    return { path, doors, doorIdx: doors[doors.length - 1].idx };
  }
  window.Dungeon = { generate, VOID, FLOOR, WALL, DOOR };
})();
