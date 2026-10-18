// Player-written content, and how it reaches the arithmetic.
//
// Eight kinds of thing can be written by hand - a race, a class, a feat, a
// skill, an item, a template, a misc feature, a spell or power - and each is
// described here once, as data. One editor in the interface renders all of
// them from these descriptions, and one code path in the engine consumes them,
// so adding a ninth kind later is a change in this file rather than a change
// everywhere. What each one does is a list of special abilities, in the one
// shape engine/specials.js gives them.
//
// Where content lives, and why in two places:
//
//   the LIBRARY   kept in the browser, shared across all your characters. This
//                 is your shelf: write the Warblade once and use it on three
//                 characters.
//
//   the CHARACTER a copy of everything this particular sheet actually uses,
//                 embedded in the sheet itself, under `content`.
//
// The engine reads only the embedded copy. That is what makes an exported sheet
// whole: hand the file to your DM, or to somebody with an empty library, and
// the character still adds up, because the Warblade travelled with it. The
// alternative - a sheet that points at content it does not carry - is a sheet
// that quietly breaks the moment it leaves the browser it was made in.

import { BODY_SLOTS, ITEM_CATEGORIES, slotKeyFor } from './inventory.js';
import { withSpecials, effectsOfSpecials, specialSource, featsGranted } from './specials.js';
import { creatureKind } from './creatures.js';

/** The bonus types an effect may claim, for the editor's dropdown. */
export const BONUS_TYPES = [
  'untyped', 'alchemical', 'armor', 'circumstance', 'competence', 'deflection',
  'dodge', 'enhancement', 'inherent', 'insight', 'luck', 'morale', 'natural',
  'profane', 'racial', 'resistance', 'sacred', 'shield', 'size',
];

const PROGRESSIONS = [['good', 'Good (+1 per level)'], ['average', 'Average (+3/4)'], ['poor', 'Poor (+1/2)']];
const SAVE_PROGRESSIONS = [['good', 'Good'], ['poor', 'Poor']];
const ABILITIES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'],
  ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];

/** Where an item is worn, by the keys the equipment slots use. */
export const ITEM_SLOTS = [
  ['', 'Slotless'],
  ...BODY_SLOTS.filter((s) => s.key !== 'ring2').map((s) => [s.key === 'ring1' ? 'ring' : s.key, `${s.label} (${s.examples})`]),
  ['armor', 'Armor'],
  ['shield', 'Shield'],
];

export const SPELL_SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation', 'Universal'];
export const SPELL_SUBSCHOOLS = ['Calling', 'Creation', 'Healing', 'Summoning', 'Teleportation', 'Scrying', 'Charm', 'Compulsion', 'Figment', 'Glamer', 'Pattern', 'Phantasm', 'Shadow'];
export const DISCIPLINES = ['Clairsentience', 'Metacreativity', 'Psychokinesis', 'Psychometabolism', 'Psychoportation', 'Telepathy'];
export const SUBDISCIPLINES = ['Charm', 'Compulsion', 'Creation', 'Healing', 'Scrying', 'Teleportation'];

const NAME = { key: 'name', label: 'Name', type: 'text', wide: true };
const SOURCE = { key: 'source', label: 'Source', type: 'text', wide: true, hint: 'A sourcebook and page, or homebrew.' };

