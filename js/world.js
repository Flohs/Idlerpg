/* GRIMDELVE — overworld zones (pure data, no DOM).
 * A zone is an open map of ground, paths, water, rock and trees with points of interest:
 * the town gate or waypoint, enemy camps, a boss lair, dungeon entrances, shrines, chests and the exit to the next zone.
 */
(function () {
  'use strict';
  const D = window.DATA;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const GROUND = 0, PATH = 1, WATER = 2, ROCK = 3, TREE = 4, VOID = 5;
  const BLOCKED = (v) => v === WATER || v === ROCK || v === TREE || v === VOID;

  D.ZONE_THEMES = [
    { id: 'moors', name: 'Blighted Moors', base: 'tile_moors_base', ground: 'tile_moors_ground', alt: 'tile_moors_alt', path: 'tile_moors_path', tree: 'prop_tree_dead', bigTree: 'prop_bigtree_moors', cave: 'prop_cave_moors', clutter: ['prop_clutter_graves', 'prop_clutter_bush'], tint: '#1c2118', fog: 'rgba(10,14,8,0.6)', accent: '#b8a860',
      enemies: ['skeleton', 'ghoul', 'grave_bat', 'plague_rat', 'sewer_rat_swarm', 'plague_cultist', 'drowned'], boss: 'bone_lord', dungeon: 'Catacombs', flavor: 'Dead heather, old graves, and something that keeps digging them up.' },
    { id: 'fens', name: 'Fungal Fens', base: 'tile_fens_base', ground: 'tile_fens_ground', alt: 'tile_fens_alt', path: 'tile_fens_path', tree: 'prop_tree_swamp', bigTree: 'prop_bigtree_fens', cave: 'prop_cave_fens', clutter: ['prop_clutter_mushrooms', 'prop_clutter_boat'], tint: '#141f1c', fog: 'rgba(6,18,14,0.6)', accent: '#6fd6c0',
      enemies: ['slime', 'drowned', 'spore_crawler', 'cave_spider', 'myconid', 'blind_troll', 'plague_cultist'], boss: 'mother_spore', dungeon: 'Sunken Warren', flavor: 'The water is warm. Nothing here is alive in the usual way.' },
    { id: 'tundra', name: 'Frozen Reach', base: 'tile_tundra_base', ground: 'tile_tundra_ground', alt: 'tile_tundra_alt', path: 'tile_tundra_path', tree: 'prop_tree_pine', bigTree: 'prop_bigtree_tundra', cave: 'prop_cave_tundra', clutter: ['prop_clutter_ice', 'prop_clutter_frozen'], tint: '#1a2028', fog: 'rgba(8,12,20,0.6)', accent: '#9fc9ff',
      enemies: ['frost_wight', 'ice_golem', 'frozen_dwarf', 'wendigo', 'grave_bat', 'skeleton'], boss: 'frost_king', dungeon: 'Frost Halls', flavor: 'The snow does not melt. The dead do not rot.' },
    { id: 'ash', name: 'Ashen Wastes', base: 'tile_ash_base', ground: 'tile_ash_ground', alt: 'tile_ash_alt', path: 'tile_ash_path', tree: 'prop_tree_ash', bigTree: 'prop_bigtree_ash', cave: 'prop_cave_ash', clutter: ['prop_clutter_bones', 'prop_clutter_wagon'], tint: '#221410', fog: 'rgba(24,8,4,0.6)', accent: '#ff7a3a',
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
    const w = 128, h = 112;
    const tiles = new Array(w * h).fill(VOID);
    const inGrid = (x, y) => x > 2 && y > 2 && x < w - 3 && y < h - 3;
    const carve = (cx, cy, r) => { const r2 = r * r; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r2) continue; const x = Math.round(cx + dx), y = Math.round(cy + dy); if (inGrid(x, y)) tiles[y * w + x] = GROUND; } };
    // a winding spine from one corner region to the far side, like an Act 1 field
    const start = { x: 12 + ri(0, 8), y: 12 + ri(0, 10) };
    const end = { x: w - 14 - ri(0, 10), y: h - 14 - ri(0, 12) };
    const pts = [start]; const segs = 7;
    const nx = -(end.y - start.y), ny = (end.x - start.x); const nl = Math.hypot(nx, ny) || 1;
    for (let i = 1; i < segs; i++) { const t = i / segs; const off = (rnd() - 0.5) * 2 * 30; pts.push({ x: start.x + (end.x - start.x) * t + nx / nl * off, y: start.y + (end.y - start.y) * t + ny / nl * off }); }
    pts.push(end);
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)); for (let k = 0; k <= steps; k++) { const t = k / steps; const r = 9 + 5 * (1 + Math.sin(i * 1.9 + t * 2.7 + zone)); carve(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r); } }
    // side pockets off the spine
    const lobes = ri(3, 5); const lobeCentres = [];
    for (let i = 0; i < lobes; i++) { const at = pts[ri(1, pts.length - 2)]; const side = rnd() < 0.5 ? -1 : 1; const dist = ri(18, 30); const c = { x: at.x + nx / nl * dist * side, y: at.y + ny / nl * dist * side }; carve(c.x, c.y, ri(10, 16)); const steps = Math.ceil(dist); for (let k = 0; k <= steps; k++) { const t = k / steps; carve(at.x + (c.x - at.x) * t, at.y + (c.y - at.y) * t, 4); } lobeCentres.push(c); }
    // terrain inside the carved land
    const n1 = noise2(rnd, w, h, 12), n2 = noise2(rnd, w, h, 6), n3 = noise2(rnd, w, h, 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (tiles[i] !== GROUND) continue; const v = n1[i] * 0.7 + n2[i] * 0.3;
      if (v < 0.24) tiles[i] = WATER; else if (v > 0.8) tiles[i] = ROCK; else if (n3[i] > 0.7 && n2[i] > 0.42) tiles[i] = TREE;
    }
    // cliffs: void next to land becomes rock
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (tiles[i] !== VOID) continue; let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (tiles[(y + dy) * w + x + dx] !== VOID && tiles[(y + dy) * w + x + dx] !== ROCK) { near = true; break; } if (near) tiles[i] = ROCK; }
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const x = start.x + dx, y = start.y + dy; if (inGrid(x, y)) tiles[y * w + x] = GROUND; }
    const map = { w, h, tiles, theme: theme.id, zone, start, pois: [] };
    let r = bfs(map, start.x, start.y, (x, y) => walkable(map, x, y));
    let reach = 0; for (let i = 0; i < w * h; i++) { if (!BLOCKED(tiles[i]) && r.dist[i] < 0) tiles[i] = ROCK; else if (!BLOCKED(tiles[i])) reach++; }
    if (reach < 1800 && !force) return null;
    const used = [];
    const place = (type, minD, maxD, spacing) => {
      const cands = [];
      for (const c of r.order) { const d = r.dist[c]; if (d < minD || d > maxD) continue; const x = c % w, y = Math.floor(c / w); if (tiles[c] !== GROUND) continue; if (used.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < spacing)) continue; cands.push({ x, y, d }); }
      if (!cands.length) return null;
      const pk = cands[Math.floor(rnd() * cands.length)]; const poi = { type, x: pk.x, y: pk.y, found: false, done: false, id: type + '_' + map.pois.length }; used.push(pk); map.pois.push(poi);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = pk.x + dx, y = pk.y + dy; if (inGrid(x, y) && tiles[y * w + x] === TREE) tiles[y * w + x] = GROUND; }
      return poi;
    };
    let maxD = 0; for (let i = 0; i < w * h; i++) if (r.dist[i] > maxD) maxD = r.dist[i];
    const town = { type: zone === 1 ? 'town' : 'waypoint', x: start.x, y: start.y, found: true, done: true, id: 'start' }; map.pois.push(town); used.push(start);
    const exit = place('exit', Math.floor(maxD * 0.85), maxD, 10); if (!exit && !force) return null;
    const lair = place('lair', Math.floor(maxD * 0.55), Math.floor(maxD * 0.85), 16); if (!lair && !force) return null;
    if (lair) { lair.name = D.ENEMIES[theme.boss].name; lair.boss = theme.boss; lair.members = [{ eid: theme.boss, ox: 0.5, oy: 0.5, boss: true }]; for (let i = 0; i < 2; i++) lair.members.push({ eid: theme.enemies[ri(0, theme.enemies.length - 1)], ox: rnd(), oy: rnd() }); }
    const dn = ri(1, 2);
    for (let i = 0; i < dn; i++) { const d = place('dungeon', Math.floor(maxD * 0.2), Math.floor(maxD * 0.8), 24); if (d) { d.name = `${ADJ[ri(0, ADJ.length - 1)]} ${theme.dungeon}`; d.baseFloor = (zone - 1) * 10 + 1; d.floors = zone >= 8 ? 0 : zone; } }
    const packs = ri(8, 12);
    for (let i = 0; i < packs; i++) { const c = place('pack', 12, maxD, 11); if (c) { c.size = ri(2, zone === 1 ? 3 : 4); c.members = []; for (let k = 0; k < c.size; k++) c.members.push({ eid: theme.enemies[ri(0, theme.enemies.length - 1)], ox: rnd(), oy: rnd() }); } }
    for (let i = 0; i < 3; i++) place('shrine', 10, maxD, 14);
    for (let i = 0; i < 6; i++) place('chest', 8, maxD, 9);
    for (const po of map.pois) { if (po.type !== 'exit' && po.type !== 'dungeon' && po.type !== 'lair') continue; const path = pathFromPar(map, r.par, po.y * w + po.x); for (const t of path) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const x = t.x + dx, y = t.y + dy; if (inGrid(x, y) && (tiles[y * w + x] === GROUND || tiles[y * w + x] === TREE)) tiles[y * w + x] = PATH; } } }
    map.name = `${theme.name}`; map.title = zone === 1 ? theme.name : `${theme.name} ${['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][Math.floor((zone - 1) / D.ZONE_THEMES.length)] || ''}`.trim();
    map.rocks = []; for (let i = 0; i < 30; i++) { const x = ri(3, w - 4), y = ri(3, h - 4); if (tiles[y * w + x] === GROUND && !used.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < 3)) { tiles[y * w + x] = ROCK; map.rocks.push({ x, y }); } }
    r = bfs(map, start.x, start.y, (x, y) => walkable(map, x, y));
    for (const po of map.pois) if (r.dist[po.y * w + po.x] < 0) { return force ? map : null; }
    for (let i = 0; i < w * h; i++) if (!BLOCKED(tiles[i]) && r.dist[i] < 0) tiles[i] = ROCK;
    map.walkableCount = 0; for (let i = 0; i < w * h; i++) if (!BLOCKED(tiles[i])) map.walkableCount++;
    map.clutter = [];
    for (let tries = 0; tries < 1200 && map.clutter.length < 90; tries++) {
      const x = ri(3, w - 4), y = ri(3, h - 4); if (tiles[y * w + x] !== GROUND) continue;
      if (map.clutter.some((c) => Math.abs(c.x - x) + Math.abs(c.y - y) < 7)) continue;
      if (used.some((u) => Math.abs(u.x - x) + Math.abs(u.y - y) < 3)) continue;
      map.clutter.push({ x, y, k: ri(0, 1) });
    }
    map.bigTrees = {}; for (let i = 0; i < w * h; i++) if (tiles[i] === TREE && rnd() < 0.45) map.bigTrees[i] = 1;
    return map;
  }
  function zoneLevel(zone) { return 1 + (zone - 1) * 10; }
  function noiseField(seed, w, h, cell) { return noise2(mulberry32(seed), w, h, cell); }
  window.World = { generate, bfs, walkable, pathTo, nearestUnexplored, reveal, zoneLevel, noiseField, GROUND, PATH, WATER, ROCK, TREE, VOID, BLOCKED };
})();
