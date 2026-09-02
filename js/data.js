/* GRIMDELVE — static game data
 * Everything tunable lives here: classes, skills, biomes, enemies, items, buildings, milestones.
 */
(function () {
  'use strict';
  const D = {};

  // ---------- Hero classes ----------
  // base: stats at level 1; grow: added per level. role affects AI targeting.
  D.CLASSES = {
    knight: {
      id: 'knight', name: 'Knight', role: 'tank', img: 'hero_knight',
      tagline: 'Holds the line. Scarred, tired, unbroken.',
      base: { hp: 60, atk: 4, def: 6, spd: 8, crit: 4 },
      grow: { hp: 3.2, atk: 0.45, def: 0.55, spd: 0.08, crit: 0.05 },
      weapons: ['sword', 'axe', 'mace'],
      trait: { name: 'Bulwark', desc: 'Takes 20% less damage when below half health.' },
      skills: ['shield_bash', 'taunt', 'iron_will', 'cleave', 'last_stand'],
    },
    rogue: {
      id: 'rogue', name: 'Rogue', role: 'dps', img: 'hero_rogue',
      tagline: 'Gets there first. Gets out last.',
      base: { hp: 45, atk: 5, def: 3, spd: 12, crit: 12 },
      grow: { hp: 2.2, atk: 0.55, def: 0.3, spd: 0.14, crit: 0.2 },
      weapons: ['dagger', 'sword', 'bow'],
      trait: { name: 'Opportunist', desc: 'Critical hits deal +50% bonus damage.' },
      skills: ['backstab', 'poison_blade', 'shadowstep', 'fan_of_knives', 'execute'],
    },
    priest: {
      id: 'priest', name: 'War-Priest', role: 'support', img: 'hero_priest',
      tagline: 'Prays with a mace. The dead listen.',
      base: { hp: 50, atk: 3, def: 4, spd: 9, crit: 3 },
      grow: { hp: 2.5, atk: 0.4, def: 0.4, spd: 0.08, crit: 0.05 },
      weapons: ['mace', 'staff'],
      trait: { name: 'Litany', desc: 'Party regenerates 1% health per round.' },
      skills: ['mend', 'smite', 'ward', 'purge', 'resurrection'],
    },
    pyromancer: {
      id: 'pyromancer', name: 'Pyromancer', role: 'dps', img: 'hero_pyromancer',
      tagline: 'Burns everything. Including herself.',
      base: { hp: 40, atk: 6, def: 2, spd: 10, crit: 6 },
      grow: { hp: 1.9, atk: 0.65, def: 0.2, spd: 0.1, crit: 0.1 },
      weapons: ['staff', 'dagger'],
      trait: { name: 'Kindling', desc: 'Burning enemies take +25% damage from her.' },
      skills: ['fireball', 'immolate', 'flame_wall', 'ashen_veil', 'inferno'],
    },
    ranger: {
      id: 'ranger', name: 'Ranger', role: 'dps', img: 'hero_ranger',
      tagline: 'One eye. Never misses.',
      base: { hp: 48, atk: 5, def: 3, spd: 11, crit: 9 },
      grow: { hp: 2.3, atk: 0.55, def: 0.3, spd: 0.12, crit: 0.15 },
      weapons: ['bow', 'dagger'],
      trait: { name: 'Marked Prey', desc: 'Attacks the lowest-health enemy.' },
      skills: ['aimed_shot', 'volley', 'crippling_shot', 'hunters_mark', 'rain_of_iron'],
    },
    necromancer: {
      id: 'necromancer', name: 'Necromancer', role: 'support', img: 'hero_necromancer',
      tagline: 'Every corpse is a resource.',
      base: { hp: 42, atk: 5, def: 2, spd: 9, crit: 5 },
      grow: { hp: 2.0, atk: 0.55, def: 0.25, spd: 0.08, crit: 0.1 },
      weapons: ['staff', 'dagger'],
      trait: { name: 'Harvest', desc: 'Party heals 8% of damage dealt to enemies below half health.' },
      skills: ['soul_drain', 'bone_shield', 'curse', 'wither', 'raise_dead'],
      unlock: 'necromancer',
    },
    berserker: {
      id: 'berserker', name: 'Berserker', role: 'dps', img: 'hero_berserker',
      tagline: 'Pain is fuel.',
      base: { hp: 65, atk: 6, def: 3, spd: 10, crit: 7 },
      grow: { hp: 3.4, atk: 0.65, def: 0.3, spd: 0.1, crit: 0.12 },
      weapons: ['axe', 'sword', 'mace'],
      trait: { name: 'Frenzy', desc: 'Deals +1% damage per 1% missing health.' },
      skills: ['reckless_swing', 'bloodlust', 'whirlwind', 'war_cry', 'rampage'],
      unlock: 'berserker',
    },
    paladin: {
      id: 'paladin', name: 'Paladin', role: 'tank', img: 'hero_paladin',
      tagline: 'Faith is armor. Armor is faith.',
      base: { hp: 58, atk: 4, def: 5, spd: 8, crit: 4 },
      grow: { hp: 3.0, atk: 0.5, def: 0.5, spd: 0.08, crit: 0.06 },
      weapons: ['sword', 'mace'],
      trait: { name: 'Aegis', desc: 'Allies adjacent take 10% less damage.' },
      skills: ['holy_strike', 'consecrate', 'lay_on_hands', 'divine_shield', 'judgement'],
      unlock: 'paladin',
    },
  };
  D.STARTER_CLASSES = ['knight', 'rogue', 'priest', 'pyromancer', 'ranger'];

  // ---------- Skills ----------
  // cd: rounds. unlock: hero level. Effects resolved in game.js.
  // type: dmg | aoe | heal | healall | buff | debuff | shield | taunt | dot | dotall | revive | summon | selfbuff
  D.SKILLS = {
    // Knight
    shield_bash: { name: 'Shield Bash', type: 'dmg', mult: 1.3, cd: 3, unlock: 1, stun: 1, desc: 'Bash for {mult}% and stun 1 round.' },
    taunt: { name: 'Taunt', type: 'taunt', cd: 5, unlock: 5, dur: 3, desc: 'Force enemies to attack you for 3 rounds.' },
    iron_will: { name: 'Iron Will', type: 'shield', mult: 0.3, cd: 6, unlock: 10, desc: 'Shield self for {mult}% max health.' },
    cleave: { name: 'Cleave', type: 'aoe', mult: 0.9, cd: 4, unlock: 20, desc: 'Hit all enemies for {mult}%.' },
    last_stand: { name: 'Last Stand', type: 'healself', mult: 0.4, cd: 10, unlock: 30, desc: 'Heal self {mult}% max health and gain 30% defense for 3 rounds.', buff: { def: 0.3, dur: 3 } },
    // Rogue
    backstab: { name: 'Backstab', type: 'dmg', mult: 1.8, cd: 3, unlock: 1, critBonus: 30, desc: 'Strike for {mult}% with +30% crit chance.' },
    poison_blade: { name: 'Poison Blade', type: 'dot', mult: 0.5, cd: 4, unlock: 5, dur: 4, desc: 'Poison the target for {mult}% per round for 4 rounds.' },
    shadowstep: { name: 'Shadowstep', type: 'selfbuff', cd: 6, unlock: 10, buff: { evade: 0.5, dur: 2 }, desc: 'Evade 50% of attacks for 2 rounds.' },
    fan_of_knives: { name: 'Fan of Knives', type: 'aoe', mult: 0.7, cd: 4, unlock: 20, desc: 'Throw knives at all enemies for {mult}%.' },
    execute: { name: 'Execute', type: 'dmg', mult: 1.2, cd: 5, unlock: 30, execute: 0.3, desc: 'Strike for {mult}%; triple damage vs enemies below 30% health.' },
    // Priest
    mend: { name: 'Mend', type: 'heal', mult: 2.2, cd: 3, unlock: 1, desc: 'Heal the most wounded ally for {mult}% attack.' },
    smite: { name: 'Smite', type: 'dmg', mult: 1.5, cd: 3, unlock: 5, desc: 'Holy strike for {mult}%. Double vs undead.' , vs: 'undead' },
    ward: { name: 'Ward', type: 'shieldall', mult: 0.15, cd: 6, unlock: 10, desc: 'Shield all allies for {mult}% of their max health.' },
    purge: { name: 'Purge', type: 'cleanse', cd: 5, unlock: 20, desc: 'Remove all debuffs from the party and heal 5%.' },
    resurrection: { name: 'Resurrection', type: 'revive', mult: 0.4, cd: 14, unlock: 30, desc: 'Revive a fallen ally at {mult}% health.' },
    // Pyromancer
    fireball: { name: 'Fireball', type: 'dmg', mult: 2.0, cd: 3, unlock: 1, burn: 2, desc: 'Blast for {mult}% and burn for 2 rounds.' },
    immolate: { name: 'Immolate', type: 'dot', mult: 0.6, cd: 4, unlock: 5, dur: 3, desc: 'Set target ablaze for {mult}% per round for 3 rounds.' },
    flame_wall: { name: 'Flame Wall', type: 'aoe', mult: 0.8, cd: 4, unlock: 10, burn: 2, desc: 'Scorch all enemies for {mult}% and burn them.' },
    ashen_veil: { name: 'Ashen Veil', type: 'selfbuff', cd: 7, unlock: 20, buff: { atk: 0.4, dur: 3 }, desc: '+40% attack for 3 rounds.' },
    inferno: { name: 'Inferno', type: 'aoe', mult: 1.6, cd: 7, unlock: 30, burn: 3, desc: 'Immolate the room for {mult}% and burn 3 rounds.' },
    // Ranger
    aimed_shot: { name: 'Aimed Shot', type: 'dmg', mult: 1.7, cd: 3, unlock: 1, critBonus: 20, desc: 'Precise shot for {mult}%, +20% crit.' },
    volley: { name: 'Volley', type: 'aoe', mult: 0.7, cd: 4, unlock: 5, desc: 'Arrows on all enemies for {mult}%.' },
    crippling_shot: { name: 'Crippling Shot', type: 'debuff', mult: 1.0, cd: 4, unlock: 10, debuff: { spd: -0.4, dur: 3 }, desc: 'Hit for {mult}% and slow the target 40% for 3 rounds.' },
    hunters_mark: { name: "Hunter's Mark", type: 'debuff', mult: 0.5, cd: 6, unlock: 20, debuff: { vuln: 0.25, dur: 4 }, desc: 'Mark the target: +25% damage taken for 4 rounds.' },
    rain_of_iron: { name: 'Rain of Iron', type: 'aoe', mult: 1.4, cd: 7, unlock: 30, desc: 'Storm of arrows for {mult}% on all enemies.' },
    // Necromancer
    soul_drain: { name: 'Soul Drain', type: 'dmg', mult: 1.4, cd: 3, unlock: 1, lifesteal: 0.6, desc: 'Drain {mult}%; heal 60% of damage dealt.' },
    bone_shield: { name: 'Bone Shield', type: 'shieldall', mult: 0.1, cd: 5, unlock: 5, desc: 'Bone wards on all allies for {mult}% max health.' },
    curse: { name: 'Curse', type: 'debuffall', cd: 6, unlock: 10, debuff: { atk: -0.25, dur: 3 }, desc: 'All enemies deal 25% less damage for 3 rounds.' },
    wither: { name: 'Wither', type: 'dotall', mult: 0.4, cd: 5, unlock: 20, dur: 3, desc: 'Rot all enemies for {mult}% per round for 3 rounds.' },
    raise_dead: { name: 'Raise Dead', type: 'revive', mult: 0.3, cd: 12, unlock: 30, desc: 'Drag a fallen ally back at {mult}% health.' },
    // Berserker
    reckless_swing: { name: 'Reckless Swing', type: 'dmg', mult: 2.2, cd: 3, unlock: 1, selfdmg: 0.05, desc: 'Swing for {mult}%; costs 5% of your health.' },
    bloodlust: { name: 'Bloodlust', type: 'selfbuff', cd: 6, unlock: 5, buff: { atk: 0.3, lifesteal: 0.3, dur: 3 }, desc: '+30% attack and 30% lifesteal for 3 rounds.' },
    whirlwind: { name: 'Whirlwind', type: 'aoe', mult: 1.0, cd: 4, unlock: 10, desc: 'Spin through all enemies for {mult}%.' },
    war_cry: { name: 'War Cry', type: 'buffall', cd: 7, unlock: 20, buff: { atk: 0.2, dur: 3 }, desc: 'Party +20% attack for 3 rounds.' },
    rampage: { name: 'Rampage', type: 'dmg', mult: 3.5, cd: 7, unlock: 30, desc: 'Devastating blow for {mult}%.' },
    // Paladin
    holy_strike: { name: 'Holy Strike', type: 'dmg', mult: 1.4, cd: 3, unlock: 1, vs: 'undead', desc: 'Strike for {mult}%. Double vs undead.' },
    consecrate: { name: 'Consecrate', type: 'aoe', mult: 0.7, cd: 4, unlock: 5, healall: 0.05, desc: 'Burn all enemies for {mult}% and heal party 5%.' },
    lay_on_hands: { name: 'Lay on Hands', type: 'heal', mult: 3.0, cd: 6, unlock: 10, desc: 'Heal the most wounded ally for {mult}% attack.' },
    divine_shield: { name: 'Divine Shield', type: 'shield', mult: 0.5, cd: 8, unlock: 20, desc: 'Shield self for {mult}% max health.' },
    judgement: { name: 'Judgement', type: 'dmg', mult: 2.5, cd: 6, unlock: 30, stun: 1, desc: 'Judge for {mult}% and stun 1 round.' },
  };

  // ---------- Biomes (dungeon style switches every 10 floors) ----------
  D.BIOMES = [
    { id: 'catacombs', name: 'The Catacombs', bg: 'bg_catacombs', tint: '#3a2f25', accent: '#d98a3a', fog: 'rgba(20,16,12,0.55)',
      family: 'undead', enemies: ['skeleton', 'ghoul', 'grave_bat', 'plague_rat'], boss: 'bone_lord',
      material: 'bone_dust', flavor: 'Skull niches. Old torches. Something walks here.' },
    { id: 'sewers', name: 'The Drowned Sewers', bg: 'bg_sewers', tint: '#1f2b20', accent: '#6ecf6e', fog: 'rgba(10,20,12,0.55)',
      family: 'vermin', enemies: ['sewer_rat_swarm', 'plague_cultist', 'slime', 'drowned'], boss: 'rat_king',
      material: 'bile_gland', flavor: 'The water is not water.' },
    { id: 'caverns', name: 'The Fungal Deep', bg: 'bg_caverns', tint: '#14282c', accent: '#5fd6cf', fog: 'rgba(8,24,28,0.55)',
      family: 'beast', enemies: ['spore_crawler', 'cave_spider', 'myconid', 'blind_troll'], boss: 'mother_spore',
      material: 'glowcap', flavor: 'Spores in the lungs. Light with no fire.' },
    { id: 'frozen', name: 'The Frozen Halls', bg: 'bg_frozen', tint: '#1c2634', accent: '#9fc9ff', fog: 'rgba(14,20,30,0.55)',
      family: 'undead', enemies: ['frost_wight', 'ice_golem', 'frozen_dwarf', 'wendigo'], boss: 'frost_king',
      material: 'hoarfrost', flavor: 'The dwarves are still here. In the walls.' },
    { id: 'forge', name: 'The Infernal Forge', bg: 'bg_forge', tint: '#2e1410', accent: '#ff6a2a', fog: 'rgba(30,10,6,0.55)',
      family: 'demon', enemies: ['imp', 'forge_golem', 'hellhound', 'chained_devil'], boss: 'forge_master',
      material: 'hellsteel', flavor: 'The anvils still ring. No one is striking them.' },
    { id: 'abyss', name: 'The Abyss', bg: 'bg_abyss', tint: '#160f24', accent: '#b57cff', fog: 'rgba(12,6,24,0.55)',
      family: 'eldritch', enemies: ['void_spawn', 'watcher', 'faceless', 'starved_god'], boss: 'the_unmaker',
      material: 'void_shard', flavor: 'There is no bottom. There is only further.' },
  ];
  D.FLOORS_PER_BIOME = 10;
  D.BOSS_EVERY = 5;

  // ---------- Enemies ----------
  // stats are multipliers on the floor's base curve. img: portrait key (falls back to a glyph).
  D.ENEMIES = {
    skeleton:     { name: 'Skeletal Warrior', img: 'en_skeleton', hp: 1.0, atk: 1.0, def: 1.1, spd: 0.9, family: 'undead' },
    ghoul:        { name: 'Ghoul', img: 'en_ghoul', hp: 1.2, atk: 1.1, def: 0.7, spd: 1.1, family: 'undead', lifesteal: 0.3 },
    grave_bat:    { name: 'Grave Bat', img: 'en_grave_bat', hp: 0.5, atk: 0.8, def: 0.4, spd: 1.6, family: 'beast', evade: 0.2 },
    plague_rat:   { name: 'Plague Rat', img: 'en_plague_rat', hp: 0.6, atk: 0.9, def: 0.5, spd: 1.4, family: 'vermin', poison: 0.3 },
    bone_lord:    { name: 'The Bone Lord', img: 'en_bone_lord', hp: 4.5, atk: 1.6, def: 1.4, spd: 0.9, family: 'undead', boss: true, aoe: true },
    sewer_rat_swarm: { name: 'Rat Swarm', img: 'en_rat_swarm', hp: 0.8, atk: 1.0, def: 0.3, spd: 1.5, family: 'vermin', poison: 0.3 },
    plague_cultist: { name: 'Plague Cultist', img: 'en_cultist', hp: 0.9, atk: 1.3, def: 0.6, spd: 1.0, family: 'human', heals: true },
    slime:        { name: 'Bile Slime', img: 'en_slime', hp: 1.6, atk: 0.8, def: 0.9, spd: 0.6, family: 'ooze', poison: 0.5 },
    drowned:      { name: 'The Drowned', img: 'en_drowned', hp: 1.3, atk: 1.2, def: 1.0, spd: 0.8, family: 'undead' },
    rat_king:     { name: 'The Rat King', img: 'en_rat_king', hp: 5.5, atk: 1.7, def: 1.1, spd: 1.2, family: 'vermin', boss: true, poison: 0.6, summons: 'sewer_rat_swarm' },
    spore_crawler:{ name: 'Spore Crawler', img: 'en_spore_crawler', hp: 1.0, atk: 1.0, def: 0.8, spd: 1.2, family: 'beast', poison: 0.4 },
    cave_spider:  { name: 'Cave Spider', img: 'en_cave_spider', hp: 0.9, atk: 1.3, def: 0.6, spd: 1.4, family: 'beast', poison: 0.5 },
    myconid:      { name: 'Myconid', img: 'en_myconid', hp: 1.5, atk: 0.9, def: 1.2, spd: 0.7, family: 'plant', heals: true },
    blind_troll:  { name: 'Blind Troll', img: 'en_blind_troll', hp: 2.4, atk: 1.5, def: 1.0, spd: 0.6, family: 'beast', regen: 0.05 },
    mother_spore: { name: 'Mother Spore', img: 'en_mother_spore', hp: 7.0, atk: 1.5, def: 1.5, spd: 0.7, family: 'plant', boss: true, poison: 0.8, aoe: true },
    frost_wight:  { name: 'Frost Wight', img: 'en_frost_wight', hp: 1.1, atk: 1.2, def: 1.0, spd: 1.0, family: 'undead', slow: 0.3 },
    ice_golem:    { name: 'Ice Golem', img: 'en_ice_golem', hp: 2.2, atk: 1.2, def: 1.8, spd: 0.5, family: 'construct' },
    frozen_dwarf: { name: 'Frozen Dwarf', img: 'en_frozen_dwarf', hp: 1.3, atk: 1.4, def: 1.3, spd: 0.8, family: 'undead' },
    wendigo:      { name: 'Wendigo', img: 'en_wendigo', hp: 1.4, atk: 1.7, def: 0.7, spd: 1.4, family: 'beast', lifesteal: 0.4 },
    frost_king:   { name: 'The Frost King', img: 'en_frost_king', hp: 7.5, atk: 1.8, def: 1.6, spd: 0.9, family: 'undead', boss: true, slow: 0.5, aoe: true },
    imp:          { name: 'Imp', img: 'en_imp', hp: 0.7, atk: 1.2, def: 0.6, spd: 1.6, family: 'demon', burn: 0.3 },
    forge_golem:  { name: 'Forge Golem', img: 'en_forge_golem', hp: 2.6, atk: 1.4, def: 2.0, spd: 0.5, family: 'construct' },
    hellhound:    { name: 'Hellhound', img: 'en_hellhound', hp: 1.2, atk: 1.6, def: 0.8, spd: 1.5, family: 'demon', burn: 0.4 },
    chained_devil:{ name: 'Chained Devil', img: 'en_chained_devil', hp: 1.8, atk: 1.8, def: 1.2, spd: 0.9, family: 'demon', aoe: true },
    forge_master: { name: 'The Forge Master', img: 'en_forge_master', hp: 8.0, atk: 2.0, def: 1.8, spd: 0.8, family: 'demon', boss: true, burn: 0.8, aoe: true },
    void_spawn:   { name: 'Void Spawn', img: 'en_void_spawn', hp: 1.1, atk: 1.4, def: 0.9, spd: 1.3, family: 'eldritch', evade: 0.15 },
    watcher:      { name: 'Watcher', img: 'en_watcher', hp: 1.6, atk: 1.7, def: 1.1, spd: 0.9, family: 'eldritch', vuln: true },
    faceless:     { name: 'The Faceless', img: 'en_faceless', hp: 1.4, atk: 1.9, def: 1.0, spd: 1.2, family: 'eldritch', lifesteal: 0.3 },
    starved_god:  { name: 'Starved God', img: 'en_starved_god', hp: 3.0, atk: 2.2, def: 1.4, spd: 0.7, family: 'eldritch', aoe: true },
    the_unmaker:  { name: 'The Unmaker', img: 'en_the_unmaker', hp: 9.0, atk: 2.4, def: 2.0, spd: 1.0, family: 'eldritch', boss: true, aoe: true, vuln: true },
  };

  // ---------- Items ----------
  D.SLOTS = ['weapon', 'head', 'chest', 'hands', 'feet', 'ring', 'amulet'];
  D.SLOT_NAMES = { weapon: 'Weapon', head: 'Helm', chest: 'Armor', hands: 'Gloves', feet: 'Boots', ring: 'Ring', amulet: 'Amulet' };
  D.SLOT_ICON = { weapon: 'item_weapon', head: 'item_head', chest: 'item_chest', hands: 'item_hands', feet: 'item_feet', ring: 'item_ring', amulet: 'item_amulet' };
  D.RARITIES = [
    { id: 'common', name: 'Common', color: '#9a9a9a', mult: 1.0, affixes: 0, weight: 100, sell: 1 },
    { id: 'uncommon', name: 'Uncommon', color: '#6fbf5a', mult: 1.25, affixes: 1, weight: 7, sell: 2.5 },
    { id: 'rare', name: 'Rare', color: '#4d8fe0', mult: 1.55, affixes: 2, weight: 1.2, sell: 6 },
    { id: 'epic', name: 'Epic', color: '#b264e6', mult: 1.95, affixes: 3, weight: 0.25, sell: 15 },
    { id: 'legendary', name: 'Legendary', color: '#e8973a', mult: 2.5, affixes: 4, weight: 0.05, sell: 40 },
    { id: 'mythic', name: 'Mythic', color: '#e0403a', mult: 3.3, affixes: 5, weight: 0.008, sell: 120 },
  ];
  // base stat by slot (scaled by item level)
  D.SLOT_BASE = {
    weapon: { atk: 3 }, head: { def: 1, hp: 4 }, chest: { def: 2, hp: 8 }, hands: { atk: 0.8, def: 0.5 },
    feet: { def: 0.6, spd: 0.8 }, ring: { crit: 2, atk: 0.6 }, amulet: { hp: 6, atk: 0.6 },
  };
  D.WEAPON_TYPES = {
    sword: { name: 'Sword', atk: 1.0, crit: 4 }, axe: { name: 'Axe', atk: 1.15, crit: 0 }, mace: { name: 'Mace', atk: 1.05, def: 1.5 },
    dagger: { name: 'Dagger', atk: 0.85, crit: 10, spd: 1.5 }, bow: { name: 'Bow', atk: 0.95, crit: 6, spd: 0.8 }, staff: { name: 'Staff', atk: 1.1, hp: 10 },
  };
  D.AFFIXES = [
    { id: 'atk', name: 'of Wrath', stat: 'atk', per: 0.35, flat: 1 },
    { id: 'hp', name: 'of the Ox', stat: 'hp', per: 1.5, flat: 5 },
    { id: 'def', name: 'of Stone', stat: 'def', per: 0.3, flat: 1 },
    { id: 'spd', name: 'of Haste', stat: 'spd', per: 0.12, flat: 0.5 },
    { id: 'crit', name: 'of Malice', stat: 'crit', per: 0.25, flat: 1 },
    { id: 'lifesteal', name: 'of the Leech', stat: 'lifesteal', per: 0.15, flat: 3, pct: true, max: 25 },
    { id: 'gold', name: 'of Greed', stat: 'gold', per: 0.5, flat: 4, pct: true, max: 60 },
    { id: 'xp', name: 'of Insight', stat: 'xp', per: 0.4, flat: 3, pct: true, max: 50 },
    { id: 'loot', name: 'of Fortune', stat: 'loot', per: 0.3, flat: 2, pct: true, max: 40 },
    { id: 'thorns', name: 'of Thorns', stat: 'thorns', per: 0.3, flat: 3, pct: true, max: 40 },
  ];
  D.ITEM_PREFIX = {
    common: ['Rusted', 'Worn', 'Cracked', 'Plain', 'Dented'],
    uncommon: ['Sturdy', 'Oiled', 'Tempered', 'Marked'],
    rare: ['Bloodforged', 'Grave-etched', 'Silvered', 'Runed'],
    epic: ['Abyssal', 'Hellwrought', 'Frost-bound', 'Sanctified'],
    legendary: ['Kingsbane', 'Unmaker\'s', 'Sunless', 'Widow\'s'],
    mythic: ['Godflesh', 'Voidborn', 'Eternal', 'First'],
  };
  D.ITEM_NOUN = {
    weapon: null, head: ['Helm', 'Hood', 'Skullcap', 'Visor', 'Crown'], chest: ['Cuirass', 'Hauberk', 'Coat', 'Plate', 'Vestment'],
    hands: ['Gauntlets', 'Gloves', 'Grips', 'Claws'], feet: ['Greaves', 'Boots', 'Treads', 'Sabatons'],
    ring: ['Ring', 'Band', 'Loop', 'Signet'], amulet: ['Amulet', 'Pendant', 'Talisman', 'Idol'],
  };

  D.MATERIALS = {
    scrap: { name: 'Scrap Iron', color: '#a8a8a8', desc: 'Salvaged metal. Used for upgrades and crafting.' },
    leather: { name: 'Cured Hide', color: '#a5763f', desc: 'Salvaged from armor. Used for crafting.' },
    essence: { name: 'Dark Essence', color: '#b264e6', desc: 'Salvaged from rare gear. Used for enchanting and rerolls.' },
    bone_dust: { name: 'Bone Dust', color: '#d8d0b8', desc: 'Catacombs material. Crafting bonus rarity.' },
    bile_gland: { name: 'Bile Gland', color: '#8fd66f', desc: 'Sewers material. Crafting bonus rarity.' },
    glowcap: { name: 'Glowcap', color: '#6fe3da', desc: 'Fungal Deep material. Crafting bonus rarity.' },
    hoarfrost: { name: 'Hoarfrost Shard', color: '#a9d1ff', desc: 'Frozen Halls material. Crafting bonus rarity.' },
    hellsteel: { name: 'Hellsteel', color: '#ff7a3a', desc: 'Infernal Forge material. Crafting bonus rarity.' },
    void_shard: { name: 'Void Shard', color: '#c08bff', desc: 'Abyss material. Crafting bonus rarity.' },
    ember: { name: 'Ember of Ascension', color: '#ffb347', desc: 'Earned by ascending. Spent on permanent power.' },
  };

  // ---------- Village buildings ----------
  // cost(level) = base * growth^level gold (+ materials at higher levels)
  D.BUILDINGS = {
    tavern: { name: 'Tavern', icon: '🍺', base: 60, growth: 2.1, max: 8,
      desc: 'Recruit heroes. Bigger roster, bigger party.',
      effect: (l) => `Roster ${3 + l * 2} · Party ${l >= 6 ? 5 : l >= 3 ? 4 : 3}` },
    blacksmith: { name: 'Blacksmith', icon: '⚒', base: 80, growth: 2.0, max: 10, unlock: 'blacksmith',
      desc: 'Craft and upgrade gear.',
      effect: (l) => `Craft ilvl +${l * 3} · Upgrade cap +${l * 2}` },
    market: { name: 'Market', icon: '⚖', base: 50, growth: 1.9, max: 10, unlock: 'blacksmith',
      desc: 'Better prices for loot.',
      effect: (l) => `Sell price +${l * 12}%` },
    shrine: { name: 'Shrine', icon: '✝', base: 100, growth: 2.0, max: 10,
      desc: 'Rest between floors. Keep loot on death. Level 4: the fallen rise again at each floor exit.',
      effect: (l) => `Rest heal ${20 + l * 4}% · Death salvage ${l * 8}%${l >= 4 ? ' · Fallen rise at exits' : ''}` },
    alchemist: { name: 'Alchemist', icon: '⚗', base: 120, growth: 2.0, max: 8, unlock: 'alchemist',
      desc: 'Potions are brewed and used automatically.',
      effect: (l) => `${l} potion${l === 1 ? '' : 's'} per run · Heal ${30 + l * 5}%` },
    vault: { name: 'Vault', icon: '🗝', base: 70, growth: 2.2, max: 8,
      desc: 'More room in the stash.',
      effect: (l) => `Stash ${30 + l * 15} slots` },
    mine: { name: 'Mine', icon: '⛏', base: 200, growth: 2.0, max: 10, unlock: 'mine',
      desc: 'Digs up scrap and gold while you are away.',
      effect: (l) => `${l * 6} scrap & ${l * 25} gold per hour` },
    library: { name: 'Library', icon: '📜', base: 250, growth: 2.1, max: 10, unlock: 'library',
      desc: 'Heroes learn faster and hit harder with skills.',
      effect: (l) => `XP +${l * 10}% · Skill power +${l * 5}%` },
    guild: { name: 'Adventurers\' Guild', icon: '🛡', base: 300, growth: 2.2, max: 6, unlock: 'guild',
      desc: 'Automation. Let them delve while you sleep.',
      effect: (l) => ['Auto-descend', 'Auto-extract on low HP', 'Auto-sell', 'Auto-salvage', 'Auto-equip', 'Auto-restart & offline delving'].slice(0, l).join(' · ') || 'Nothing yet' },
  };

  // ---------- Milestones (unlock new mechanics as the player pushes deeper) ----------
  // cond: {floor:n} max floor reached, {level:n} any hero level, {ascend:n}
  D.MILESTONES = [
    { id: 'blacksmith', name: 'Cold Iron', cond: { floor: 1 }, unlocks: 'Blacksmith & Market: sell, salvage and upgrade gear.', tab: 'forge' },
    { id: 'craft', name: 'Sparks in the Dark', cond: { floor: 2 }, unlocks: 'Crafting: forge new gear from materials.', tab: 'forge' },
    { id: 'alchemist', name: 'Bitter Draughts', cond: { floor: 12 }, unlocks: 'Alchemist: automatic potions.', tab: 'village' },
    { id: 'waystone', name: 'The First Waystone', cond: { floor: 10 }, unlocks: 'Waystones: start runs at floor 11. New dungeon: the Drowned Sewers.', tab: 'dungeon' },
    { id: 'necromancer', name: 'A Voice from the Grave', cond: { floor: 12 }, unlocks: 'Necromancer can be recruited at the Tavern.', tab: 'heroes' },
    { id: 'guild', name: 'Names on the Wall', cond: { floor: 13 }, unlocks: 'Adventurers\' Guild: automation.', tab: 'village' },
    { id: 'enchant', name: 'Whispering Steel', cond: { floor: 21 }, unlocks: 'Enchanting: reroll affixes with Dark Essence. Party size 4 (Tavern 3). The Fungal Deep opens.', tab: 'forge' },
    { id: 'berserker', name: 'Red Snow', cond: { floor: 32 }, unlocks: 'Berserker can be recruited at the Tavern.', tab: 'heroes' },
    { id: 'mine', name: 'Deeper Veins', cond: { floor: 33 }, unlocks: 'Mine: passive scrap and gold, even offline.', tab: 'village' },
    { id: 'library', name: 'Forbidden Pages', cond: { floor: 34 }, unlocks: 'Library: XP and skill power. The Frozen Halls open.', tab: 'village' },
    { id: 'relics', name: 'What the Bosses Carry', cond: { floor: 42 }, unlocks: 'Relics: bosses drop permanent run modifiers.', tab: 'heroes' },
    { id: 'paladin', name: 'A Cracked Sun', cond: { floor: 43 }, unlocks: 'Paladin can be recruited. The Infernal Forge opens. Party size 5 (Tavern 6).', tab: 'heroes' },
    { id: 'abyss', name: 'No Bottom', cond: { floor: 52 }, unlocks: 'The Abyss opens. Mythic gear can drop.', tab: 'dungeon' },
    { id: 'ascension', name: 'Ascension', cond: { floor: 62 }, unlocks: 'Ascend: reset the dungeon for Embers and permanent power. Nightmare depths beyond 60.', tab: 'village' },
    { id: 'nightmare', name: 'The Second Descent', cond: { floor: 72 }, unlocks: 'Nightmare biomes: every dungeon returns, twisted and richer.', tab: 'dungeon' },
    { id: 'endless', name: 'Ever Deeper', cond: { floor: 100 }, unlocks: 'Floor 100. Loot scaling doubles. There is no end.', tab: 'dungeon' },
  ];

  // ---------- Relics (permanent run modifiers from bosses, floor 35+) ----------
  D.RELICS = [
    { id: 'skull_chalice', name: 'Skull Chalice', desc: '+10% lifesteal for the party.', stat: 'lifesteal', val: 10 },
    { id: 'gilded_tooth', name: 'Gilded Tooth', desc: '+25% gold found.', stat: 'gold', val: 25 },
    { id: 'thief_lantern', name: 'Thief\'s Lantern', desc: '+20% item drop chance.', stat: 'loot', val: 20 },
    { id: 'martyr_nail', name: 'Martyr\'s Nail', desc: '+15% attack for the party.', stat: 'atkpct', val: 15 },
    { id: 'iron_heart', name: 'Iron Heart', desc: '+20% max health for the party.', stat: 'hppct', val: 20 },
    { id: 'hourglass', name: 'Cracked Hourglass', desc: '+15% speed for the party.', stat: 'spdpct', val: 15 },
    { id: 'black_tome', name: 'Black Tome', desc: '+30% experience.', stat: 'xp', val: 30 },
    { id: 'wolf_eye', name: 'Wolf Eye', desc: '+10% critical chance.', stat: 'crit', val: 10 },
  ];

  // ---------- Ascension perks (spend Embers) ----------
  D.ASCENSION_PERKS = [
    { id: 'legacy_power', name: 'Legacy of Steel', desc: '+5% attack per rank', max: 20, cost: (r) => 1 + r, stat: 'atkpct', val: 5 },
    { id: 'legacy_flesh', name: 'Legacy of Flesh', desc: '+5% health per rank', max: 20, cost: (r) => 1 + r, stat: 'hppct', val: 5 },
    { id: 'legacy_greed', name: 'Legacy of Greed', desc: '+10% gold per rank', max: 10, cost: (r) => 1 + r, stat: 'gold', val: 10 },
    { id: 'legacy_luck', name: 'Legacy of Luck', desc: '+8% loot chance per rank', max: 10, cost: (r) => 2 + r, stat: 'loot', val: 8 },
    { id: 'legacy_mind', name: 'Legacy of Mind', desc: '+10% XP per rank', max: 10, cost: (r) => 1 + r, stat: 'xp', val: 10 },
    { id: 'legacy_depth', name: 'Legacy of Depth', desc: 'Start runs 5 floors deeper per rank', max: 6, cost: (r) => 3 + r * 2, stat: 'startfloor', val: 5 },
  ];

  D.ROOMS_PER_FLOOR = 3;      // main rooms per floor (+1 boss room on boss floors); alcoves add more
  D.TICK_MS = 100;            // sim tick
  D.ROUND_TICKS = 10;         // one combat round per second at 1x

  window.DATA = D;
})();