/** What a race and a template are both drawn with: a template is laid over a race, so it is described the same way. */
const raceFields = (template) => [
  NAME,
  SOURCE,
  { key: 'type', label: 'Type', type: 'creatureType', blank: template ? 'Unchanged' : 'Choose a type',
    hint: template ? 'Empty keeps the creature’s own type; a type here replaces it.' : null },
  { key: 'subtype', label: 'Subtype', type: 'creatureSubtype', blank: 'None',
    hint: template ? 'Added to the creature’s subtypes.' : null },
  { key: 'size', label: 'Size', type: 'size', blank: template ? 'Unchanged' : null },
  { key: 'speed', label: 'Speed', type: 'int', hint: template ? 'Empty keeps the race’s speed.' : null },
  { key: 'la', label: 'Level adjustment', type: 'int' },
  { key: 'racialHD', label: 'Racial hit dice', type: 'int' },
  { key: 'racialHDType', label: 'Racial hit die', type: 'int', hint: 'The die, as a number: 8 for d8.' },
  { key: 'favoredClass', label: 'Favored class', type: 'text', hint: template ? 'Empty keeps the race’s.' : null },
  { key: 'abilityAdjust', label: 'Ability adjustments', type: 'abilities', wide: true },
  { key: 'specials', label: 'Traits', type: 'specials', add: 'Add a trait',
    hint: template
      ? 'What the template grants, one ability at a time. Give one bonuses and they count; give it uses and the sheet tracks them.'
      : 'Darkvision, stonecunning, a racial bonus - one trait at a time. Give one bonuses and they count on the sheet; give it uses and the sheet tracks them.' },
];

/**
 * The kinds of content.
 *
 * `fields` is what the editor draws, in order. A field of type `specials` is a
 * list of special abilities (engine/specials.js): that is where every kind
 * says what it does, and what it changes on a sheet. `tab` names the kind in
 * the library's tabs where that differs from `label`.
 */
