// Feats, traits and flaws, special abilities, and languages: the sheet's
// choices that come from lists, chosen from those lists.
//
// A feat is picked for a slot - the 1st-level feat, a human's bonus feat, a
// fighter's bonus feat - from a dropdown holding only the feats legal there
// (engine/feats.js). What a feat does arrives with it: its effects from
// data/feat-effects.json, its SRD entry a click away. Traits, flaws and
// languages work the same way, from their own indexes. Class features are not
// chosen at all: they are the class table's, listed with their SRD text.

import { h, field, labelled, panel, row, button, refill, total, checkbox } from './dom.js';
import { specialsEditor } from './specials-editor.js';
import { featOptions, featLabel } from '../engine/feats.js';
import { traitsOfKind, traitEligibility } from '../engine/traits.js';
import { featureKey } from '../engine/features.js';
import { describeTarget } from '../engine/effects.js';
import { perLabel } from '../engine/specials.js';
import { nameField, choosesOnly } from './names.js';
import { loadReference, referenceNow, lookUp, referenceHref } from '../reference.js';
import { referenceCard } from './reference.js';

const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];
const ABILITY_CHOICES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
const lower = (s) => String(s || '').trim().toLowerCase();
const sign = (n) => (n < 0 ? String(n) : `+${n}`);

/** Load a reference once, then draw a panel again so its rows can use it. */
function withReference(app, kind, panelKey) {
  if (referenceNow(kind)) return;
  loadReference(kind).then(() => app.rebuildPanel?.(panelKey)).catch(() => {});
}

/** "About <name>": an entry from the reference, opened in place. */
function about(kind, name, label = null) {
  const entry = lookUp(kind, name);
  if (!entry) return null;
  const holder = h('div.row-reference-body');
  const details = h('details.row-reference', h('summary', { text: label || `About ${entry.name}` }), holder);
  details.addEventListener('toggle', () => {
    if (details.open && !holder.firstChild) refill(holder, referenceCard(kind, entry));
  });
  return details;
}

/** A plain dropdown that manages itself, outside the form binding. */
function chooser(label, value, options, onPick, opts = {}) {
  const el = h('select.field', {
    'aria-label': label,
    dataset: { unbound: '' },
    class: opts.className,
    disabled: opts.disabled,
    onchange: (ev) => onPick(ev.target.value),
  },
  h('option', { value: '', text: opts.empty || '- choose -', selected: !value }),
  options.map((o) => (o.group
    ? h('optgroup', { label: o.group }, o.options.map((x) => h('option', { value: x.value, text: x.text, selected: lower(x.value) === lower(value), disabled: x.disabled })))
    : h('option', { value: o.value, text: o.text, selected: lower(o.value) === lower(value), disabled: o.disabled }))));
  return opts.labelled === false ? el : labelled(label, el);
}

/* ==========================================================================
   Feats
   ========================================================================== */

/** What a feat is taken on, for the choice dropdown. */
function choiceOptions(app, rule, plan, current) {
  const equipment = referenceNow('equipment')?.list || [];
  const weapons = (filter) => equipment.filter((e) => e.family === 'Weapons' && e.subcategory !== 'Ammunition' && filter(e)).map((e) => e.name);
  const held = (name) => plan.held.filter((f) => lower(f.name) === lower(name) && f.choice).map((f) => f.choice);
  let list;
  if (rule.choiceFrom) {
    list = held(rule.choiceFrom);
  } else {
    switch (rule.choice) {
      case 'weapon': list = ['Unarmed strike', 'Grapple', 'Ray', ...weapons(() => true)]; break;
      case 'exoticWeapon': list = weapons((e) => e.category === 'Exotic Weapons'); break;
      case 'martialWeapon': list = weapons((e) => e.category === 'Martial Weapons'); break;
      case 'crossbow': list = ['Hand crossbow', 'Light crossbow', 'Heavy crossbow']; break;
      case 'skill': list = [...new Set(app.derived.skills.lines.map((l) => l.label))].sort(); break;
      case 'school': list = SCHOOLS; break;
      case 'energy': list = ['Acid', 'Cold', 'Electricity', 'Fire', 'Sonic']; break;
      case 'alignmentComponent': list = ['Chaos', 'Evil', 'Good', 'Law']; break;
      case 'power': list = (referenceNow('powers')?.list || []).map((p) => p.name); break;
      default: list = [];
    }
  }
  if (current && !list.some((x) => lower(x) === lower(current))) list = [current, ...list];
  return list.map((x) => ({ value: x, text: x }));
}

