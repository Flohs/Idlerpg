/* Late-game flow checks: ascension, perks, nightmare cycle, relics, revive, offline sim. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const store = {};
const ctx = { console, localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } }, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'), Date, Math, JSON };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['data.js', 'skills.js', 'dungeon.js', 'world.js', 'game.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
const G = ctx.Game; const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok:', m); };
G.newGame(['knight']); for (const h of G.S.heroes) { h.autoSkills = true; }
const S = G.S;
S.maxFloor = 62; G.checkMilestones();
assert(S.unlocked.ascension && S.unlocked.abyss && S.unlocked.paladin, 'milestones unlock through floor 60');
assert(G.waystones().join(',') === '1,11,21,31,41,51,61', 'waystones ' + G.waystones().join(','));
assert(G.biomeFor(61).biome.id === 'catacombs' && G.biomeFor(61).cycle === 1, 'floor 61 is nightmare catacombs');
assert(G.biomeFor(55).biome.id === 'abyss', 'floor 55 is abyss');
// gear + relic + stash
for (let i = 0; i < 5; i++) S.stash.push(G.genItem(50, { luck: 100 }));
S.relics.push('iron_heart'); S.gold = 5000;
const hpBefore = G.heroStats(S.heroes[0]).hp;
S.relics = []; assert(G.heroStats(S.heroes[0]).hp < hpBefore, 'relic raises hp');
S.relics.push('iron_heart');
assert(G.canAscend(), 'can ascend');
const reward = G.ascensionReward();
assert(!G.ascend(), 'ascend ok'); assert(S.embers === reward && S.ascensions === 1 && S.maxFloor === 0 && S.stash.length === 0 && S.relics.length === 0, 'ascension reset state');
assert(!G.buyPerk('legacy_power'), 'buy perk'); assert(S.perks.legacy_power === 1, 'perk rank 1');
assert(G.difficultyMult() === 1.3, 'difficulty 1.3 after ascension');
assert(G.waystones().join(',') === '1', 'waystones reset');
// depth perk shifts start floor
S.embers += 10; G.buyPerk('legacy_depth'); assert(!G.startRun(1), 'start run'); assert(S.run.floor === 6, 'legacy_depth starts at floor 6, got ' + S.run.floor);
G.abandonRun();
// shrine revive at exit
S.perks = {}; S.buildings.shrine = 4; S.buildings.guild = 0; S.gold += 100000; if (S.heroes.length < 2) G.recruit('priest'); for (const h of S.heroes) h.level = 10; G.startRun(1);
S.run.party[1].alive = false; S.run.party[1].hp = 0;
let guard = 0; while (S.run && S.run.phase !== 'floorclear' && guard++ < 50000) G.tick();
assert(S.run && S.run.party[1].alive, 'fallen hero revived at floor exit');
// offline delving
S.buildings.guild = 6; S.settings.autoDescend = true; S.settings.autoExtractHp = 0.3; S.settings.stopAtFloor = 4;
for (const h of S.heroes) h.level = 30;
if (S.run) G.abandonRun();
S.lastSeen = Date.now() - 3600 * 1000; S.buildings.mine = 2;
const rep = G.offlineProgress();
assert(rep && rep.mineGold === 50 && rep.mineScrap === 12, 'mine offline yield ' + JSON.stringify(rep && { g: rep.mineGold, s: rep.mineScrap }));
assert(rep && rep.floors > 0 && rep.ended.length > 0, 'offline delving auto-restarts and progresses: ' + JSON.stringify(rep && { floors: rep.floors, runs: rep.ended.length, types: rep.ended.map((e) => e.type + e.floor).slice(0, 5) }));
// save/load roundtrip
G.save(); const ok = G.load(); assert(ok && G.S.ascensions === 1, 'save/load roundtrip');
const exp = G.exportSave(); assert(!G.importSave(exp), 'export/import');
console.log('done');
