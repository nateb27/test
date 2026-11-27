import type { GatherKind, Modifier, TechDef } from './schema';

const villagers = { tags: ['villager' as const] };

/** Multiply the villager gather rate of each listed kind. */
function rateMul(kinds: GatherKind[], value: number): Modifier[] {
  return kinds.map((k) => ({ select: villagers, stat: `gatherRate.${k}` as const, op: 'mul' as const, value }));
}

/** Shorthand for a military upgrade (PLAN-M2 5.4): tag `militaryTech`, icon `icon.tech.<id>`. */
function upgrade(
  id: string,
  name: string,
  description: string,
  age: 2 | 3,
  cost: TechDef['cost'],
  researchTime: number,
  effects: Modifier[],
  requires?: string,
): TechDef {
  return {
    kind: 'tech',
    id,
    name,
    description,
    age,
    tags: ['militaryTech'],
    cost,
    researchTime,
    effects,
    ...(requires === undefined ? {} : { requiresTechs: [requires] }),
    icon: `icon.tech.${id}`,
  };
}

const add = (select: Modifier['select'], stat: Modifier['stat'], value: number): Modifier => ({ select, stat, op: 'add', value });
const lineInfantry = { ids: ['spearman', 'swordsman'] };
const infantry = { tags: ['infantry' as const] };
const archers = { tags: ['archer' as const] };
const cavalry = { tags: ['cavalry' as const] };

/**
 * The 12 military upgrades (PLAN-M2 5.4), researched at the Barracks, Archery Range and Stable. Level II requires
 * level I. Infantry attack upgrades select Spearman and Swordsman by id (the Siphonarios does not gain them); armour
 * upgrades select by tag.
 */
export const militaryTechs: TechDef[] = [
  upgrade('spathionForging', 'Spathion Forging', 'Better-forged blades: Spearmen and Swordsmen +1 attack.', 2,
    { food: 100, gold: 50 }, 35, [add(lineInfantry, 'attack', 1)]),
  upgrade('strategikonDrill', 'Strategikon Drill', 'Drill from the military manuals: Spearmen and Swordsmen +1 attack.', 3,
    { food: 200, gold: 125 }, 50, [add(lineInfantry, 'attack', 1)], 'spathionForging'),
  upgrade('paddedKavadion', 'Padded Kavadion', 'Quilted coats for the foot: infantry +1 melee and +1 pierce armour.', 2,
    { food: 75, gold: 75 }, 35, [add(infantry, 'meleeArmor', 1), add(infantry, 'pierceArmor', 1)]),
  upgrade('lamellarKlibanion', 'Lamellar Klibanion', 'Lamellar cuirasses: infantry +1 melee and +1 pierce armour.', 3,
    { food: 175, gold: 150 }, 50, [add(infantry, 'meleeArmor', 1), add(infantry, 'pierceArmor', 1)], 'paddedKavadion'),
  upgrade('hornSinewBows', 'Horn-and-Sinew Bows', 'Composite bows that pull harder: Archers +1 attack.', 2,
    { wood: 75, gold: 75 }, 35, [add(archers, 'attack', 1)]),
  upgrade('solenarionGuides', 'Solenarion Guides', 'Arrow guides for longer, stronger shots: Archers +1 attack and +1 range.', 3,
    { wood: 150, gold: 175 }, 50, [add(archers, 'attack', 1), add(archers, 'range', 1)], 'hornSinewBows'),
  upgrade('bambakionCoats', 'Bambakion Coats', 'Padded cotton coats: Archers +1 melee and +1 pierce armour.', 2,
    { food: 100, gold: 50 }, 35, [add(archers, 'meleeArmor', 1), add(archers, 'pierceArmor', 1)]),
  upgrade('mailLorikion', 'Mail Lorikion', 'Mail shirts: Archers +1 melee and +1 pierce armour.', 3,
    { food: 200, gold: 125 }, 50, [add(archers, 'meleeArmor', 1), add(archers, 'pierceArmor', 1)], 'bambakionCoats'),
  upgrade('kontarionDrill', 'Kontarion Drill', 'Lance drill for the riders: cavalry +1 attack.', 2,
    { food: 125, gold: 50 }, 35, [add(cavalry, 'attack', 1)]),
  upgrade('taktikaWedge', 'Taktika Wedge', 'The wedge charge of the Taktika: cavalry +2 attack.', 3,
    { food: 250, gold: 125 }, 50, [add(cavalry, 'attack', 2)], 'kontarionDrill'),
  upgrade('feltHorseBards', 'Felt Horse Bards', 'Felt barding for the horses: cavalry +1 melee and +1 pierce armour.', 2,
    { food: 125, gold: 50 }, 35, [add(cavalry, 'meleeArmor', 1), add(cavalry, 'pierceArmor', 1)]),
  upgrade('ironHorseBards', 'Iron Horse Bards', 'Iron scale barding: cavalry +1 melee and +2 pierce armour.', 3,
    { food: 250, gold: 150 }, 50, [add(cavalry, 'meleeArmor', 1), add(cavalry, 'pierceArmor', 2)], 'feltHorseBards'),
];