export const CONTENT_TYPES = {
  race: {
    key: 'race',
    plural: 'races',
    label: 'Race',
    blurb: 'A race or species. Its ability adjustments, size and speed feed the sheet directly; its traits say what else it does.',
    fields: raceFields(false),
  },

  class: {
    key: 'class',
    plural: 'classes',
    label: 'Class',
    blurb: 'A base or prestige class. Once entered it counts exactly like a printed one: hit die, base attack bonus, saves, skill points and class skills all feed the totals, and each class feature arrives at its level.',
    fields: [
      NAME,
      SOURCE,
      { key: 'hd', label: 'Hit die', type: 'int', hint: 'As a number: 8 for d8.' },
      { key: 'bab', label: 'Base Attack Bonus', type: 'select', options: PROGRESSIONS },
      { key: 'saves.fort', label: 'Fortitude', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'saves.ref', label: 'Reflex', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'saves.will', label: 'Will', type: 'select', options: SAVE_PROGRESSIONS },
      { key: 'skillPoints', label: 'Skill points', type: 'int', hint: 'Before Intelligence.' },
      { key: 'prestige', label: 'Prestige class', type: 'bool' },
      { key: 'classSkills', label: 'Class skills', type: 'list', wide: true,
        hint: 'Comma separated. A bare "Knowledge" makes every Knowledge a class skill.' },
      { key: 'spellcaster', label: 'Spellcaster', type: 'bool', hint: 'Casts spells, from a list built below.' },
      { key: 'manifester', label: 'Manifester', type: 'bool', hint: 'Manifests psionic powers, from a list built below.' },
      { key: 'magic', label: 'Spells and powers', type: 'magic' },
      { key: 'specials', label: 'Class features', type: 'specials', add: 'Add a class feature', level: true,
        hint: 'Each feature arrives at the class level it is gained at. Give one bonuses and they count from that level; give it uses and the sheet tracks them.' },
    ],
  },

  feat: {
    key: 'feat',
    plural: 'feats',
    label: 'Feat',
    blurb: 'A feat. Its benefit is text, which is all most feats need; give the benefit bonuses or uses and taking the feat changes the sheet.',
    fields: [
      NAME,
      SOURCE,
      { key: 'category', label: 'Type', type: 'text', hint: 'General, Combat, Metamagic, Item Creation ...' },
      { key: 'prerequisites', label: 'Prerequisites', type: 'text', wide: true },
      { key: 'specials', label: 'Benefit', type: 'specials', add: 'Add a benefit',
        hint: 'What the feat does. Uses and their reset are for a feat used only so many times.' },
    ],
  },

  skill: {
    key: 'skill',
    plural: 'skills',
    label: 'Skill',
    blurb: 'A skill the edition does not have. It joins the skill table, with its own key ability and rank costs.',
    fields: [
      NAME,
      SOURCE,
      { key: 'ability', label: 'Key ability', type: 'select', options: [['', 'None'], ...ABILITIES] },
      { key: 'trainedOnly', label: 'Trained only', type: 'bool' },
      { key: 'acp', label: 'Armor check penalty applies', type: 'bool' },
      { key: 'subtype', label: 'Taken per subject', type: 'bool', hint: 'As Craft and Knowledge are.' },
      { key: 'description', label: 'What it does', type: 'textarea', wide: true },
    ],
  },

  item: {
    key: 'item',
    plural: 'items',
    label: 'Item',
    blurb: 'A piece of equipment: a weapon, armor, a ring, a wondrous item, any gear. Its statistics are a weapon\u2019s or armor\u2019s; its effects apply while it is worn or held, and stop when it is not. Bought or taken from the Shop on a sheet.',
    fields: [
      NAME,
      SOURCE,
      { key: 'category', label: 'Category', type: 'select', options: ITEM_CATEGORIES.map((c) => [c, c]) },
      { key: 'slot', label: 'Slot', type: 'select', options: ITEM_SLOTS, hint: 'Where it is worn.' },
      { key: 'value', label: 'Value in gp', type: 'number' },
      { key: 'weight', label: 'Weight in lb.', type: 'number' },
      { key: 'stats', label: 'Statistics', type: 'itemStats' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      { key: 'specials', label: 'Effects', type: 'specials', add: 'Add an effect',
        hint: 'What it does for whoever wears it, one power at a time - a bonus, a use a day, a spell-like ability.' },
    ],
  },

  template: {
    key: 'template',
    plural: 'templates',
    label: 'Template',
    blurb: 'Something laid over a race - half-dragon, lycanthrope, a homebrew curse. It is written as a race is, and whatever it leaves empty, the race underneath keeps.',
    fields: raceFields(true),
  },

  feature: {
    key: 'feature',
    plural: 'features',
    label: 'Misc feature',
    tab: 'Misc Features',
    blurb: 'Anything else a character has: a boon, a bloodline, a curse, a gift of the story. The catch-all, so nothing is unrepresentable.',
    fields: [
      NAME,
      { ...SOURCE, hint: 'A sourcebook, a class, a story, a deity - or homebrew.' },
      { key: 'specials', label: 'What it does', type: 'specials', add: 'Add an ability' },
    ],
  },

  spell: {
    key: 'spell',
    plural: 'spells',
    label: 'Spell or power',
    tab: 'Spells & Powers',
    blurb: 'A spell or a psionic power, written as the books print one. What it does to whoever it is on can count on a sheet: switch it on there while it lasts.',
    layout: 'statblock',
    fields: [
      NAME,
      SOURCE,
      { key: 'mode', label: 'Kind', type: 'select', options: [['spell', 'Spell'], ['power', 'Psionic power']] },
      { key: 'school', label: 'School', labelPower: 'Discipline', type: 'school' },
      { key: 'subschool', label: 'Subschool', labelPower: 'Subdiscipline', type: 'subschool' },
      { key: 'descriptors', label: 'Descriptors', type: 'text', placeholder: 'Fire, Mind-Affecting' },
      { key: 'level', label: 'Level', type: 'text', placeholder: 'Sor/Wiz 3, Clr 4', placeholderPower: 'Psion/wilder 3' },
      { key: 'components', label: 'Components', labelPower: 'Display', type: 'text', placeholder: 'V, S, M', placeholderPower: 'Auditory, Visual' },
      { key: 'castingTime', label: 'Casting Time', labelPower: 'Manifesting Time', type: 'text', placeholder: '1 standard action' },
      { key: 'range', label: 'Range', type: 'text', placeholder: 'Close (25 ft. + 5 ft./2 levels)' },
      { key: 'target', label: 'Target', type: 'text', placeholder: 'One creature' },
      { key: 'effect', label: 'Effect', type: 'text', placeholder: 'Ray' },
      { key: 'area', label: 'Area', type: 'text', placeholder: '20-ft.-radius spread' },
      { key: 'duration', label: 'Duration', type: 'text', placeholder: '1 round/level' },
      { key: 'savingThrow', label: 'Saving Throw', type: 'text', placeholder: 'Will negates' },
      { key: 'resistance', label: 'Spell Resistance', labelPower: 'Power Resistance', type: 'text', placeholder: 'Yes' },
      { key: 'powerPoints', label: 'Power Points', type: 'text', only: 'power', placeholder: '5' },
      { key: 'description', label: 'Description', type: 'textarea', wide: true },
      { key: 'materials', label: 'Material Component', type: 'text', only: 'spell', wide: true },
      { key: 'focus', label: 'Focus', type: 'text', only: 'spell', wide: true },
      { key: 'xpCost', label: 'XP Cost', type: 'text', wide: true },
      { key: 'augment', label: 'Augment', type: 'textarea', only: 'power', wide: true },
      { key: 'specials', label: 'Effects on the target', type: 'specials', add: 'Add a bonus',
        hint: 'The bonuses it gives whoever it is on, while it lasts - or a feat it grants. On their sheet, switch it on under Spells and powers in effect and these count.' },
    ],
  },
};

export const CONTENT_KINDS = Object.keys(CONTENT_TYPES);

/** An empty entry of one kind, ready for the editor. */
export function blankEntry(kind) {
  const type = CONTENT_TYPES[kind];
  if (!type) throw new Error(`no such content kind: ${kind}`);
  const entry = { kind, name: '', custom: true };
  for (const field of type.fields) {
    if (field.type === 'magic' || field.type === 'itemStats') continue;
    const value = field.type === 'bool' ? false
      : field.type === 'int' || field.type === 'number' ? 0
        : field.type === 'list' || field.type === 'specials' ? []
          : field.type === 'abilities' ? {}
            : '';
    setDeep(entry, field.key, value);
  }
  if (kind === 'class') entry.saves = { fort: 'poor', ref: 'poor', will: 'poor' };
  if (kind === 'race') { entry.size = 'Medium'; entry.speed = 30; }
  if (kind === 'template') entry.speed = null;
  if (kind === 'spell') entry.mode = 'spell';
  if (kind === 'item') entry.category = 'Wondrous item';
  return entry;
}

function setDeep(object, path, value) {
  const keys = String(path).split('.');
  const last = keys.pop();
  let node = object;
  for (const key of keys) {
    if (!node[key] || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  if (node[last] === undefined) node[last] = value;
}

/** An empty library: one list per kind. */
export function blankLibrary() {
  return Object.fromEntries(CONTENT_KINDS.map((kind) => [CONTENT_TYPES[kind].plural, []]));
}

/**
 * The content available to one character: what ships with the app, plus what
 * the character carries. The character's own entries win on a name clash, so a
 * table that has rewritten the Bard gets its Bard.
 */
export function contentIndex(rules, character) {
  const content = character?.content || {};
  const index = {};
  // An entry written before special abilities existed is read in their shape,
  // so what it says and does counts the same either way (engine/specials.js).
  const own = (plural, kind) => (content[plural] || [])
    .filter((e) => e?.name)
    .map((e) => ({ ...withSpecials(e, kind), custom: true }));

  index.classByName = new Map(rules.classes.classes.map((c) => [c.name, c]));
  for (const c of own('classes', 'class')) index.classByName.set(c.name, casterShape(c));
  // Sheets made before the library existed kept their classes here.
  for (const c of character?.customClasses || []) if (c.name) index.classByName.set(c.name, { ...withSpecials(c, 'class'), custom: true });

  index.raceByName = new Map((rules.races?.races || []).map((r) => [r.name, r]));
  for (const r of own('races', 'race')) index.raceByName.set(r.name, r);

  index.skills = [...rules.skills.skills];
  for (const s of content.skills || []) {
    if (!s.name) continue;
    const at = index.skills.findIndex((x) => x.name === s.name);
    if (at >= 0) index.skills[at] = { ...s, custom: true };
    else index.skills.push({ ...s, custom: true });
  }
  index.skillsByName = new Map(index.skills.map((s) => [s.name, s]));

  index.featByName = new Map(own('feats', 'feat').map((f) => [f.name, f]));
  // The SRD's feats carry their effects from data/feat-effects.json; a homebrew
  // feat of the same name, carried by the character, wins.
  index.srdFeatEffects = new Map(Object.entries(rules.featEffects?.feats || {}));
  index.featRuleByName = new Map((rules.featRules || []).map((f) => [f.name.toLowerCase(), f]));
  index.itemByName = new Map(own('items', 'item').map((i) => [i.name, { ...i, slot: slotKeyFor(i.slot) }]));
  index.templateByName = new Map(own('templates', 'template').map((t) => [t.name, t]));
  index.featureByName = new Map(own('features', 'feature').map((f) => [f.name, f]));
  index.spellByName = new Map(own('spells', 'spell').map((sp) => [sp.name, sp]));

  return index;
}

/** The ways a homebrew spellcaster prepares: from its list, spontaneously, or from a spellbook. */
export const CASTING_STYLES = [['prepared', 'Prepares from its list'], ['spontaneous', 'Casts spontaneously'], ['spellbook', 'Prepares from a spellbook']];

/**
 * A homebrew class as the casting engine reads one (engine/magic.js). A
 * Spellcaster casts with its ability, arcane or divine, preparing or not, with
 * the spells per day and known of the SRD class it names, from the spell list
 * it was given; a Manifester likewise, with power points and powers known. A
 * class written before the checkboxes, with only a casting ability, keeps
 * what it had.
 */
export function casterShape(c) {
  if (!c) return c;
  if (c.manifester) {
    return { ...c, casting: null, manifesting: { ...(c.manifesting || {}), ability: c.manifesting?.ability || 'int' } };
  }
  if (c.spellcaster === false) return { ...c, casting: null, manifesting: null };
  if (c.spellcaster || c.casting?.ability) {
    const style = c.casting?.style || 'prepared';
    return {
      ...c,
      manifesting: null,
      casting: {
        ...(c.casting || {}),
        ability: c.casting?.ability || 'int',
        type: c.casting?.type === 'divine' ? 'divine' : 'arcane',
        spontaneous: style === 'spontaneous',
        spellbook: style === 'spellbook',
      },
    };
  }
  return c;
}

/**
 * Feats an ability grants - a class's bonus feat at the level it comes, a
 * race's Alertness, a worn item's Improved Initiative - each held as a feat
 * that fills no slot, with where it came from.
 *
 * @param character  the character as derive sees it (items marked equipped)
 * @param classes    each class taken, with its levels and its definition
 * @returns [{ name, choice, level, source }]
 */
export function featsFromSpecials(character, index, classes = []) {
  const out = [];
  const take = (holderName, specials, level = 1) => {
    for (const special of specials || []) {
      for (const feat of featsGranted(special)) out.push({ ...feat, level, source: specialSource(holderName, special) });
    }
  };
  const rows = (list, lookup) => (list || []).filter((row) => row?.name || (row?.specials || []).length)
    .map((row) => ({ name: row.name, specials: [...(lookup?.get(row.name)?.specials || []), ...(row.specials || [])] }));

  const typed = character.race || {};
  if (typed.name) take(typed.name, [...(index.raceByName.get(typed.name)?.specials || []), ...(typed.specials || [])]);
  for (const t of rows(character.templates, index.templateByName)) take(t.name, t.specials);

  // A class's feature arrives at the character level its class level was reached.
  const reached = (name, classLevel) => {
    let count = 0;
    const levels = character.levels || [];
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].a === name || levels[i].b === name) count += 1;
      if (count >= classLevel) return i + 1;
    }
    return levels.length || 1;
  };
  const seen = new Set();
  for (const c of classes) {
    if (!c?.def || seen.has(c.name)) continue;
    seen.add(c.name);
    for (const special of c.def.specials || []) {
      const at = Math.max(1, Number(special?.level) || 1);
      if (at > c.levels) continue;
      for (const feat of featsGranted(special)) out.push({ ...feat, level: reached(c.name, at), source: specialSource(c.name, special) });
    }
  }

  for (const f of rows(character.feats, index.featByName)) take(f.name, f.specials);
  for (const f of rows(character.features, index.featureByName)) take(f.name, f.specials);
  for (const item of rows((character.wealth?.items || []).filter((i) => i?.equipped !== false), index.itemByName)) take(item.name, item.specials);
  for (const a of (character.activeSpells || []).filter((x) => x?.name && x.on !== false)) take(a.name, index.spellByName?.get(a.name)?.specials);
  return out;
}

