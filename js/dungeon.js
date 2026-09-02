/* GRIMDELVE — procedural dungeon layouts (pure data, no DOM).
 * A floor is a chain of doored rooms joined by corridors, Diablo-style:
 * the party leaves a room through a door on its east wall, walks the corridor,
 * and opens the next room's west door — whatever waits inside is revealed then.
 */
(function () {
  'use strict';
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const VOID = 0, FLOOR = 1, WALL = 2, DOOR = 3;

  // rooms: number of encounter rooms. Room 0 is the entry hall (no enemies); the last room holds the exit stairs.
  function generate(floor, rooms, seed) {
    const rnd = mulberry32(seed || (floor * 7919 + 13));
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const H = 17;
    const R = [];
    let x = 2;
    const n = rooms + 1;
    for (let i = 0; i < n; i++) {
      const w = i === 0 ? ri(4, 5) : i === n - 1 ? ri(7, 9) : ri(5, 8);
      const h = i === 0 ? ri(4, 5) : i === n - 1 ? ri(6, 8) : ri(5, 7);
      const y = ri(2, H - h - 2);
      R.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      x += w + ri(5, 10);
    }
    const W = x + 2;
    const t = new Array(W * H).fill(VOID);
    const owner = new Array(W * H).fill(-1); // room index, or 100+segment index for corridors
    const set = (px, py, v, o) => { if (px >= 0 && py >= 0 && px < W && py < H) { t[py * W + px] = v; if (o != null && owner[py * W + px] < 0) owner[py * W + px] = o; } };
    const get = (px, py) => (px < 0 || py < 0 || px >= W || py >= H ? VOID : t[py * W + px]);
    R.forEach((r, i) => { for (let yy = r.y; yy < r.y + r.h; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) set(xx, yy, FLOOR, i); });
    // corridors with a door at each end; the walking path runs from the previous room's centre to just inside the next door
    const segs = [];
    for (let i = 0; i < n - 1; i++) {
      const a = R[i], b = R[i + 1];
      const path = [];
      let px = a.cx, py = a.cy;
      const midX = a.x + a.w + 1 + Math.floor((b.x - 1 - (a.x + a.w + 1)) / 2);
      const step = (nx, ny, v) => { px = nx; py = ny; if (v !== undefined) set(px, py, v, 100 + i); path.push({ x: px, y: py }); };
      path.push({ x: px, y: py });
      while (px < a.x + a.w - 1) step(px + 1, py);          // walk to the east wall inside room a
      step(px + 1, py, DOOR); const exitDoor = path.length - 1; // door on a's east wall
      while (px < midX) step(px + 1, py, FLOOR);
      while (py !== b.cy) step(px, py + (b.cy > py ? 1 : -1), FLOOR);
      while (px < b.x - 2) step(px + 1, py, FLOOR);
      step(px + 1, py, DOOR); const doorIdx = path.length - 1; // door on b's west wall
      step(px + 1, py);                                        // entry tile inside b
      segs.push({ path, doorIdx, exitDoor });
    }
    // walls around everything walkable
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      if (get(xx, yy) !== VOID) continue;
      let near = -1;
      for (let dy = -1; dy <= 1 && near < 0; dy++) for (let dx = -1; dx <= 1; dx++) { const v = get(xx + dx, yy + dy); if (v === FLOOR || v === DOOR) { near = owner[(yy + dy) * W + xx + dx]; break; } }
      if (near >= 0) set(xx, yy, WALL, near);
    }
    // decorations: torches on the north wall of each room, props on the floor
    const torches = [], props = [];
    for (let i = 0; i < n; i++) {
      const r = R[i];
      const k = Math.max(1, Math.floor(r.w / 3));
      for (let j = 0; j < k; j++) torches.push({ x: r.x + Math.floor((j + 0.5) * r.w / k), y: r.y - 1 });
      const pc = ri(0, 2);
      for (let j = 0; j < pc; j++) props.push({ x: ri(r.x, r.x + r.w - 1), y: ri(r.y, r.y + r.h - 1), k: ri(0, 3) });
    }
    const last = R[n - 1];
    const exit = { x: last.x + last.w - 1, y: last.cy };
    return { w: W, h: H, tiles: t, owner, rooms: R, segs, torches, props, start: { x: R[0].cx, y: R[0].cy }, exit };
  }
  window.Dungeon = { generate, VOID, FLOOR, WALL, DOOR };
})();
