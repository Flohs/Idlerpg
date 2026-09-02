/* GRIMDELVE — bootstrap & main loop */
(function () {
  'use strict';
  const D = window.DATA, G = window.Game, UI = window.UI, R = window.Render;

  R.preloadAll();

  R.start();
  R.bind();
  window.AudioFX.bind();
  const loaded = G.load();
  UI.bind();
  if (G.S) { window.AudioFX.setVolumes(G.S.settings.sfx, G.S.settings.music); window.AudioFX.music(G.S.run ? 'dungeon' : 'world'); }
  if (!loaded || !G.S.started) UI.intro();
  else {
    UI.setState(G.S);
    const rep = G.offlineProgress();
    G.checkMilestones();
    UI.markAll(); UI.renderAll();
    UI.offlineSheet(rep);
    G.save();
  }

  // main loop: fixed-step sim driven by rAF, speed-scaled
  let acc = 0, last = performance.now(), saveT = 0;
  function loop(now) {
    const dt = Math.min(1000, now - last); last = now;
    const S = G.S;
    if (S && S.started) {
      acc += dt * (S.settings.speed || 1);
      let n = 0;
      while (acc >= D.TICK_MS && n < 40) { G.tick(); acc -= D.TICK_MS; n++; }
      if (n >= 40) acc = 0;
      UI.tickUI(now);
      saveT += dt; if (saveT > 8000) { saveT = 0; G.save(); }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { G.save(); }
    else if (G.S && G.S.started) { const rep = G.offlineProgress(); if (rep) { UI.markAll(); UI.renderAll(); UI.offlineSheet(rep); } last = performance.now(); acc = 0; }
  });
  window.addEventListener('pagehide', () => G.save());
  window.addEventListener('beforeunload', () => G.save());
  // expose for debugging
  window.GD = { G, UI, R };
})();