/**
 * The mechanical facts of a character's race, with its templates laid over it.
 *
 * A race the sheet knows - an SRD race, or one the character carries - supplies
 * its own size, speed, level adjustment and ability adjustments, and the sheet's
 * fields for those are not consulted. A race the sheet does not know is typed in
 * by hand, and then those fields are all there is. This is what stops a dwarf's
 * +2 Constitution being counted once from the race and again from a field a
 * player filled in to match it.
 *
 * Templates are laid over the race in the order taken. What they add - level
 * adjustment, racial hit dice, ability adjustments, subtypes - is added; what
 * they set - size, speed, favored class, type - replaces the race's, and only
 * when the template says something. A template that leaves its size empty
 * leaves the creature its own size.
 */
export function raceFacts(character, index) {
  const typed = character.race || {};
  const known = index.raceByName.get(typed.name);
  const source = known || typed;
  const num = (v, d = 0) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  const templates = (character.templates || [])
    .filter((t) => t?.name)
    .map((t) => index.templateByName.get(t.name) || t);

  const abilityAdjust = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
  for (const key of Object.keys(abilityAdjust)) {
    abilityAdjust[key] = num(source.abilityAdjust?.[key]) + templates.reduce((total, t) => total + num(t.abilityAdjust?.[key]), 0);
  }

  let size = source.size || 'Medium';
  let speed = num(source.speed, 30);
  let favoredClass = source.favoredClass || '';
  let racialHDType = num(source.racialHDType);
  for (const t of templates) {
    if (t.size) size = t.size;
    if (num(t.speed) > 0) speed = num(t.speed);
    if (t.favoredClass) favoredClass = t.favoredClass;
    if (!racialHDType && num(t.racialHDType)) racialHDType = num(t.racialHDType);
  }
  // Only a race the SRD prints has its kind worked out from its name; one
  // typed in, or written as homebrew, is whatever it says it is.
  const kind = creatureKind({ ...source, name: typed.name, custom: !known || Boolean(known.custom) }, templates);

  return {
    known: Boolean(known),
    name: typed.name || '',
    size,
    speed,
    la: num(source.la) + templates.reduce((total, t) => total + num(t.la), 0),
    racialHD: num(source.racialHD) + templates.reduce((total, t) => total + num(t.racialHD), 0),
    racialHDType,
    abilityAdjust,
    favoredClass,
    traits: source.traits || specialsInWords(source.specials),
    type: kind.type,
    subtypes: kind.subtypes,
    kindLabel: kind.label,
  };
}