/**
 * Shared technologies and age advances (plan 5.1, 5.5).
 * For age advances `age` is the age the player must currently be in
 * (townshipAge is available in age 1 and sets age 2).
 */
export const techs: TechDef[] = [
  {
    kind: 'tech',
    id: 'townshipAge',
    name: 'Township Age',
    description: 'Grow your settlement into a township, unlocking new buildings and troops.',
    age: 1,
    tags: ['ageAdvance'],
    cost: { food: 400 },
    researchTime: 60,
    effects: [],
    advancesTo: 2,
    requiresAgeBuildings: 2,
    icon: 'icon.tech.townshipAge',
  },
  {
    kind: 'tech',
    id: 'citadelAge',
    name: 'Citadel Age',
    description: 'Fortify your realm with stone and steel, unlocking siege engineering.',
    age: 2,
    tags: ['ageAdvance'],
    cost: { food: 700, gold: 300 },
    researchTime: 90,
    effects: [],
    advancesTo: 3,
    requiresAgeBuildings: 2,
    icon: 'icon.tech.citadelAge',
  },
  {
    kind: 'tech',
    id: 'empireAge',
    name: 'Empire Age',
    description: 'Rise to imperial greatness and unlock the mightiest war machines.',
    age: 3,
    tags: ['ageAdvance'],
    cost: { food: 1000, gold: 600, stone: 300 },
    researchTime: 120,
    effects: [],
    advancesTo: 4,
    requiresAgeBuildings: 2,
    icon: 'icon.tech.empireAge',
  },
  {
    kind: 'tech',
    id: 'handCarts',
    name: 'Hand Carts',
    description: 'Villagers haul bigger loads and walk a little faster with light carts.',
    age: 2,
    tags: ['gatherTech'],
    cost: { food: 150, wood: 100 },
    researchTime: 45,
    effects: [
      { select: villagers, stat: 'carryCapacity', op: 'add', value: 5 },
      { select: villagers, stat: 'speed', op: 'mul', value: 1.1 },
    ],
    icon: 'icon.tech.handCarts',
  },
  {
    kind: 'tech',
    id: 'ironAxes',
    name: 'Iron Axes',
    description: 'Iron-headed axes let woodcutters fell trees faster.',
    age: 2,
    tags: ['gatherTech'],
    cost: { food: 100, wood: 50 },
    researchTime: 30,
    effects: rateMul(['wood'], 1.15),
    icon: 'icon.tech.ironAxes',
  },
  {
    kind: 'tech',
    id: 'frameSaws',
    name: 'Frame Saws',
    description: 'Two-man frame saws turn logs into timber far more quickly.',
    age: 3,
    tags: ['gatherTech'],
    cost: { food: 200, wood: 100 },
    researchTime: 45,
    effects: rateMul(['wood'], 1.15),
    icon: 'icon.tech.frameSaws',
  },
  {
    kind: 'tech',
    id: 'irrigation',
    name: 'Irrigation',
    description: 'Ditches and channels keep fields watered and farmers more productive.',
    age: 2,
    tags: ['gatherTech'],
    cost: { food: 100, wood: 75 },
    researchTime: 30,
    effects: rateMul(['farm'], 1.15),
    icon: 'icon.tech.irrigation',
  },
  {
    kind: 'tech',
    id: 'threeFieldSystem',
    name: 'Three-Field System',
    description: 'Rotating crops across three fields keeps the soil fertile and yields high.',
    age: 3,
    tags: ['gatherTech'],
    cost: { food: 200, wood: 150 },
    researchTime: 45,
    effects: rateMul(['farm'], 1.15),
    icon: 'icon.tech.threeFieldSystem',
  },
  {
    kind: 'tech',
    id: 'ironPicks',
    name: 'Iron Picks',
    description: 'Hardened picks bite deeper into ore and rock.',
    age: 2,
    tags: ['gatherTech'],
    cost: { food: 100, wood: 75 },
    researchTime: 30,
    effects: rateMul(['gold', 'stone'], 1.15),
    icon: 'icon.tech.ironPicks',
  },
  {
    kind: 'tech',
    id: 'timberedShafts',
    name: 'Timbered Shafts',
    description: 'Braced shafts let miners dig deeper veins without fear of collapse.',
    age: 3,
    tags: ['gatherTech'],
    cost: { food: 200, wood: 150 },
    researchTime: 45,
    effects: rateMul(['gold', 'stone'], 1.15),
    icon: 'icon.tech.timberedShafts',
  },
  {
    kind: 'tech',
    id: 'guildCharters',
    name: 'Guild Charters',
    description: 'Charters organise every trade into guilds, boosting all gathering.',
    age: 4,
    tags: ['gatherTech'],
    cost: { food: 400, gold: 300 },
    researchTime: 60,
    effects: rateMul(['wood', 'berries', 'farm', 'gold', 'stone'], 1.1),
    icon: 'icon.tech.guildCharters',
  },
  ...militaryTechs,
];
