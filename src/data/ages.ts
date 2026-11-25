import type { AgeDef } from './schema';

/** The four ages (plan 5.1). Each advance tech lives in techs.ts and is researched at the Town Center. */
export const ages: AgeDef[] = [
  { age: 1, name: 'Founding Age', advanceTech: null, icon: 'icon.age.1' },
  { age: 2, name: 'Township Age', advanceTech: 'townshipAge', icon: 'icon.age.2' },
  { age: 3, name: 'Citadel Age', advanceTech: 'citadelAge', icon: 'icon.age.3' },
  { age: 4, name: 'Empire Age', advanceTech: 'empireAge', icon: 'icon.age.4' },
];