/** A list of special abilities as one line of text, for what reads a race's traits as words. */
const specialsInWords = (specials) => (specials || [])
  .map((sp) => [String(sp?.name || '').trim(), String(sp?.text || '').trim()].filter(Boolean).join(': '))
  .filter(Boolean)
  .join(' ');

/**
 * The things on this character that can carry effects, resolved to objects.
 *
 * A row on the sheet may carry its own effects, or name a piece of content that
 * does. Both work, and a row that does both gets both - a +1 ring someone has
 * also written a note on is still a +1 ring.
 */
export function resolveEntries(character, index, granted = [], opts = {}) {
  const race = index.raceByName.get(character.race?.name);
  const typed = character.race || {};
  const raceEntry = race || (typed.name ? { name: typed.name } : null);

  // A row's own special abilities join its content's, and the effects of both
  // join the row's: a homebrew feat's benefit counts, and so does anything a
  // player added to the row on the sheet.
  const withContent = (rows, lookup, kind) => (rows || [])
    .filter((row) => row && (row.name || (row.effects || []).length || (row.specials || []).length))
    .map((row) => {
      const entry = lookup.get(row.name);
      const specials = [...(entry?.specials || []), ...(row.specials || [])];
      const name = row.name || entry?.name || '';
      const effects = [...(entry?.effects || []), ...(row.effects || []), ...effectsOfSpecials({ name, specials })];
      return { ...entry, ...row, kind, specials, effects };
    });

  // Feats: the character's own content first, then what the SRD feat does -
  // with its choice filled in, again for each further time it is taken, and
  // Psionic Body's hit points for every psionic feat held. Feats a class grants
  // count as held.
  const featRows = [...granted.map((g) => ({ ...g, granted: true })), ...(character.feats || [])];
  const psionicFeats = featRows.filter((f) => f?.name && (index.featRuleByName?.get(f.name.toLowerCase())?.types || []).includes('Psionic')).length;
  const copies = new Map();
  const feats = withContent(featRows, index.featByName, 'feat').map((row) => {
    if (index.featByName.has(row.name)) return row;
    const srd = index.srdFeatEffects?.get(row.name);
    if (!srd) return row;
    const n = copies.get(row.name) || 0;
    copies.set(row.name, n + 1);
    const filled = fillChoice(srd, row.choice);
    const effects = filled.effects.map((e) => ({
      ...e,
      value: toNumber(e.value) * (e.perPsionicFeat ? psionicFeats : 1) + toNumber(e.perCopy) * n,
    }));
    return { ...row, effects: [...effects, ...(row.effects || [])], notes: filled.notes };
  });

  // The race's traits: its content's, and any typed onto a race the sheet does not know.
  const raceSpecials = [...(race?.specials || []), ...(typed.specials || [])];

  // A class's features, as far as its level reaches: Rage at 1st, Greater Rage at 11th.
  const classLevels = new Map();
  for (const c of opts.classes || []) {
    if (!c?.name || !c.def) continue;
    const was = classLevels.get(c.name);
    if (!was || was.levels < c.levels) classLevels.set(c.name, c);
  }
  const classes = [...classLevels.values()]
    .filter((c) => (c.def.specials || []).length || (c.def.effects || []).length)
    .map((c) => ({
      name: c.name,
      kind: 'class',
      classLevel: c.levels,
      source: c.def.source || '',
      specials: c.def.specials || [],
      effects: [...(c.def.effects || []), ...effectsOfSpecials({ name: c.name, specials: c.def.specials }, c.levels)],
    }));

  // Spells and powers in effect on the character, switched on on the sheet.
  const active = (character.activeSpells || [])
    .filter((a) => a?.name && a.on !== false)
    .map((a) => {
      const entry = index.spellByName?.get(a.name);
      const specials = entry?.specials || [];
      return { ...entry, name: a.name, kind: 'spell', specials, effects: effectsOfSpecials({ name: a.name, specials }) };
    });

  return {
    race: raceEntry
      ? {
        ...raceEntry,
        specials: raceSpecials,
        effects: [...(race?.effects || []), ...(typed.effects || []), ...effectsOfSpecials({ name: raceEntry.name, specials: raceSpecials })],
      }
      : null,
    templates: withContent(character.templates, index.templateByName, 'template'),
    classes,
    feats,
    features: withContent(character.features, index.featureByName, 'feature'),
    items: withContent(character.wealth?.items, index.itemByName, 'item'),
    active,
  };
}

