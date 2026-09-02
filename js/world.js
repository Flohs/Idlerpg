/* GRIMDELVE — overworld zones (pure data, no DOM).
 * A zone is an open map of ground, paths, water, rock and trees with points of interest:
 * the town gate or waypoint, enemy camps, a boss lair, dungeon entrances, shrines, chests and the exit to the next zone.
 */
(function () {
  'use strict';
  const D = window.DATA;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const GROUND = 0, PATH = 1, WATER = 2, ROCK = 3, TREE = 4;
  const BLOCKED = (v) => v === WATER || v === ROCK || v === TREE;

  D.ZONE_THEMES = [
    { id: 'moors', name: 'Blighted Moors', ground: 'tile_moors_ground', path: 'tile_moors_path', tree: 'prop_tree_dead', tint: '#1c2118', fog: 'rgba(10,14,8,0.6)', accent: '#b8a860',
      enemies: ['skeleton', 'ghoul', 'grave_bat', 'plague_rat', 'sewer_rat_swarm', 'plague_cultist', 'drowned'], boss: 'bone_lord', dungeon: 'Catacombs', flavor: 'Dead heather, old graves, and something that keeps digging them up.' },
    { id: 'fens', name: 'Fungal Fens', ground: 'tile_fens_ground', path: 'tile_fens_path', tree: 'prop_tree_swamp', tint: '#141f1c', fog: 'rgba(6,18,14,0.6)', accent: '#6fd6c0',
      enemies: ['slime', 'drowned', 'spore_crawler', 'cave_spider', 'myconid', 'blind_troll', 'plague_cultist'], boss: 'mother_spore', dungeon: 'Sunken Warren', flavor: 'The water is warm. Nothing here is alive in the usual way.' },
    { id: 'tundra', name: 'Frozen Reach', ground: 'tile_tundra_ground', path: 'tile_tundra_path', tree: 'prop_tree_pine', tint: '#1a2028', fog: 'rgba(8,12,20,0.6)', accent: '#9fc9ff',
      enemies: ['frost_wight', 'ice_golem', 'frozen_dwarf', 'wendigo', 'grave_bat', 'skeleton'], boss: 'frost_king', dungeon: 'Frost Halls', flavor: 'The snow does not melt. The dead do not rot.' },
    { id: 'ash', name: 'Ashen Wastes', ground: 'tile_ash_ground', path: 'tile_ash_path', tree: 'prop_tree_ash', tint: '#221410', fog: 'rgba(24,8,4,0.6)', accent: '#ff7a3a',
      enemies: ['imp', 'forge_golem', 'hellhound', 'chained_devil', 'void_spawn', 'watcher', 'faceless'], boss: 'forge_master', dungeon: 'Infernal Pit', flavor: 'Ash falls upward here. The sky is the wrong colour.' },
  ];
  const ADJ = ['Rotting', 'Howling', 'Blackened', 'Weeping', 'Hollow', 'Sunken', 'Bleak', 'Broken', 'Silent', 'Withered'];
  const NOUN = ['Hollow', 'Barrow', 'Cross', 'Fell', 'Mire', 'Reach', 'Ridge', 'Ford', 'Waste', 'Vale'];

  function noise2(rnd, w, h, cell) {
    // value noise: random lattice + bilinear interpolation
    const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
    const g = new Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = rnd();
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = x / cell, fy = y / cell; const x0 = Math.floor(fx), y0 = Math.floor(fy); const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1], c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    }
    return out;
  }
  function bfs(map, sx, sy, passable) {
    const w = map.w, h = map.h; const dist = new Int32Array(w * h).fill(-1); const par = new Int32Array(w * h).fill(-1);
    const q = [sy * w + sx]; dist[sy * w + sx] = 0; let qi = 0;
    while (qi < q.length) {
      const c = q[qi++]; const cx = c % w, cy = (c - cx) / w;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const ni = ny * w + nx; if (dist[ni] >= 0) continue; if (!passable(nx, ny)) continue; dist[ni] = dist[c] + 1; par[ni] = c; q.push(ni); }
    }
    return { dist, par, order: q };
  }
  function walkable(map, x, y) { if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false; return !BLOCKED(map.tiles[y * map.w + x]); }
  function pathFromPar(map, par, to) { const w = map.w; const out = []; let c = to; let guard = 0; while (c >= 0 && guard++ < 100000) { out.push({ x: c % w, y: Math.floor(c / w) }); c = par[c]; } return out.reverse(); }
  function pathTo(map, from, to) { const r = bfs(map, from.x, from.y, (x, y) => walkable(map, x, y)); const ti = to.y * map.w + to.x; if (r.dist[ti] < 0) return null; return pathFromPar(map, r.par, ti); }
  // nearest reachable tile that is walkable and unexplored (explored: array of 0/1); prefer POIs found but not visited
  function nearestUnexplored(map, explored, from) {
    const r = bfs(map, from.x, from.y, (x, y) => walkable(map, x, y));
    for (const c of r.order) { if (!explored[c]) return { tile: { x: c % map.w, y: Math.floor(c / map.w) }, path: pathFromPar(map, r.par, c) }; }
    return null;
  }
  function reveal(map, explored, x, y, radius) {
    let n = 0; const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) { if (dx * dx + dy * dy > r2) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue; const i = ny * map.w + nx; if (!explored[i]) { explored[i] = 1; n++; } }
    return n;
  }

  function generate(zone, seed) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const m = tryGenerate(zone, (seed || zone * 104729) + attempt * 7919);
      if (m) return m;
    }
    return tryGenerate(zone, seed || zone * 104729, true);
  }
  function tryGenerate(zone, seed, force) {
    const rnd = mulberry32(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const theme = D.ZONE_THEMES[(zone - 1) % D.ZONE_THEMES.length];
    const w = 44, h = 44;
    const tiles = new Array(w * h).fill(GROUND);
    const n1 = noise2(rnd, w, h, 7), n2 = noise2(rnd, w, h, 4), n3 = noise2(rnd, w, h, 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; const v = n1[i] * 0.7 + n2[i] * 0.3;
      if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) { tiles[i] = ROCK; continue; }
      if (v < 0.27) tiles[i] = WATER; else if (v > 0.74) tiles[i] = ROCK; else if (n3[i] > 0.735 && n2[i] > 0.45) tiles[i] = TREE;
    }
    // start: a ground tile in the top-left quadrant
    let start = null;
    for (let tries = 0; tries < 400 && !start; tries++) { const x = ri(3, 10), y = ri(3, 10); if (tiles[y * w + x] === GROUND) start = { x, y }; }
    if (!start) return force ? null : null;
    // clear a small area around start
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const x = start.x + dx, y = start.y + dy; if (x > 1 && y > 1 && x < w - 2 && y < h - 2) tiles[y * w + x] = GROUND; }
    const map = { w, h, tiles, theme: theme.id, zone, start, pois: [] };
    // connectivity: anything not reachable from start becomes rock
    let r = bfs(map, start.x, start.y, (x, y) => walkable(map, x, y));
    let reach = 0; for (let i = 0; i < w * h; i++) { if (!BLOCKED(tiles[i]) && r.dist[i] < 0) tiles[i] = ROCK; else if (!BLOCKED(tiles[i])) reach++; }
    if (reach < w * h * 0.35 && !force) return null;
    // POI placement helper: reachable ground at distance bounds, away from other POIs
    const used = [];
    const place = (type, minD, maxD, spacing) => {
      const cands = [];
      for (const c of r.order) { const d = r.dist[c]; if (d < minD || d > maxD) continue; const x = c % w, y = Math.floor(c / w); if (tiles[c] !== GROUND) continue; if (used.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < spacing)) continue; cands.push({ x, y, d }); }
      if (!cands.length) return null;
      const p = cands[Math.floor(rnd() * cands.length)]; const poi = { type, x: p.x, y: p.y, found: false, done: false, id: type + '_' + map.pois.length }; used.push(p); map.pois.push(poi);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = p.x + dx, y = p.y + dy; if (x > 1 && y > 1 && x < w - 2 && y < h - 2 && tiles[y * w + x] === TREE) tiles[y * w + x] = GROUND; }
      return poi;
    };
    let maxD = 0; for (let i = 0; i < w * h; i++) if (r.dist[i] > maxD) maxD = r.dist[i];
    const town = { type: zone === 1 ? 'town' : 'waypoint', x: start.x, y: start.y, found: true, done: true, id: 'start' }; map.pois.push(town); used.push(start);
    const exit = place('exit', Math.floor(maxD * 0.8), maxD, 6); if (!exit && !force) return null;
    const lair = place('lair', Math.floor(maxD * 0.55), Math.floor(maxD * 0.85), 7); if (!lair && !force) return null;
    if (lair) { lair.name = D.ENEMIES[theme.boss].name; lair.boss = theme.boss; }
    const dn = zone === 1 ? 1 : 2;
    for (let i = 0; i < dn; i++) { const d = place('dungeon', Math.floor(maxD * 0.25), Math.floor(maxD * 0.75), 8); if (d) { d.name = `${ADJ[ri(0, ADJ.length - 1)]} ${theme.dungeon}`; d.baseFloor = (zone - 1) * 10 + 1 + i * 5; } }
    const camps = ri(5, 7);
    for (let i = 0; i < camps; i++) { const c = place('camp', 8, maxD, 6); if (c) { c.name = `${ADJ[ri(0, ADJ.length - 1)]} ${NOUN[ri(0, NOUN.length - 1)]} camp`; c.size = ri(3, 5); } }
    for (let i = 0; i < 2; i++) place('shrine', 6, maxD, 5);
    for (let i = 0; i < 3; i++) place('chest', 5, maxD, 4);
    // paths: dirt trail from start to exit and to each dungeon
    for (const p of map.pois) { if (p.type !== 'exit' && p.type !== 'dungeon' && p.type !== 'lair') continue; const path = pathFromPar(map, r.par, p.y * w + p.x); for (const t of path) if (tiles[t.y * w + t.x] === GROUND) tiles[t.y * w + t.x] = PATH; }
    map.name = `${theme.name}`; map.title = zone === 1 ? theme.name : `${theme.name} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.floor((zone - 1) / D.ZONE_THEMES.length)] || ''}`.trim();
    map.walkableCount = reach;
    // decorative rocks: a few boulders on ground away from POIs
    map.rocks = []; for (let i = 0; i < 14; i++) { const x = ri(3, w - 4), y = ri(3, h - 4); if (tiles[y * w + x] === GROUND && !used.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < 3)) { tiles[y * w + x] = ROCK; map.rocks.push({ x, y }); } }
    // re-check connectivity after rocks (rocks only placed on ground, could split; make sure POIs still reachable)
    r = bfs(map, start.x, start.y, (x, y) => walkable(map, x, y));
    for (const p of map.pois) if (r.dist[p.y * w + p.x] < 0) { return force ? map : null; }
    for (let i = 0; i < w * h; i++) if (!BLOCKED(tiles[i]) && r.dist[i] < 0) tiles[i] = ROCK;
    map.walkableCount = 0; for (let i = 0; i < w * h; i++) if (!BLOCKED(tiles[i])) map.walkableCount++;
    return map;
  }
  function zoneLevel(zone) { return 1 + (zone - 1) * 10; }
  window.World = { generate, bfs, walkable, pathTo, nearestUnexplored, reveal, zoneLevel, GROUND, PATH, WATER, ROCK, TREE, BLOCKED };
})();
