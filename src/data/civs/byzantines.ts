import type { BuildingDef, CivDef } from '../schema';

/**
 * The Byzantines (plan 5.6). Their unique defs live in the shared tables
 * (units.ts: cataphract, siphonarios) and here (silkWorkshop), each marked
 * `civs: ['byzantines']`.
 */
export const byzantines: CivDef = {
  id: 'byzantines',
  name: 'Byzantines',
  description:
    'Heirs of Rome in the East: soldier-farmers, armoured lancers, fire-throwing infantry and a thriving silk trade.',
  palette: { primary: 0x6a2c91, secondary: 0xd4af37 },
  bonuses: [
    {
      name: 'Themata',
      description: 'Soldier-farmer land grants: farms cost 20% less and are worked 10% faster.',
      modifiers: [
        { select: { ids: ['farm'] }, stat: 'cost.wood', op: 'mul', value: 0.8 },
        { select: { tags: ['villager'] }, stat: 'gatherRate.farm', op: 'mul', value: 1.1 },
      ],
    },
  ],
  uniques: ['cataphract', 'siphonarios', 'silkWorkshop'],
  icon: 'icon.civ.byzantines',
};

/** Byzantine unique building: passive gold, limit 3. Listed in `villager.builds`. */
export const silkWorkshop: BuildingDef = {
  kind: 'building',
  id: 'silkWorkshop',
  name: 'Silk Workshop',
  description: 'Weavers and merchants turn imperial silk into a steady stream of gold, no workers needed. Limit 3.',
  age: 3,
  tags: ['economy', 'incomeBuilding', 'unique'],
  cost: { wood: 150, stone: 100 },
  footprint: 3,
  blocking: true,
  buildable: true,
  buildTime: 50,
  popProvided: 0,
  dropOff: [],
  trains: [],
  researches: [],
  income: { resource: 'gold', perSecond: 0.25 },
  buildLimit: 3,
  civs: ['byzantines'],
  countsTowardAge: true,
  buildMenu: 'economy',
  combat: { hp: 1000, meleeArmor: 6, pierceArmor: 7 },
  icon: 'icon.building.silkWorkshop',
  sprite: 'building.silkWorkshop',
};