/** Every feat that could be picked: the SRD's, and the homebrew this character may use. */
function featCatalogue(app) {
  // The variant rules' feats (spelltouched, weapon group) unless a campaign withholds them.
  const srd = (app.rules.featRules || []).filter((f) => !f.variant || app.derived.modules[f.variant]);
  const known = new Set(srd.map((f) => lower(f.name)));
  const homebrew = [
    ...app.derived.index.featByName.values(),
    ...(app.shelfEntries?.('feat') || []),
  ].filter((f) => f?.name && !known.has(lower(f.name)))
    .map((f) => ({ name: f.name, types: [f.category || 'Homebrew'], prerequisite: f.prerequisites || '', homebrew: true }));
  const unique = new Map(homebrew.map((f) => [lower(f.name), f]));
  return [...srd, ...unique.values()];
}

/** What a feat does to the numbers and beyond, in a line. */
function featDoes(app, name, choice) {
  const def = app.rules.featEffects?.feats?.[name];
  if (!def) return null;
  const fill = (text) => String(text).replace(/\{choice\}/g, choice || 'the choice');
  const parts = [
    ...(def.effects || []).map((e) => `${sign(e.value)} ${e.type && e.type !== 'untyped' ? `${e.type} ` : ''}${describeTarget(fill(e.target).toLowerCase().startsWith('weapon.') ? fill(e.target).toLowerCase() : fill(e.target))}${e.condition ? ` ${e.condition}` : ''}`),
    ...(def.notes || []).map(fill),
  ];
  return parts.length ? parts.join('; ') : null;
}

