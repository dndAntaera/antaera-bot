// Special abilities: what a piece of content does, written in one shape.
//
// A race's traits, a class's features, a feat's benefit, an item's powers, a
// template's grants, a misc feature, a spell's effect on whoever it is cast
// on - every one of them is a list of these, and the sheet reads them all the
// same way:
//
//   { name: 'Stonecunning', type: 'ex', text: '...', effects: [...] }
//   { name: 'Rage', type: 'ex', level: 1, uses: 1, usesPer: 'day', effects: [...] }
//   { name: 'Breath weapon', type: 'su', save: 'ref', dcAbility: 'con', uses: 1, usesPer: 'day' }
//   { name: 'Darkness', type: 'sla', spellLevel: 2, uses: 3, usesPer: 'day' }
//
//   type        '' | 'ex' | 'sla' | 'su', marked (Ex), (SLA) or (Su) by the name
//   level       for a class's features, the class level it is gained at
//   uses        how many times it may be used each `usesPer`; empty is untracked
//   usesPer     'round' | 'encounter' | 'hour' | 'day' | 'week' | 'month'
//   save        the save it allows: 'fort', 'ref', 'will', 'none', or unstated
//   spellLevel  a spell-like ability's spell level, which its DC is built on
//   dcAbility   the ability a supernatural ability's DC is built on
//   effects     what it changes on the sheet: effects, as engine/effects.js has
//               them, a condition making one situational
//
// The DCs are the SRD's, from Special Abilities:
//
//   spell-like     10 + the level of the spell it duplicates + Charisma modifier
//   supernatural   10 + half the creature's hit dice + the ability's modifier,
//                  Charisma unless the ability says otherwise
//
// Pure: no DOM, no fetch.

import { num, floorDiv, signed } from './util.js';

export const SPECIAL_TYPES = {
  ex: { label: 'Extraordinary', mark: 'Ex' },
  sla: { label: 'Spell-Like', mark: 'SLA' },
  su: { label: 'Supernatural', mark: 'Su' },
};

/** How often a use comes back, in the order a player thinks of them. */
export const USES_PER = [
  ['day', 'Per Day'],
  ['week', 'Per Week'],
  ['encounter', 'Per Encounter'],
  ['round', 'Per Round'],
  ['hour', 'Per Hour'],
  ['month', 'Per Month'],
];

/**
 * What each kind of reset gives back. A night's rest restores anything that
 * comes back sooner than a day; a new week, everything but a month's; the end
 * of an encounter, only what is counted by the encounter or the round.
 */
export const RESETS = {
  encounter: new Set(['round', 'encounter']),
  day: new Set(['round', 'encounter', 'hour', 'day']),
  week: new Set(['round', 'encounter', 'hour', 'day', 'week']),
};

export const SPECIAL_SAVES = [['', 'Unstated'], ['fort', 'Fortitude'], ['ref', 'Reflex'], ['will', 'Will'], ['none', 'No save']];
const SAVE_NAMES = { fort: 'Fortitude', ref: 'Reflex', will: 'Will' };
const ABILITY_SHORT = { str: 'Str', dex: 'Dex', con: 'Con', int: 'Int', wis: 'Wis', cha: 'Cha' };

/** "per day" for 'day', as a tracker reads: "1 used / 3 per day". */
export const perLabel = (per) => (USES_PER.find(([key]) => key === per)?.[1] || `Per ${per || 'day'}`).replace(/^Per /, 'per ');

/** (Ex), (SLA), (Su) - or nothing, for an ability nobody has classed. */
export const specialMark = (special) => SPECIAL_TYPES[special?.type]?.mark || null;

/** A new, empty special ability, as the editor adds one. */
export const blankSpecial = (extra = {}) => ({ name: '', type: '', text: '', uses: null, usesPer: 'day', effects: [], ...extra });

/** Whether a special has anything in it at all. */
const filled = (s) => s && (String(s.name || '').trim() || String(s.text || '').trim() || (s.effects || []).length || num(s.uses) > 0);

/**
 * The specials of a holder that are in force: all of them, or for a class,
 * those gained by the class level it has.
 */
export function activeSpecials(holder, level = Infinity) {
  return (holder?.specials || []).filter((s) => filled(s) && !(num(s.level) > level));
}

/** Where an effect of a special came from, as the sheet lists it. */
export const specialSource = (holderName, special) => {
  const name = String(special?.name || '').trim();
  if (!holderName) return name || 'unknown';
  return name && name.toLowerCase() !== String(holderName).toLowerCase() ? `${holderName}: ${name}` : holderName;
};

/** The effects of a holder's specials in force, each labelled with its special. */
export function effectsOfSpecials(holder, level = Infinity) {
  const out = [];
  for (const special of activeSpecials(holder, level)) {
    for (const effect of special.effects || []) {
      if (effect && effect.target) out.push({ ...effect, source: effect.source || specialSource(holder?.name, special) });
    }
  }
  return out;
}

