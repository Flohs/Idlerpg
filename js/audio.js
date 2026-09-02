/* GRIMDELVE — audio hooks. Drop files into assets/audio/sfx/<name>.(mp3|ogg) and assets/audio/music/<track>.(mp3|ogg).
 * Everything is optional: missing files are silently skipped. Expected names are listed in README.md.
 */
(function () {
  'use strict';
  const SFX = {}; const missing = {};
  let unlocked = false, musicEl = null, musicTrack = null, musicVol = 0.5, sfxVol = 0.8, lastPlay = {};
  const ext = (() => { try { const a = document.createElement('audio'); if (a.canPlayType('audio/mpeg')) return 'mp3'; if (a.canPlayType('audio/ogg')) return 'ogg'; } catch (e) { /* */ } return 'mp3'; })();
  function unlock() { unlocked = true; if (musicTrack) music(musicTrack, true); }
  ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { once: true, passive: true }));
  function play(name, opts) {
    opts = opts || {};
    if (!unlocked || sfxVol <= 0 || missing[name]) return;
    const now = performance.now(); if (lastPlay[name] && now - lastPlay[name] < (opts.minGap || 60)) return; lastPlay[name] = now;
    let pool = SFX[name];
    if (!pool) { pool = SFX[name] = []; }
    let el = pool.find((a) => a.paused || a.ended);
    if (!el) { if (pool.length >= 4) return; el = new Audio('assets/audio/sfx/' + name + '.' + ext); el.addEventListener('error', () => { missing[name] = true; }); pool.push(el); }
    el.volume = Math.min(1, sfxVol * (opts.vol || 1)); el.playbackRate = opts.rate || (0.95 + Math.random() * 0.1);
    try { el.currentTime = 0; const p = el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* */ }
  }
  function music(track, force) {
    if (track === musicTrack && !force) return;
    musicTrack = track;
    if (!unlocked) return;
    if (musicEl) { const old = musicEl; const fade = setInterval(() => { old.volume = Math.max(0, old.volume - 0.05); if (old.volume <= 0.01) { clearInterval(fade); old.pause(); } }, 60); musicEl = null; }
    if (!track || musicVol <= 0) return;
    const el = new Audio('assets/audio/music/' + track + '.' + ext); el.loop = true; el.volume = 0;
    el.addEventListener('error', () => { if (musicEl === el) musicEl = null; });
    musicEl = el;
    const p = el.play(); if (p && p.catch) p.catch(() => {});
    const up = setInterval(() => { if (musicEl !== el) { clearInterval(up); return; } el.volume = Math.min(musicVol, el.volume + 0.04); if (el.volume >= musicVol - 0.01) clearInterval(up); }, 80);
  }
  function setVolumes(sfx, mus) { sfxVol = sfx; musicVol = mus; if (musicEl) musicEl.volume = musicVol; if (musicVol <= 0 && musicEl) { musicEl.pause(); musicEl = null; } else if (musicVol > 0 && !musicEl && musicTrack) music(musicTrack, true); }
  // engine bindings
  function bind() {
    const G = window.Game;
    G.on('attack', (a) => play(a.id.startsWith('h') ? 'hit' : 'enemy_hit'));
    G.on('skill', (s) => play('skill'));
    G.on('float', (f) => { if (f.kind === 'crit') play('crit'); else if (f.kind === 'heal') play('heal', { minGap: 400 }); });
    G.on('kill', (k) => play(k.boss ? 'boss_die' : 'die'));
    G.on('death', () => play('hero_die'));
    G.on('loot', () => play('loot', { minGap: 300 }));
    G.on('chest', () => play('chest'));
    G.on('levelup', () => play('levelup', { minGap: 500 }));
    G.on('door', () => play('door'));
    G.on('milestone', () => play('milestone'));
    G.on('quest', () => play('quest'));
    G.on('floorclear', () => play('floorclear'));
    G.on('encounter', (e) => { if (e.boss) music('boss'); });
    G.on('encounterend', () => music('world'));
    G.on('runstart', () => music('dungeon'));
    G.on('runend', () => music('world'));
    G.on('zone', () => music('world'));
    G.on('worldwipe', () => play('hero_die'));
    G.on('newgame', () => music('world'));
  }
  window.AudioFX = { play, music, setVolumes, bind };
})();