/** Fill `{choice}` in an entry's effects and notes; drop what names a choice not made. */
function fillChoice(entry, choice) {
  const chosen = String(choice || '').trim();
  const fill = (text) => String(text).replace(/\{choice\}/g, chosen);
  const effects = (entry.effects || [])
    .filter((e) => !String(e.target).includes('{choice}') || chosen)
    .map((e) => {
      const target = fill(e.target);
      return { ...e, target: target.startsWith('weapon.') ? target.toLowerCase() : target };
    });
  const notes = (entry.notes || []).filter((n) => !n.includes('{choice}') || chosen).map(fill);
  return { effects, notes };
}

const toNumber = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? 0 : Number(v));

/**
 * Copy a library entry onto a character, so the sheet carries what it uses.
 * Called when a player picks something from their shelf.
 */
export function embed(character, kind, entry) {
  const plural = CONTENT_TYPES[kind].plural;
  character.content = character.content || {};
  const list = character.content[plural] = character.content[plural] || [];
  const at = list.findIndex((e) => e.name === entry.name);
  const copy = structuredClone(entry);
  if (at >= 0) list[at] = copy;
  else list.push(copy);
  return copy;
}

/**
 * The homebrew that counts for a character, and what it carries that does not.
 *
 *   independent   everything it carries: its player's own homebrew, embedded
 *   in a campaign the campaign's homebrew, which its GMs write, always - and
 *                 the player's own only if the campaign allows homebrew
 *
 * A campaign's entries are taken from the campaign's library when the app has
 * it (`rules.campaign.content`), not from the copy on the sheet, so what counts
 * is what the GMs wrote, however the sheet's copy was edited. Without the
 * library - offline - the sheet's copies of campaign entries stand in.
 *
 * Nothing is removed from the sheet: an entry that does not count here is kept,
 * listed in `blocked`, and counts again if the character leaves the campaign or
 * the GMs allow homebrew.
 *
 * @returns { content, blocked: [{ kind, name }], campaignNames: Set }
 */
