// What kind of creature a character is: its type, and its subtypes.
//
// A dwarf is a Humanoid (Dwarf); a half-dragon dwarf is a Dragon (Dwarf), its
// template replacing the type and keeping the subtype. The lists are the SRD's
// own (Creature Types and Subtypes), so a homebrew race or template is chosen
// from the same words the rules use, and nothing downstream has to cope with a
// "humaniod".
//
// Pure: no DOM, no fetch.

/** The SRD's creature types. */
export const CREATURE_TYPES = [
  'Aberration', 'Animal', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Giant',
  'Humanoid', 'Magical Beast', 'Monstrous Humanoid', 'Ooze', 'Outsider',
  'Plant', 'Undead', 'Vermin',
];

/** The SRD's creature subtypes. */
export const CREATURE_SUBTYPES = [
  'Air', 'Angel', 'Aquatic', 'Archon', 'Augmented', 'Baatezu', 'Chaotic', 'Cold',
  'Dwarf', 'Earth', 'Elf', 'Evil', 'Extraplanar', 'Fire', 'Gnoll', 'Gnome',
  'Goblinoid', 'Good', 'Halfling', 'Human', 'Incorporeal', 'Lawful', 'Native',
  'Orc', 'Reptilian', 'Shapechanger', 'Swarm', "Tanar'ri", 'Water',
];

/**
 * The SRD's races do not say what they are, because every one of them is a
 * Humanoid of its own kind; this is that, by the word in the race's name. A
 * half-elf is an Elf and a half-orc an Orc, as the Monster Manual has them.
 */
const RACE_SUBTYPES = [
  [/\bdwarf/i, 'Dwarf'], [/\belf\b|\belves\b|half-elf/i, 'Elf'], [/\bgnome/i, 'Gnome'],
  [/\bhalfling/i, 'Halfling'], [/\borc\b|half-orc/i, 'Orc'], [/\bhuman/i, 'Human'],
];

/** A race's own type and subtypes, before any template. */
function baseKind(race) {
  if (race?.type) return { type: race.type, subtypes: race.subtype ? [race.subtype] : [...(race.subtypes || [])] };
  if (!race?.name) return { type: '', subtypes: [] };
  const found = RACE_SUBTYPES.find(([pattern]) => pattern.test(race.name));
  return found && !race.custom ? { type: 'Humanoid', subtypes: [found[1]] } : { type: '', subtypes: [] };
}

/**
 * The type and subtypes a character ends up with: its race's, then each
 * template's in turn. A template's type, when it has one, replaces the type
 * so far; its subtype, when it has one, joins the list.
 *
 * @param race       the race as the sheet knows it (content, SRD, or typed in)
 * @param templates  the templates laid over it, resolved to their content
 * @returns { type, subtypes, label } - label as a stat block writes it: "Dragon (Dwarf)"
 */
export function creatureKind(race, templates = []) {
  const kind = baseKind(race);
  let type = kind.type;
  const subtypes = [...kind.subtypes];
  for (const template of templates) {
    if (template?.type) type = template.type;
    if (template?.subtype && !subtypes.includes(template.subtype)) subtypes.push(template.subtype);
  }
  const label = type ? `${type}${subtypes.length ? ` (${subtypes.join(', ')})` : ''}` : subtypes.join(', ');
  return { type, subtypes, label };
}