export function featsPanel(app) {
  const c = app.character;
  const d = app.derived;
  const plan = d.featPlan;
  const tf = d.modules.traitsFlaws;
  withReference(app, 'feats', 'feats');
  withReference(app, 'equipment', 'feats');
  if (tf) withReference(app, 'traits', 'feats');
  c.feats = c.feats || [];

  const changed = () => { app.recompute(); app.rebuildPanel('feats'); if (app.panels.abilitiesList) app.rebuildPanel('abilitiesList'); if (app.panels.trackers) app.rebuildPanel('trackers'); };
  const catalogue = featCatalogue(app);

  const setFeat = (slot, name) => {
    if (slot.row !== null && slot.row !== undefined) {
      if (!name) c.feats.splice(slot.row, 1);
      else {
        const was = c.feats[slot.row];
        c.feats[slot.row] = { ...was, name, slot: slot.id, ...(lower(was.name) !== lower(name) ? { choice: null } : {}) };
      }
    } else if (name) {
      c.feats.push({ name, slot: slot.id, choice: null, effects: [] });
    }
    if (name) app.adopt?.('feat', name);
    changed();
  };

  const slotRow = (slot) => {
    const options = featOptions(slot, plan, c, d, app.rules, catalogue);
    const byType = new Map();
    for (const o of options) {
      const type = o.rule.homebrew ? 'Homebrew' : (o.rule.types || ['General']).find((t) => t !== 'General') || 'General';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push({ value: o.name, text: o.check.unchecked.length ? `${o.name} *` : o.name });
    }
    const groups = [...byType.entries()].sort(([a], [b]) => (a === 'General' ? -1 : b === 'General' ? 1 : a.localeCompare(b)))
      .map(([group, list]) => ({ group, options: list.sort((x, y) => x.text.localeCompare(y.text)) }));
    const current = slot.feat?.name || '';
    if (current && !options.some((o) => lower(o.name) === lower(current))) {
      groups.unshift({ group: 'Chosen', options: [{ value: current, text: `${current} (not legal here)` }] });
    }
    const rule = slot.rule;
    const does = slot.feat ? featDoes(app, slot.feat.name, slot.feat.choice) : null;
    return h(`li.feat-slot${slot.check && !slot.check.ok ? '.is-illegal' : ''}${slot.feat ? '' : '.is-open'}`,
      h('div.feat-slot-head',
        h('span.feat-slot-label', { text: slot.label }),
        slot.listLabel ? h('span.hint', { text: slot.listLabel }) : null,
        slot.ignorePrerequisites ? h('span.tag', { text: 'no prerequisites' }) : null),
      h('div.row.feat-slot-choice',
        chooser(`Feat for ${slot.label}`, current, groups, (name) => setFeat(slot, name), { labelled: false, empty: options.length ? '- choose a feat -' : '- none qualify yet -', className: 'grow' }),
        rule?.choice || rule?.choiceFrom
          ? chooser(`${slot.feat.name} applies to`, slot.feat.choice || '', choiceOptions(app, rule, plan, slot.feat.choice), (choice) => {
            c.feats[slot.row].choice = choice || null;
            changed();
          }, { labelled: false, empty: '- applies to -' })
          : null),
      does ? h('p.feat-does', { text: does }) : null,
      slot.check && !slot.check.ok ? h('p.hint.is-error', { text: `Not legal here: ${slot.check.unmet.join('; ')}.` }) : null,
      slot.check?.unchecked.filter((u) => u !== 'not an SRD feat').length
        ? h('p.hint', { text: `The sheet cannot check: ${slot.check.unchecked.filter((u) => u !== 'not an SRD feat').join('; ')}.` })
        : null,
      slot.feat ? about('feats', slot.feat.name) : null);
  };

  // Rows in no slot: homebrew typed in by hand, or more feats than slots.
  const inSlots = new Set(plan.slots.map((s) => s.row).filter((r) => r !== null && r !== undefined));
  const loose = c.feats.map((row, i) => ({ row, i })).filter(({ i }) => !inSlots.has(i));
  const otherHost = h('div.list');
  refill(otherHost, loose.map(({ row: entry, i }) => {
    const fromContent = d.index.featByName.get(entry.name);
    // A feat typed in by hand says what it does here; a custom character's is one that exists.
    const own = !(fromContent || lookUp('feats', entry.name)) && !choosesOnly(app);
    if (own) asSpecials(c.feats[i]);
    return h('div.effect-list-row',
      h('div.list-row',
        nameField(app, `feats.${i}.name`, entry.name, 'feat', { placeholder: 'Homebrew feat', className: 'grow' }),
        button('x', () => { c.feats.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Remove' })),
      own ? rowSpecials(app, `feats.${i}.specials`, () => c.feats[i], 'Benefit', 'Add a benefit') : null);
  }));

  return panel('feats', tf ? 'Feats, traits and flaws' : 'Feats',
    h('div.summary-strip',
      total('Feats earned', 'feats.allowed'),
      total('Taken', 'feats.taken'),
      total('From levels', 'feats.fromLevels'),
      total('Class bonus', 'feats.fromClasses'),
      tf ? total('From flaws', 'feats.fromFlaws') : null,
      h('span.hint', { text: 'Each slot lists only the feats this character qualifies for at the level the slot was gained. What a feat does is counted for you.' })),
    plan.granted.length
      ? h('div.block', h('h3', 'Granted'),
        h('ul.feat-granted', plan.granted.map((g) => h('li',
          h('span.feat-granted-name', { text: featLabel(g.name, g.choice) }),
          h('span.hint', { text: g.source }),
          about('feats', g.name)))))
      : null,
    h('div.block', h('h3', 'Feats'),
      plan.slots.length ? h('ol.feat-slots', plan.slots.map(slotRow)) : h('p.empty', { text: 'No feats yet: choose a class on the Character page.' })),
    h('details.block.feat-other', { open: loose.length > 0 },
      h('summary', loose.length ? `Other feats (${loose.length})` : 'Other feats'),
      h('p.hint', { text: choosesOnly(app)
        ? 'A feat from the SRD or your User Content that fills no slot - one a story gave. Say where it came from in Bonus feats.'
        : 'A homebrew feat, or one a story gave. It fills no slot; say where it came from in Bonus feats.' }),
      otherHost,
      row(
        button(choosesOnly(app) ? 'Add a feat' : 'Add a homebrew feat', () => { c.feats.push({ name: '', slot: 'other', specials: [] }); changed(); }, { subtle: true }),
        labelled('Bonus feats granted', field('featSlots.bonus', c.featSlots?.bonus, { type: 'int', width: '3.5rem', title: 'Feats given by something other than a class or race - a story, a boon. A class’s and a race’s are already counted.' })),
        h('a.hint', { href: '#/content/feat', text: 'Write a feat of your own' }))),
    tf
      ? traitsAndFlaws(app, changed)
      : h('p.hint', { text: app.rules.campaign
        ? 'Traits and flaws (Unearthed Arcana) are off in this campaign.'
        : 'Traits and flaws (Unearthed Arcana) are an optional rule: switch them on under Rules for this character, and each flaw buys a feat.' }));
}

/* ==========================================================================
   Traits and flaws
   ========================================================================== */

function traitsAndFlaws(app, changed) {
  const c = app.character;
  const d = app.derived;
  const limits = app.rules.ruleset.traitsFlaws || app.rules.rulesets?.srd?.traitsFlaws || { traits: 2, flaws: 2 };
  const ctx = d.traitContext;

  const picker = (kind, limit) => {
    const key = kind === 'trait' ? 'traits' : 'flaws';
    c[key] = c[key] || [];
    const known = traitsOfKind(app.rules, kind);
    const rows = [];
    const count = Math.max(limit, c[key].length);
    for (let i = 0; i < count; i++) {
      const entry = c[key][i] || null;
      const def = entry ? known.get(lower(entry.name)) : null;
      if (entry && entry.name && !def) {
        // A trait written before the list existed: kept as it was typed.
        rows.push(h('li.trait-row', h('div.list-row',
          field(`${key}.${i}.name`, entry.name, { className: 'grow' }),
          field(`${key}.${i}.effect`, entry.effect, { placeholder: 'What it does, in a line', className: 'grow wide' }),
          button('x', () => { c[key].splice(i, 1); changed(); }, { subtle: true, danger: true }))));
        continue;
      }
      const taken = new Set(c[key].filter((r, j) => j !== i && r?.name).map((r) => lower(r.name)));
      const options = [...known.values()]
        .filter((t) => t.multiple || !taken.has(lower(t.name)))
        .map((t) => {
          const check = traitEligibility(t, ctx);
          return { value: t.name, text: check.ok ? t.name : `${t.name} (needs ${check.unmet.join('; ')})`, disabled: !check.ok && lower(t.name) !== lower(entry?.name) };
        });
      const set = (name) => {
        if (!name) { if (entry) c[key].splice(i, 1); } else if (entry) c[key][i] = { name, choice: lower(entry.name) === lower(name) ? entry.choice : null };
        else c[key].push({ name, choice: null });
        changed();
      };
      const choice = def?.choice ? traitChoice(app, def, entry, (value) => { c[key][i].choice = value || null; changed(); }) : null;
      rows.push(h('li.trait-row',
        h('div.row',
          chooser(`${kind === 'trait' ? 'Trait' : 'Flaw'} ${i + 1}`, entry?.name || '', options, set, { labelled: false, className: 'grow', empty: `- ${kind === 'trait' ? 'a trait' : 'a flaw'} -` }),
          choice),
        def ? h('p.feat-does', { text: kind === 'trait' ? `${def.benefit} ${def.drawback}` : def.effect }) : null,
        def ? about('traits', def.id || def.name) : null));
    }
    return h('div.block',
      h('h3', kind === 'trait' ? 'Traits' : 'Flaws'),
      h('p.hint', { text: kind === 'trait'
        ? `Up to ${limit}, chosen at 1st level. Each gives a benefit and a matching drawback, both counted on the sheet.`
        : `Up to ${limit}, chosen at 1st level. Each is a penalty, and buys a bonus feat.` }),
      h('ol.trait-rows', rows));
  };

  return h('div.traits-flaws', picker('trait', limits.traits), picker('flaw', limits.flaws));
}

function traitChoice(app, def, entry, onPick) {
  const kind = def.choice.kind;
  let options;
  if (kind === 'ability') options = ABILITY_CHOICES.map(([value, text]) => ({ value, text }));
  else if (kind === 'school') options = SCHOOLS.map((s) => ({ value: s, text: s }));
  else if (kind === 'subjectSkill') {
    options = app.derived.skills.lines.filter((l) => def.choice.skills.includes(l.name) && l.subtype).map((l) => ({ value: l.label, text: l.label }));
    if (!options.length) options = [{ value: '', text: 'Add a Craft, Knowledge or Profession skill first', disabled: true }];
  } else {
    const exclude = new Set(def.choice.exclude || []);
    options = [...new Set(app.derived.skills.lines.map((l) => l.name))].filter((n) => !exclude.has(n)).sort().map((n) => ({ value: n, text: n }));
  }
  return chooser(`${def.name} applies to`, entry?.choice || '', options, onPick, { labelled: false, empty: '- applies to -' });
}

/* ==========================================================================
   Special abilities: class features, racial traits, and what is not a number
   ========================================================================== */

/** A class's feature descriptions, from its SRD text, by feature key. */
const descriptionCache = new Map();
function classDescriptions(className) {
  if (descriptionCache.has(className)) return descriptionCache.get(className);
  const cls = lookUp('classes', className);
  if (!cls?.text) return null;
  const sections = [];
  let current = null;
  for (const chunk of cls.text.split(/(?=<p>)/)) {
    const head = chunk.match(/^<p><b>([^<]+?)<\/b>/);
    if (head) {
      const title = head[1].replace(/:\s*$/, '').replace(/\s*\((Ex|Su|Sp)\)\s*$/i, '').trim();
      current = { title, key: featureKey(title), html: chunk };
      sections.push(current);
    } else if (current && !/^<p><h5>/.test(chunk)) {
      current.html += chunk;
    } else {
      current = null;
    }
  }
  descriptionCache.set(className, sections);
  return sections;
}

function featureDescription(className, key) {
  const sections = classDescriptions(className);
  if (!sections) return null;
  return sections.find((s) => s.key === key)
    || sections.find((s) => s.key.startsWith(key) || key.startsWith(s.key))
    || sections.find((s) => s.key.includes(key))
    || null;
}

/**
 * A row typed onto the sheet, written before rows carried special abilities:
 * its line of text, its uses and its effects become one ability, so the row
 * is edited in the same shape as everything else. Changes the row in place.
 */
function asSpecials(row) {
  if (!row || Array.isArray(row.specials)) return row;
  const text = String(row.effect || '').trim();
  const effects = Array.isArray(row.effects) ? row.effects : [];
  const uses = Number(row.uses) > 0 ? Number(row.uses) : null;
  row.specials = text || effects.length || uses
    ? [{ name: '', type: '', text, uses, usesPer: row.usesPer || 'day', effects }]
    : [];
  delete row.effect;
  delete row.effects;
  delete row.uses;
  delete row.usesPer;
  delete row.usesUsed;
  return row;
}

/** The ability editor for one row on the sheet, folded away until it is wanted. */
function rowSpecials(app, path, getRow, label, add) {
  const list = getRow().specials || [];
  const summary = () => (list.length ? `${label} (${list.length})` : label);
  const details = h('details.row-effects', { open: list.length > 0 },
    h('summary', { text: summary() }),
    specialsEditor(path, () => (getRow().specials = getRow().specials || []), {
      skillNames: app.derived.index.skills.map((x) => x.name),
      featNames: app.contentNames?.('feat'),
      addLabel: add,
      emptyText: 'Nothing yet. Add one and it shows under Special abilities, with its uses tracked and its bonuses counted.',
      onShapeChange: () => {
        details.querySelector('summary').textContent = (getRow().specials || []).length ? `${label} (${getRow().specials.length})` : label;
        app.recompute();
        app.rebuildPanel('abilitiesList');
        if (app.panels.trackers) app.rebuildPanel('trackers');
      },
    }));
  return details;
}

/** "+2 racial Spot; +4 racial Hide (in rocky terrain)": an ability's bonuses in words. */
const bonusesInWords = (effects) => effects.map((e) => {
  const value = Number(e.value) || 0;
  const type = e.type && e.type !== 'untyped' ? ` ${e.type}` : '';
  return `${sign(value)}${type} ${describeTarget(e.target)}${e.perLevel ? ' per HD' : ''}${e.condition ? ` (${e.condition})` : ''}`;
}).join('; ');

/**
 * One special ability as the sheet shows it: its name with its mark, its DC,
 * what it does, its bonuses, and - when it has uses - how many are spent, which
 * the player can change, and a button to have them all back.
 */
function specialRow(app, s, ways) {
  const uses = s.uses > 0 ? usesTracker(s, ways) : null;
  return h(`li.ability-row.special-row${s.used > s.uses && s.uses > 0 ? '.is-over' : ''}`,
    h('div.ability-row-head',
      h('span.ability-row-name', s.name, s.mark ? h('span.special-mark', { text: ` (${s.mark})`, title: s.typeLabel }) : null),
      s.dc ? h('span.tag.special-dc', { text: `DC ${s.dc.dc}${s.dc.save ? ` ${s.dc.save}` : ''}`, title: s.dc.formula }) : null,
      s.level ? h('span.hint', { text: `level ${s.level}` }) : null,
      // A race's traits and a class's features are under their name already.
      s.kind !== 'race' && s.kind !== 'class' && s.holder && s.holder !== s.name ? h('span.hint', { text: s.holder }) : null,
      s.kind !== 'race' && s.kind !== 'class' && s.holderSource ? h('span.hint', { text: s.holderSource }) : null),
    s.text ? h('p.special-text', { text: s.text }) : null,
    s.effects.length ? h('p.hint.special-effects', { text: bonusesInWords(s.effects) }) : null,
    s.feat ? h('p.hint.special-feat-line', { text: `Grants the feat ${featLabel(s.feat.name, s.feat.choice)}.` }) : null,
    uses);
}

/** "[1] used / 3 per day  Reset". */
function usesTracker(s, ways) {
  const input = h('input.field.special-used', {
    type: 'number',
    min: 0,
    max: s.uses,
    value: s.used,
    'aria-label': `${s.name}: uses spent`,
    dataset: { unbound: '' },
    onchange: (ev) => {
      const used = Math.max(0, Math.floor(Number(ev.target.value) || 0));
      ways.setUsed?.({ key: s.key }, used, { from: 'abilitiesList' });
    },
  });
  return h('div.special-track',
    input,
    h('span.special-track-of', { text: ` used / ${s.uses} ${perLabel(s.usesPer)}` }),
    h('button.btn.subtle', {
      type: 'button',
      title: 'Every use back.',
      onclick: () => {
        input.value = 0;
        ways.setUsed?.({ key: s.key }, 0, { from: 'abilitiesList' });
      },
    }, 'Reset'));
}

export function abilitiesListPanel(app, ways = {}) {
  const d = app.derived;
  const c = app.character;
  withReference(app, 'classes', 'abilitiesList');
  const changed = () => { app.recompute(); app.rebuildPanel('abilitiesList'); if (app.panels.trackers) app.rebuildPanel('trackers'); };

  const byClass = new Map();
  for (const f of d.classFeatures || []) {
    if (!byClass.has(f.className)) byClass.set(f.className, []);
    byClass.get(f.className).push(f);
  }
  const trackerFor = (f) => (d.trackers || []).find((t) => (t.source === f.className && featureKey(t.name).startsWith(f.key)) || (f.domain && t.source === `${f.domain} domain`));

  const featureRow = (f) => {
    const tracker = trackerFor(f);
    const desc = f.domain ? null : featureDescription(f.className, f.key);
    const body = h('div.row-reference-body');
    const details = f.domain || desc
      ? h('details.row-reference', h('summary', { text: 'What it does' }), body)
      : null;
    details?.addEventListener('toggle', () => {
      if (!details.open || body.firstChild) return;
      if (f.domain) refill(body, referenceCard('domains', lookUp('domains', f.domain)) || h('p', { text: f.text }));
      else refill(body, h('div.reference-text', { html: desc.html }));
    });
    const step = f.latest && lower(f.latest) !== lower(f.name) ? f.latest : null;
    return h('li.ability-row',
      h('div.ability-row-head',
        h('span.ability-row-name', { text: f.name }),
        step && !f.domain ? h('span.tag', { text: step.replace(new RegExp(`^${f.key}\\s*`, 'i'), '') || step }) : null,
        h('span.hint', { text: f.domain ? 'granted power' : `from ${f.className} ${f.gained}` }),
        tracker
          ? h('span.tag', app.wizard
            ? { text: `${tracker.max}${tracker.unit ? ` ${tracker.unit}` : ''} ${perLabel(tracker.per)}` }
            : { text: `${tracker.remaining} of ${tracker.max}${tracker.unit ? ` ${tracker.unit}` : ''} left`, title: 'Tracked under Limited uses.' })
          : null),
      f.domain ? h('p.hint', { text: f.text }) : null,
      details);
  };

  // Special abilities, grouped as the sheet lists them: a class's features
  // under the class, everything else under where it came from.
  const specials = d.specials || [];
  const groups = new Map();
  for (const sp of specials) {
    const heading = sp.kind === 'class' ? `${sp.holder} features` : sp.group;
    if (!groups.has(heading)) groups.set(heading, []);
    groups.get(heading).push(sp);
  }
  const raceHasSpecials = specials.some((sp) => sp.kind === 'race');
  const racial = raceHasSpecials ? null : d.race?.traits;
  const notes = d.specialNotes || [];

  return panel('abilitiesList', 'Special abilities',
    byClass.size
      ? [...byClass.entries()].map(([className, list]) => h('div.block',
        h('h3', { text: `${className} features` }),
        h('ul.ability-rows', list.map(featureRow))))
      : (groups.size ? null : h('p.empty', { text: 'No class features yet. They fill in from the class tables as levels are taken.' })),
    racial ? h('div.block', h('h3', { text: `${d.race.name} traits` }), h('p', { text: racial })) : null,
    [...groups.entries()].map(([heading, list]) => h('div.block',
      h('h3', heading, ['race', 'class'].includes(list[0].kind) && list[0].holderSource ? h('span.hint.group-source', { text: ` ${list[0].holderSource}` }) : null),
      h('ul.ability-rows', list.map((sp) => specialRow(app, sp, ways))))),
    notes.length
      ? h('div.block', h('h3', 'From feats, traits and flaws'),
        h('ul.ability-rows', notes.map((n) => h('li.ability-row', h('div.ability-row-head', h('span.ability-row-name', { text: n.source }), h('span.hint', { text: n.kind })), h('p', { text: n.text })))))
      : null,
    h('div.block.situational',
      h('h3', 'Situational modifiers'),
      h('p.hint', { text: 'In no total: each applies only when its condition is met. Add it to the roll when it is.' }),
      h('ul.conditions.situational-list', { dataset: { conditionsFor: 'all' } })),
    activeSpellsBlock(app, changed),
    h('details.block', { open: (c.features || []).some((f) => f?.name) },
      h('summary', 'Misc features'),
      h('p.hint', { text: 'A boon, a bloodline, a curse - anything else the character has. Pick one from User Content by name, or write its abilities here: give one bonuses and they count, give it uses and they are tracked.' }),
      miscFeatureRows(app, changed),
      row(
        button('Add a misc feature', () => { c.features = c.features || []; c.features.push({ name: '', specials: [] }); changed(); }, { subtle: true }),
        h('a.hint', { href: '#/content/feature', text: 'Write one in User Content' }))));
}

/** Misc features typed onto the sheet, each with its abilities. */
function miscFeatureRows(app, changed) {
  const c = app.character;
  return h('div.list', (c.features || []).map((entry, i) => {
    const fromContent = app.derived.index.featureByName?.get(entry.name);
    asSpecials(c.features[i]);
    return h('div.effect-list-row',
      h('div.list-row',
        nameField(app, `features.${i}.name`, entry.name, 'feature', { placeholder: 'Misc feature', className: 'grow' }),
        fromContent ? h('span.hint', { text: 'from User Content' }) : null,
        button('x', () => { c.features.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Remove' })),
      // A custom character's misc features are the ones in User Content, as they are written there.
      choosesOnly(app) ? null : rowSpecials(app, `features.${i}.specials`, () => c.features[i], fromContent ? 'More abilities' : 'Abilities', 'Add an ability'));
  }));
}

/**
 * Spells and powers in effect on the character - a bull's strength, a bless,
 * a power it manifested on itself. Each is switched on while it lasts, and
 * its effects count; switched off, it waits for next time.
 */
function activeSpellsBlock(app, changed) {
  const c = app.character;
  c.activeSpells = Array.isArray(c.activeSpells) ? c.activeSpells : [];
  const carried = [...(app.derived.index.spellByName?.values() || [])];
  const shelf = app.shelfEntries?.('spell') || [];
  const known = new Map([...shelf, ...carried].filter((sp) => sp?.name).map((sp) => [sp.name, sp]));
  const listed = new Set(c.activeSpells.map((a) => a?.name));
  const options = [...known.values()]
    .filter((sp) => !listed.has(sp.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((sp) => ({ value: sp.name, text: `${sp.name}${sp.mode === 'power' ? ' (power)' : ''}` }));

  return h('div.block.active-spells',
    h('h3', 'Spells and powers in effect'),
    c.activeSpells.length
      ? h('ul.active-spell-list', c.activeSpells.map((a, i) => h('li.active-spell',
        checkbox(`activeSpells.${i}.on`, a.on !== false, a.name, { title: 'While it lasts: switched on, its effects count.' }),
        known.get(a.name)?.duration ? h('span.hint', { text: known.get(a.name).duration }) : null,
        button('x', () => { c.activeSpells.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Take it off the list' }))))
      : h('p.hint', { text: known.size ? 'None in effect.' : 'A spell or power written in User Content with effects can be switched on here while it lasts.' }),
    known.size
      ? chooser('Put a spell or power in effect', '', options, (name) => {
        if (!name) return;
        app.adopt?.('spell', name);
        c.activeSpells.push({ name, on: true });
        changed();
      }, { labelled: false, empty: options.length ? '- a spell or power -' : '- every one is listed -', disabled: !options.length })
      : null);
}

/* ==========================================================================
   Languages
   ========================================================================== */

export function languagesPanel(app) {
  const c = app.character;
  const plan = app.derived.languages;
  withReference(app, 'languages', 'languages');
  const changed = () => { app.recompute(); app.rebuildPanel('languages'); };
  c.languages = Array.isArray(c.languages) ? c.languages : [];

  const chip = (name, tag, remove) => h('li.language-chip',
    h('a', { href: referenceHref('languages', name), text: name }),
    tag ? h('span.tag', { text: tag }) : null,
    remove ? button('x', remove, { subtle: true, danger: true, title: `Forget ${name}` }) : null);

  const left = (plan.bonusAllowed - plan.bonusUsed) + (plan.skillAllowed - plan.skillUsed);
  return panel('languages', 'Languages',
    h('div.summary-strip',
      h('div.total', h('span.label', { text: 'Bonus languages' }), h('span.out', { text: `${plan.bonusUsed} of ${plan.bonusAllowed}` })),
      h('div.total', h('span.label', { text: 'From Speak Language' }), h('span.out', { text: `${plan.skillUsed} of ${plan.skillAllowed}` })),
      h('span.hint', { text: 'One bonus language per point of Intelligence bonus at 1st level, from the lists below; each rank of Speak Language buys any language but a secret one.' })),
    h('ul.language-chips',
      plan.automatic.map((name) => chip(name, 'automatic')),
      plan.chosen.map((x) => chip(x.name, x.via === 'bonus' ? 'bonus' : x.via === 'skill' ? 'Speak Language' : 'not legal', () => {
        c.languages = c.languages.filter((n) => lower(n) !== lower(x.name));
        changed();
      }))),
    row(
      chooser('Learn a language', '', plan.available.map((n) => ({ value: n, text: n })), (name) => {
        if (!name) return;
        c.languages.push(name);
        changed();
      }, { disabled: !left || !plan.available.length, empty: left ? '- a language -' : '- none left to learn -' }),
      h('span.hint', { text: plan.bonusFrom === 'any'
        ? 'Bonus languages: any but a secret one.'
        : `Bonus languages: ${plan.bonusFrom.join(', ') || 'none'}.` })),
    plan.illiterate ? h('p.hint', { text: 'A barbarian is illiterate: the languages are spoken, not read.' }) : null,
    c.text?.languages ? h('p.hint', { text: `Written before: ${c.text.languages}` }) : null);
}
