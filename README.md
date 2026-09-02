# GRIMDELVE

A mobile-first idle dungeon-crawler roguelite for the browser. You assemble a company of heroes and watch them delve ever deeper on their own: they fight, loot and descend automatically. After every cleared floor you decide — **extract** with what you carry, or **go deeper** for better loot. Die, and the bag is lost.

No build step. Open `index.html` from any static host (GitHub Pages works) — everything is vanilla HTML/CSS/JS and saves to `localStorage`.

## Features

- **Auto-crawling party** rendered on a canvas with painterly dungeon backdrops; touch-only UI, no direct character control.
- **Extract-or-descend loop**: floors of rooms, bosses every 5 floors, waystones every 10 floors so you can start deeper.
- **Six dungeon styles** that switch every 10 floors: Catacombs, Drowned Sewers, Fungal Deep, Frozen Halls, Infernal Forge, Abyss — then Nightmare cycles beyond floor 60.
- **8 hero classes** (5 starters, 3 unlocked by milestones), each with a trait and 5 skills learned by level.
- **Loot**: 7 gear slots, 6 rarities, affixes; sell, salvage, craft, upgrade and enchant at the Forge.
- **Village of Ashford**: Tavern, Blacksmith, Market, Shrine, Alchemist, Vault, Mine, Library and the Adventurers' Guild (automation: auto-descend, auto-extract on low health, auto-sell/salvage, auto-equip, offline delving).
- **Milestones** unlock new mechanics as you push deeper; **Relics** from bosses; **Ascension** prestige with permanent perks.
- **Offline progress** (Mine income; Guild 6 keeps the company delving while the game is closed).

## Art

All portraits and backdrops were generated with OpenArt (Nano Banana 2) in a gritty, painterly dark-fantasy style and converted to WebP with `tools/process_images.py`.

## Balance simulation

`node tools/sim.js 3` auto-plays the engine headlessly for three simulated hours and prints progression.