/**
 * A special ability's save DC, by the SRD's rules, and how it was reached.
 *
 * @param ctx { hitDice, mods: { str, dex, ... } }
 * @returns { dc, save, formula } or null when the ability has none
 */
export function specialDC(special, ctx) {
  if (!special || special.save === 'none') return null;
  const mods = ctx?.mods || {};
  const save = SAVE_NAMES[special.save] || null;
  if (special.type === 'sla') {
    if (special.spellLevel === '' || special.spellLevel === null || special.spellLevel === undefined) return null;
    const level = Math.max(0, num(special.spellLevel));
    const cha = num(mods.cha);
    return { dc: 10 + level + cha, save, formula: `10 + spell level ${level} + Cha ${signed(cha)}` };
  }
  if (special.type === 'su') {
    const key = ABILITY_SHORT[special.dcAbility] ? special.dcAbility : 'cha';
    const half = floorDiv(Math.max(0, num(ctx?.hitDice)), 2);
    const mod = num(mods[key]);
    return { dc: 10 + half + mod, save, formula: `10 + half HD ${half} + ${ABILITY_SHORT[key]} ${signed(mod)}` };
  }
  return null;
}

/** The key a special's uses are kept under, in character.trackers. */
export const specialKey = (sourceKind, holderName, special, i) =>
  `special:${sourceKind}:${holderName || ''}:${String(special?.name || '').trim() || `#${i + 1}`}`;

/**
 * Every special ability a character has, from everything it is and carries.
 *
 * @param groups  [{ kind, label, holders: [{ name, specials, classLevel?, source? }] }]
 *                from derive, in the order the sheet lists them
 * @param ctx     { hitDice, mods, used: character.trackers }
 * @returns [{ key, kind, group, holder, name, mark, typeLabel, text, uses,
 *             usesPer, used, remaining, dc, effects, level }]
 */
export function characterSpecials(groups, ctx) {
  const out = [];
  const seen = new Map();
  for (const group of groups) {
    for (const holder of group.holders || []) {
      activeSpecials(holder, holder.classLevel ?? Infinity).forEach((special, i) => {
        let key = specialKey(group.kind, holder.name, special, i);
        const n = seen.get(key) || 0;
        seen.set(key, n + 1);
        if (n) key = `${key}#${n + 1}`;
        const uses = Math.max(0, Math.floor(num(special.uses)));
        const used = Math.max(0, num(ctx?.used?.[key]));
        out.push({
          key,
          kind: group.kind,
          group: group.label,
          holder: holder.name || '',
          holderSource: holder.source || '',
          name: String(special.name || '').trim() || holder.name || 'Unnamed',
          type: special.type || '',
          mark: specialMark(special),
          typeLabel: SPECIAL_TYPES[special.type]?.label || null,
          text: String(special.text || '').trim(),
          level: num(special.level) || null,
          uses,
          usesPer: special.usesPer || 'day',
          used,
          remaining: uses - used,
          dc: specialDC(special, ctx),
          effects: (special.effects || []).filter((e) => e && e.target),
        });
      });
    }
  }
  return out;
}

/** The specials with uses to count, as the trackers list them. */
export function specialTrackers(specials) {
  return specials.filter((s) => s.uses > 0).map((s) => ({
    key: s.key,
    name: s.name,
    source: s.holder && s.holder !== s.name ? s.holder : s.group,
    max: s.uses,
    used: s.used,
    remaining: s.remaining,
    per: s.usesPer,
    unit: null,
    special: true,
  }));
}

/**
 * An entry written before specials existed, in their shape: its traits, its
 * features, its benefit, its uses and its effects, gathered into one special
 * so nothing it said or did is lost. Returns the entry unchanged when it has
 * specials already.
 *
 * @param kind  the content kind, which says where the old fields were
 */
export function withSpecials(entry, kind) {
  if (!entry || Array.isArray(entry.specials) || kind === 'skill') return entry;
  const out = { ...entry, specials: [] };
  const text = {
    race: entry.traits, template: entry.traits, class: entry.features,
    feat: entry.benefit, feature: entry.description,
  }[kind] ?? '';
  const effects = Array.isArray(entry.effects) ? entry.effects : [];
  const uses = num(entry.uses) > 0 ? num(entry.uses) : null;
  if (String(text || '').trim() || effects.length || uses) {
    out.specials.push(blankSpecial({
      text: String(text || ''),
      effects: [...effects],
      uses,
      usesPer: entry.usesPer || 'day',
      ...(kind === 'class' ? { level: 1 } : {}),
    }));
  }
  // What moved is taken off the entry, so it is not counted twice.
  if (kind === 'race' || kind === 'template') delete out.traits;
  if (kind === 'class') delete out.features;
  if (kind === 'feat') delete out.benefit;
  if (kind === 'feature') delete out.description;
  delete out.effects;
  delete out.uses;
  delete out.usesPer;
  if (kind === 'feature' && entry.from && !entry.source) out.source = entry.from;
  delete out.from;
  return out;
}
