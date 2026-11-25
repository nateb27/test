import type { AgeDef } from './schema';

/**
 * The four ages (plan 5.1). `advanceTech` is filled in by WP4 once the
 * age-advance techs exist; until then it is null for every age.
 */
export const ages: AgeDef[] = [
  { age: 1, name: 'Founding Age', advanceTech: null, icon: 'icon.age.1' },
  { age: 2, name: 'Township Age', advanceTech: null, icon: 'icon.age.2' },
  { age: 3, name: 'Citadel Age', advanceTech: null, icon: 'icon.age.3' },
  { age: 4, name: 'Empire Age', advanceTech: null, icon: 'icon.age.4' },
];
