/* GRIMDELVE — skill trees (Diablo II style): three tiers per class, prerequisites, 20 ranks, synergies, passives. */
(function () {
  'use strict';
  const D = window.DATA;
  const S = D.SKILLS;
  D.MAX_RANK = 20;
  D.TIER_LEVEL = [1, 6, 15];

  // ---- new active skills ----
  Object.assign(S, {
    shield_wall: { name: 'Shield Wall', type: 'shieldall', mult: 0.12, cd: 8, desc: 'Ward all allies for {mult}% of their max health.' },
    smoke_bomb: { name: 'Smoke Bomb', type: 'buffall', cd: 8, buff: { evade: 0.35, dur: 2 }, desc: 'The party evades 35% of attacks for 2 rounds.' },
    holy_nova: { name: 'Holy Nova', type: 'aoe', mult: 0.9, cd: 6, healall: 0.08, sky: true, desc: 'Light bursts from above for {mult}% on all enemies and heals the party 8%.' },
    meteor: { name: 'Meteor', type: 'dmg', mult: 3.2, cd: 7, burn: 2, sky: true, splash: 0.5, desc: 'Call a meteor for {mult}%; nearby enemies take half and burn.' },
    multishot: { name: 'Multishot', type: 'aoe', mult: 1.0, cd: 5, desc: 'A fan of arrows for {mult}% on all enemies.' },
    death_nova: { name: 'Death Nova', type: 'aoe', mult: 1.2, cd: 6, lifesteal: 0.3, desc: 'Necrotic blast for {mult}% on all enemies; heals 30% of damage dealt.' },
    earthquake: { name: 'Earthquake', type: 'aoe', mult: 1.3, cd: 7, stun: 1, desc: 'Shatter the ground for {mult}% and stun all enemies 1 round.' },
    blessing: { name: 'Blessing', type: 'buffall', cd: 8, buff: { atk: 0.25, dur: 3 }, desc: 'Party +25% attack for 3 rounds.' },
    // ---- passives ----
    toughness: { name: 'Toughness', type: 'passive', stat: 'hppct', per: 2, desc: '+{per}% max health per rank.' },
    armor_mastery: { name: 'Armor Mastery', type: 'passive', stat: 'defpct', per: 3, desc: '+{per}% defense per rank.' },
    retribution: { name: 'Retribution', type: 'passive', stat: 'thorns', per: 2, desc: 'Attackers take {per}% of damage dealt per rank.' },
    evasion: { name: 'Evasion', type: 'passive', stat: 'evade', per: 1, desc: '+{per}% chance to evade attacks per rank.' },
    deadly_precision: { name: 'Deadly Precision', type: 'passive', stat: 'crit', per: 1, desc: '+{per}% critical chance per rank.' },
    lethality: { name: 'Lethality', type: 'passive', stat: 'critdmg', per: 5, desc: '+{per}% critical damage per rank.' },
    devotion: { name: 'Devotion', type: 'passive', stat: 'healpow', per: 5, desc: '+{per}% healing power per rank.' },
    fortitude: { name: 'Fortitude', type: 'passive', stat: 'party_hppct', per: 1, desc: 'Whole party +{per}% max health per rank.' },
    martyr: { name: 'Martyr', type: 'passive', stat: 'defpct', per: 3, desc: '+{per}% defense per rank.' },
    warmth: { name: 'Warmth', type: 'passive', stat: 'atkpct', per: 2, desc: '+{per}% attack per rank.' },
    combustion: { name: 'Combustion', type: 'passive', stat: 'dotpow', per: 8, desc: 'Burning and poison deal +{per}% per rank.' },
    pyromania: { name: 'Pyromania', type: 'passive', stat: 'crit', per: 1, desc: '+{per}% critical chance per rank.' },
    keen_eye: { name: 'Keen Eye', type: 'passive', stat: 'crit', per: 1, desc: '+{per}% critical chance per rank.' },
    fleet_foot: { name: 'Fleet Foot', type: 'passive', stat: 'spdpct', per: 2, desc: '+{per}% speed per rank.' },
    predator: { name: 'Predator', type: 'passive', stat: 'atkpct', per: 2, desc: '+{per}% attack per rank.' },
    dark_pact: { name: 'Dark Pact', type: 'passive', stat: 'atkpct', per: 2, desc: '+{per}% attack per rank.' },
    grave_chill: { name: 'Grave Chill', type: 'passive', stat: 'dotpow', per: 8, desc: 'Curses and rot deal +{per}% per rank.' },
    lich_form: { name: 'Lich Form', type: 'passive', stat: 'hppct', per: 2, desc: '+{per}% max health per rank.' },
    thick_skin: { name: 'Thick Skin', type: 'passive', stat: 'hppct', per: 2, desc: '+{per}% max health per rank.' },
    fury: { name: 'Fury', type: 'passive', stat: 'atkpct', per: 2, desc: '+{per}% attack per rank.' },
    undying: { name: 'Undying', type: 'passive', stat: 'lifesteal', per: 1, desc: '+{per}% lifesteal per rank.' },
    zeal: { name: 'Zeal', type: 'passive', stat: 'spdpct', per: 2, desc: '+{per}% speed per rank.' },
    faith: { name: 'Faith', type: 'passive', stat: 'defpct', per: 3, desc: '+{per}% defense per rank.' },
    aegis: { name: 'Aegis', type: 'passive', stat: 'party_defpct', per: 2, desc: 'Whole party +{per}% defense per rank.' },
  });
  // mark sky-borne skills that already exist
  S.rain_of_iron.sky = true; S.inferno.sky = true; S.judgement.sky = true; S.volley.sky = true;
  // synergies: skill gains +pct per rank in the other skill
  const syn = (id, obj) => { S[id].syn = obj; };
  syn('shield_bash', { cleave: 4 }); syn('cleave', { shield_bash: 4 }); syn('iron_will', { toughness: 3 }); syn('last_stand', { iron_will: 5 }); syn('shield_wall', { iron_will: 4 });
  syn('backstab', { execute: 4, deadly_precision: 2 }); syn('execute', { backstab: 5 }); syn('fan_of_knives', { poison_blade: 4 }); syn('poison_blade', { fan_of_knives: 4 });
  syn('mend', { devotion: 4 }); syn('smite', { holy_nova: 4 }); syn('holy_nova', { smite: 4 }); syn('ward', { mend: 3 }); syn('resurrection', { mend: 3 });
  syn('fireball', { immolate: 4, meteor: 3 }); syn('meteor', { fireball: 5 }); syn('flame_wall', { inferno: 4 }); syn('inferno', { flame_wall: 4, fireball: 2 }); syn('immolate', { combustion: 3 });
  syn('aimed_shot', { multishot: 3 }); syn('volley', { rain_of_iron: 4 }); syn('rain_of_iron', { volley: 4 }); syn('multishot', { aimed_shot: 4 }); syn('crippling_shot', { hunters_mark: 3 });
  syn('soul_drain', { wither: 4 }); syn('wither', { soul_drain: 4, grave_chill: 2 }); syn('death_nova', { wither: 4, soul_drain: 2 }); syn('bone_shield', { lich_form: 3 });
  syn('reckless_swing', { rampage: 4 }); syn('rampage', { reckless_swing: 5 }); syn('whirlwind', { earthquake: 4 }); syn('earthquake', { whirlwind: 4 });
  syn('holy_strike', { judgement: 4 }); syn('judgement', { holy_strike: 5 }); syn('consecrate', { blessing: 3 }); syn('lay_on_hands', { faith: 3 });

  // ---- trees: [id, tier, prerequisite] ----
  const T = (arr) => arr.map(([id, tier, req]) => ({ id, tier, req: req || null }));
  D.TREES = {
    knight: T([['shield_bash', 1], ['toughness', 1], ['taunt', 1], ['iron_will', 2, 'toughness'], ['cleave', 2, 'shield_bash'], ['armor_mastery', 2, 'toughness'], ['last_stand', 3, 'iron_will'], ['shield_wall', 3, 'taunt'], ['retribution', 3, 'armor_mastery']]),
    rogue: T([['backstab', 1], ['poison_blade', 1], ['evasion', 1], ['shadowstep', 2, 'evasion'], ['fan_of_knives', 2, 'poison_blade'], ['deadly_precision', 2, 'backstab'], ['execute', 3, 'deadly_precision'], ['smoke_bomb', 3, 'shadowstep'], ['lethality', 3, 'deadly_precision']]),
    priest: T([['mend', 1], ['smite', 1], ['devotion', 1], ['ward', 2, 'mend'], ['purge', 2, 'devotion'], ['fortitude', 2, 'devotion'], ['resurrection', 3, 'ward'], ['holy_nova', 3, 'smite'], ['martyr', 3, 'fortitude']]),
    pyromancer: T([['fireball', 1], ['immolate', 1], ['warmth', 1], ['flame_wall', 2, 'fireball'], ['ashen_veil', 2, 'warmth'], ['combustion', 2, 'immolate'], ['inferno', 3, 'flame_wall'], ['meteor', 3, 'fireball'], ['pyromania', 3, 'warmth']]),
    ranger: T([['aimed_shot', 1], ['volley', 1], ['keen_eye', 1], ['crippling_shot', 2, 'aimed_shot'], ['hunters_mark', 2, 'keen_eye'], ['fleet_foot', 2, 'volley'], ['rain_of_iron', 3, 'volley'], ['multishot', 3, 'crippling_shot'], ['predator', 3, 'hunters_mark']]),
    necromancer: T([['soul_drain', 1], ['bone_shield', 1], ['dark_pact', 1], ['curse', 2, 'bone_shield'], ['wither', 2, 'soul_drain'], ['grave_chill', 2, 'dark_pact'], ['raise_dead', 3, 'curse'], ['death_nova', 3, 'wither'], ['lich_form', 3, 'grave_chill']]),
    berserker: T([['reckless_swing', 1], ['bloodlust', 1], ['thick_skin', 1], ['whirlwind', 2, 'reckless_swing'], ['war_cry', 2, 'bloodlust'], ['fury', 2, 'thick_skin'], ['rampage', 3, 'whirlwind'], ['earthquake', 3, 'fury'], ['undying', 3, 'war_cry']]),
    paladin: T([['holy_strike', 1], ['consecrate', 1], ['zeal', 1], ['lay_on_hands', 2, 'consecrate'], ['divine_shield', 2, 'zeal'], ['faith', 2, 'zeal'], ['judgement', 3, 'holy_strike'], ['blessing', 3, 'lay_on_hands'], ['aegis', 3, 'faith']]),
  };
  // auto-spend build order (first three are the "main" skills taken to max rank, the rest to rank 10)
  D.BUILD = {
    knight: ['shield_bash', 'toughness', 'cleave', 'iron_will', 'armor_mastery', 'taunt', 'last_stand', 'shield_wall', 'retribution'],
    rogue: ['backstab', 'poison_blade', 'deadly_precision', 'fan_of_knives', 'execute', 'evasion', 'lethality', 'shadowstep', 'smoke_bomb'],
    priest: ['mend', 'smite', 'devotion', 'ward', 'holy_nova', 'fortitude', 'resurrection', 'purge', 'martyr'],
    pyromancer: ['fireball', 'immolate', 'warmth', 'flame_wall', 'meteor', 'combustion', 'inferno', 'ashen_veil', 'pyromania'],
    ranger: ['aimed_shot', 'volley', 'keen_eye', 'multishot', 'crippling_shot', 'rain_of_iron', 'hunters_mark', 'fleet_foot', 'predator'],
    necromancer: ['soul_drain', 'wither', 'dark_pact', 'bone_shield', 'death_nova', 'curse', 'grave_chill', 'raise_dead', 'lich_form'],
    berserker: ['reckless_swing', 'thick_skin', 'whirlwind', 'bloodlust', 'fury', 'rampage', 'earthquake', 'war_cry', 'undying'],
    paladin: ['holy_strike', 'consecrate', 'zeal', 'faith', 'judgement', 'lay_on_hands', 'divine_shield', 'blessing', 'aegis'],
  };
  // every class's skill list now follows its tree (actives only, used for cooldown keys / ordering)
  for (const cid in D.TREES) D.CLASSES[cid].skills = D.TREES[cid].map((n) => n.id).filter((id) => S[id].type !== 'passive');
})();
