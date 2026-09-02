# GRIMDELVE

A mobile-first idle dungeon-crawler roguelite for the browser. You assemble a company of heroes and watch them delve ever deeper on their own: they fight, loot and descend automatically. After every cleared floor you decide — **extract** with what you carry, or **go deeper** for better loot. Die, and the bag is lost.

No build step. Open `index.html` from any static host (GitHub Pages works) — everything is vanilla HTML/CSS/JS and saves to `localStorage`.

## How it plays

You start with a **single hero** who has nothing but a basic attack; skills come only from the points you spend (one per level from level 2), and companions are hired at the Tavern. The hero leaves the village gate into a large **auto-generated open zone** (Diablo-style, 96×96 tiles with layered terrain, blended transitions and sparse set pieces): they chart the map on their own, break monster camps, loot chests, pray at shrines and hunt the zone's lair boss. Every zone hides one or more **dungeon entrances**; once found, tap **Descend** and the company walks back to the entrance (from wherever they are) and goes down. Slaying the lair boss opens the **road to the next zone**; tap **March** when you are ready, or let the Guild automate it. Zones cycle through four themes (Blighted Moors, Fungal Fens, Frozen Reach, Ashen Wastes) and get harder every time.

Below ground each floor is a chain of big doored rooms with side alcoves (chest rooms). Monsters wait behind the doors; heroes pick their foes and close in, ranged classes keep their distance, flying monsters hover and dive, and sky-borne spells rain down. After every floor: extract or go deeper.

Each class has a **Diablo II style skill tree**: three tiers, nine skills (actives and passives), prerequisites, 20 ranks and synergies. Heroes earn a point per level (and from quests); points are yours to place (an auto-spend toggle exists per hero), and you can respec for gold.

Hit points, damage and experience follow Diablo II's curves: a level-1 knight has 60 life and hits for a handful of points, monsters start with single-digit life, and every level costs about a quarter more than the last (with reduced experience from monsters far below your level). Loot follows Diablo II's rarity curve: nearly everything is plain white, an uncommon is rare, a rare is an event.

## Features

- **Auto-crawling party** in an isometric, procedurally generated dungeon: doored rooms joined by corridors, Diablo-style. The company walks the corridors in formation, doors swing open to reveal what waits inside, and attacks, projectiles and spells are drawn on the canvas. Touch-only UI, no direct character control.
- **Extract-or-descend loop**: floors of rooms, bosses every 5 floors, waystones every 10 floors so you can start deeper.
- **Six dungeon styles** that switch every 10 floors: Catacombs, Drowned Sewers, Fungal Deep, Frozen Halls, Infernal Forge, Abyss — then Nightmare cycles beyond floor 60.
- **8 hero classes** (5 starters, 3 unlocked by milestones), each with a trait and 5 skills learned by level.
- **Loot**: 7 gear slots, 6 rarities, affixes; sell, salvage, craft, upgrade and enchant at the Forge.
- **Village of Ashford**: Tavern, Blacksmith, Market, Shrine, Alchemist, Vault, Mine, Library and the Adventurers' Guild (automation: auto-descend, auto-extract on low health, auto-sell/salvage, auto-equip, offline delving).
- **Milestones** unlock new mechanics as you push deeper; **Relics** from bosses; **Ascension** prestige with permanent perks.
- **Offline progress** (Mine income; Guild 6 keeps the company delving while the game is closed).

## Art

All portraits, backdrops, sprites and tiles were generated with OpenArt (Nano Banana 2) in a gritty, painterly dark-fantasy style. `tools/process_images.py` converts portraits and backdrops to WebP; `tools/cutout.py` chroma-keys the green/magenta-screen sprites into transparent WebP and resizes the floor, wall and door tiles. Sprites are static; walking, lunges, projectiles and spell effects are done in `js/render.js`.

## Audio

The game plays sounds and music if the files exist; missing files are silently skipped. Put them here (mp3 or ogg, the game picks whichever the browser plays):

```
assets/audio/sfx/   hit, enemy_hit, crit, skill, heal, die, boss_die, hero_die, loot, chest,
                    levelup, door, milestone, quest, floorclear
assets/audio/music/ world, dungeon, boss
```

Volumes are in the settings gear.

## Balance simulation

`node tools/sim.js 3` auto-plays the engine headlessly for three simulated hours and prints progression.