export function usableContent(character, rules) {
  const carried = character?.content || {};
  const campaign = rules?.campaign;
  if (!campaign) return { content: carried, blocked: [], campaignNames: new Set() };

  const fromLibrary = Array.isArray(campaign.content);
  const content = {};
  const blocked = [];
  const campaignNames = new Set();

  for (const kind of CONTENT_KINDS) {
    const plural = CONTENT_TYPES[kind].plural;
    const own = (carried[plural] || []).filter((e) => e && e.name);
    const theirs = fromLibrary
      ? campaign.content.filter((e) => e && e.kind === kind && e.name)
      : own.filter((e) => e.campaign === campaign.id);
    const names = new Set(theirs.map((e) => e.name));
    names.forEach((n) => campaignNames.add(n));

    const rest = own.filter((e) => !names.has(e.name) && e.campaign !== campaign.id);
    // Items made for the inventory (a player's own gear) count wherever the character goes.
    const inventoryItems = rest.filter((e) => e.inventoryItem);
    if (campaign.allowHomebrew) {
      content[plural] = [...rest, ...theirs];
    } else {
      content[plural] = [...inventoryItems, ...theirs];
      for (const e of rest) if (!e.inventoryItem) blocked.push({ kind, name: e.name });
    }
  }
  return { content, blocked, campaignNames };
}

/** Content the character carries that nothing on the sheet refers to. */
export function unusedContent(character) {
  const content = character.content || {};
  const used = new Set([
    character.race?.name,
    ...(character.levels || []).flatMap((l) => [l.a, l.b]),
    ...(character.feats || []).map((f) => f.name),
    ...(character.features || []).map((f) => f.name),
    ...(character.templates || []).map((t) => t.name),
    ...(character.wealth?.items || []).map((i) => i.name),
    ...(character.skills || []).map((s) => s.name),
    ...(character.activeSpells || []).map((a) => a?.name),
    ...spellsKnownBy(character),
  ].filter(Boolean));

  const out = [];
  for (const kind of CONTENT_KINDS) {
    for (const entry of content[CONTENT_TYPES[kind].plural] || []) {
      if (entry.name && !used.has(entry.name)) out.push({ kind, name: entry.name });
    }
  }
  return out;
}

/** Every name a character's casting lists hold - what it knows, has prepared, keeps in a book. */
function spellsKnownBy(character) {
  const out = [];
  const walk = (value) => {
    if (!value) return;
    if (typeof value === 'string') { out.push(value); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (typeof value === 'object') {
      if (typeof value.name === 'string') out.push(value.name);
      for (const [key, inner] of Object.entries(value)) if (key !== 'name' && typeof inner === 'object') walk(inner);
    }
  };
  walk(character.magic);
  return out;
}
