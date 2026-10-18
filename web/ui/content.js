// User Content: where players write what the SRD does not have.
//
// Every kind of content is drawn by the same editor, from its description in
// engine/library.js. Nothing in this file knows what a race is, or a feat; it
// knows how to draw a text field, a number, a dropdown, six ability boxes and a
// list of special abilities (ui/specials-editor.js), and the description says
// which of those an entry needs. A spell or power is the one kind laid out
// differently: as the books print one, a stat block from its name down.

import {
  h, field, select, checkbox, textarea, button, refill, bindForm,
} from './dom.js';
import { specialsEditor } from './specials-editor.js';
import { effectsEditor } from './effects-editor.js';
import {
  CONTENT_TYPES, CONTENT_KINDS, blankEntry, SPELL_SCHOOLS, SPELL_SUBSCHOOLS, DISCIPLINES, SUBDISCIPLINES, CASTING_STYLES,
} from '../engine/library.js';
import { levelLabel, listLevels } from '../engine/magic.js';
import { loadReference, referenceNow } from '../reference.js';
import { TARGETS } from '../engine/effects.js';
import { withSpecials, SPECIAL_TYPES } from '../engine/specials.js';
import { CREATURE_TYPES, CREATURE_SUBTYPES } from '../engine/creatures.js';
import { slotKeyFor } from '../engine/inventory.js';
import { library } from '../store.js';

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** The player's own library, as showContent draws it. */
function personalSource(app) {
  return {
    shelf: library,
    base: '#/content',
    heading: 'User Content',
    intro: 'Anything the SRD does not have. Write it once here, pick it by name on any of your own characters, and it counts - its numbers and its abilities, not just its name. In a campaign, only the campaign\u2019s homebrew counts, unless its GMs allow yours.',
    where: app.user
      ? `Saved to your account, ${app.user.name}. It counts on your own characters outside campaigns.`
      : 'Kept in this browser. Export it to share or back it up.',
    switcher: [],
  };
}

// Only one page listens for failed campaign saves at a time.
let listening = null;

/**
 * Draw a library for one kind, with one entry open for editing.
 *
 * @param main    the element to draw into
 * @param app     for the rules (sizes, skill names) and navigation
 * @param kind    'race' | 'class' | ...
 * @param at      index of the open entry, or null
 * @param source  which library: { shelf, base, heading, intro, where, switcher },
 *                over the player's own - pass only what differs
 */
export function showContent(main, app, kind = 'race', at = null, source = null) {
  const src = { ...personalSource(app), ...(source || {}) };
  const { shelf: store } = src;
  if (!CONTENT_TYPES[kind]) kind = 'race';
  const type = CONTENT_TYPES[kind];
  const shelf = store.load();
  const entries = shelf[type.plural];
  const index = at === null || at === undefined || at === '' ? null : Number(at);
  const open = index !== null && entries[index] ? entries[index] : null;

  const go = (k, i = null) => { location.hash = `${src.base}/${k}${i === null ? '' : `/${i}`}`; };

  const failure = h('p.banner.fail', { hidden: true });
  listening?.abort();
  listening = new AbortController();
  window.addEventListener('campaign-library-failed', (ev) => {
    if (ev.detail?.campaignId !== store.campaignId) return;
    failure.textContent = `Not saved to the campaign: ${ev.detail.message}.`;
    failure.hidden = false;
  }, { signal: listening.signal });

  const tabs = h('nav.content-tabs', CONTENT_KINDS.map((k) => h('a.content-tab', {
    href: `${src.base}/${k}`,
    class: k === kind ? 'is-active' : '',
  }, CONTENT_TYPES[k].tab || CONTENT_TYPES[k].label, h('span.count', { text: String(shelf[CONTENT_TYPES[k].plural].length) }))));

  const list = h('ul.content-list', entries.length
    ? entries.map((entry, i) => h('li', h('a.content-item', {
      href: `${src.base}/${kind}/${i}`,
      class: i === index ? 'is-active' : '',
    },
    h('span.content-item-name', { text: entry.name || `Unnamed ${type.label.toLowerCase()}` }),
    h('span.content-item-meta', { text: summaryLine(kind, entry) }))))
    : h('li.hint', { text: `No ${type.plural} yet.` }));

  const create = button(`New ${type.label.toLowerCase()}`, () => {
    const fresh = store.load();
    fresh[type.plural].push({ ...blankEntry(kind), created: new Date().toISOString() });
    store.save(fresh);
    go(kind, fresh[type.plural].length - 1);
  });

  refill(main, h('div.content-page',
    src.switcher.length > 1
      ? h('nav.library-switch', { 'aria-label': 'Libraries' }, src.switcher.map((s) => h('a.library-choice', {
        href: s.href, class: s.active ? 'is-active' : '',
      }, s.label)))
      : null,
    h('div.content-head',
      h('div',
        h('h1', { text: src.heading }),
        h('p.hint', { text: src.intro }),
        h('p.hint.content-where', { text: src.where })),
      h('div.content-actions',
        button('Export all', () => exportLibrary(store), { subtle: true, title: 'Download every entry as one file.' }),
        importControl(store, () => showContent(main, app, kind, index, source)))),
    failure,
    tabs,
    h('div.content-body',
      h('aside.content-side',
        h('p.content-blurb', { text: type.blurb }),
        create,
        list),
      open
        ? editor(app, store, kind, index, open, go)
        : h('div.content-empty',
          h('p', { text: entries.length ? `Choose a ${type.label.toLowerCase()} to edit.` : `Start with New ${type.label.toLowerCase()}.` }),
          effectsPrimer()))));
}

/** The line under an entry's name in the list: its most telling numbers. */
function summaryLine(kind, entry) {
  const e = migrate(kind, entry);
  const n = (e.specials || []).filter((sp) => sp?.name || sp?.text || (sp?.effects || []).length).length;
  const abilities = n ? `${n} ${{ race: 'trait', template: 'trait', class: 'feature' }[kind] || 'ability'}${n === 1 ? '' : 's'}` : '';
  const kindOf = [e.type, e.subtype ? `(${e.subtype})` : ''].filter(Boolean).join(' ');
  const parts = {
    race: [kindOf, e.size, e.la ? `LA +${e.la}` : '', abilities],
    template: [kindOf, e.la ? `LA +${e.la}` : '', abilities],
    class: [e.hd ? `d${e.hd}` : '', e.bab, e.prestige ? 'prestige' : '', abilities],
    skill: [e.ability ? e.ability.toUpperCase() : '', e.trainedOnly ? 'trained only' : ''],
    item: [e.slot, e.value ? `${Number(e.value).toLocaleString()} gp` : '', abilities],
    spell: [e.mode === 'power' ? 'power' : 'spell', e.school, e.level],
  }[kind] || [abilities];
  return [...parts, e.source].filter(Boolean).join(' - ');
}

/**
 * An entry as the editor draws it: one written before special abilities in
 * their shape, an item's typed slot as the slot it names. Nothing is saved
 * until the entry is next changed.
 */
function migrate(kind, entry) {
  const out = withSpecials(entry, kind);
  if (kind === 'item' && out.slot) return { ...out, slot: slotKeyFor(out.slot) };
  if (kind === 'class' && out.spellcaster === undefined && out.casting?.ability) return { ...out, spellcaster: true };
  // A spell or power's effect on whoever it is on is one list of bonuses, in its card.
  if (kind === 'spell' && (out.specials || []).length > 1) {
    return { ...out, specials: [{ name: '', type: '', text: '', effects: out.specials.flatMap((sp) => sp?.effects || []) }] };
  }
  return out;
}

/* ==========================================================================
   The editor
   ========================================================================== */

function editor(app, store, kind, index, stored, go) {
  const type = CONTENT_TYPES[kind];
  const entry = migrate(kind, stored);
  const sizes = app.rules.core.sizes.map((s) => s.name);
  const skillNames = app.rules.skills.skills.map((s) => s.name)
    .concat(store.list('skill').map((s) => s.name).filter(Boolean));
  // What the other entries on the shelf already use, offered beside the SRD's own lists.
  const inUse = (key) => [...new Set([...store.list('race'), ...store.list('template')].map((e) => e?.[key]).filter(Boolean))];
  const lists = {
    sizes,
    types: [...new Set([...CREATURE_TYPES, ...inUse('type')])],
    subtypes: [...new Set([...CREATURE_SUBTYPES, ...inUse('subtype')])].sort((a, b) => a.localeCompare(b)),
  };

  // The feats an ability may grant: the SRD's, and this library's own.
  const featNames = [...new Set([...(app.rules.featRules || []).map((f) => f.name), ...store.list('feat').map((f) => f.name).filter(Boolean)])]
    .sort((a, b) => a.localeCompare(b));

  const status = h('span.status', { text: 'saved' });
  let timer = null;

  const specials = (f) => h('section.content-specials',
    h('h3', { text: f.label }),
    f.hint ? h('p.hint', { text: f.hint }) : null,
    specialsEditor(f.key, () => (entry[f.key] = entry[f.key] || []), {
      skillNames,
      featNames,
      level: Boolean(f.level),
      addLabel: f.add,
      emptyText: `None yet. ${f.add || 'Add one'} and it shows on the sheet of anyone who takes this.`,
      onShapeChange: () => persist(),
    }));

  // A class's spells or powers: drawn again when Spellcaster or Manifester is ticked.
  const magic = type.fields.some((f) => f.type === 'magic') ? magicSection(app, store, entry, () => persist()) : null;

  const body = type.layout === 'statblock'
    ? statblock(entry, type, () => persist(), featNames, skillNames)
    : [
      h('div.content-fields', type.fields.filter((f) => f.type !== 'specials' && f.type !== 'magic').map((f) => fieldFor(f, entry, lists))),
      magic?.host,
      type.fields.filter((f) => f.type === 'specials').map(specials),
    ];

  const form = h('form.content-form', { onsubmit: (ev) => ev.preventDefault() },
    h('div.content-form-head',
      h('h2', { text: entry.name || `New ${type.label.toLowerCase()}` }),
      status),
    body,
    h('div.content-form-actions',
      button('Duplicate', () => {
        const shelf = store.load();
        const stamp = new Date().toISOString();
        const copy = { ...structuredClone(entry), id: undefined, name: `${entry.name || 'Unnamed'} (copy)`, created: stamp, updated: stamp };
        shelf[type.plural].push(copy);
        store.save(shelf);
        go(kind, shelf[type.plural].length - 1);
      }, { subtle: true }),
      button('Download', () => download(`${slug(entry.name || kind)}.json`, { ...entry, kind }), { subtle: true, title: 'Just this one, as a file.' }),
      button('Delete', () => {
        if (!confirm(`Delete ${entry.name || 'this entry'} from this library? Characters already using it keep their own copy.`)) return;
        const shelf = store.load();
        shelf[type.plural].splice(index, 1);
        store.save(shelf);
        go(kind);
      }, { subtle: true, danger: true })));

  // The editor saves its own model - the library entry - rather than a
  // character, which is why it binds a form of its own.
  function persist() {
    status.textContent = 'editing';
    clearTimeout(timer);
    timer = setTimeout(() => {
      const shelf = store.load();
      entry.kind = kind;
      entry.updated = new Date().toISOString();
      shelf[type.plural][index] = entry;
      store.save(shelf);
      status.textContent = 'saved';
      form.querySelector('.content-form-head h2').textContent = entry.name || `New ${type.label.toLowerCase()}`;
      const link = document.querySelector('.content-item.is-active .content-item-name');
      if (link) link.textContent = entry.name || `Unnamed ${type.label.toLowerCase()}`;
      const meta = document.querySelector('.content-item.is-active .content-item-meta');
      if (meta) meta.textContent = summaryLine(kind, entry);
    }, 400);
  }

  bindForm(form, () => entry, () => persist());
  // A class casts spells or manifests powers, not both: ticking one clears the other.
  if (magic) {
    form.addEventListener('change', (ev) => {
      const path = ev.target.dataset?.field;
      if (path !== 'spellcaster' && path !== 'manifester') return;
      setTimeout(() => {
        const other = path === 'spellcaster' ? 'manifester' : 'spellcaster';
        if (entry[path]) {
          entry[other] = false;
          const box = form.querySelector(`[data-field="${other}"]`);
          if (box) box.checked = false;
        }
        magic.draw();
        persist();
      }, 0);
    });
  }
  return form;
}

const CASTING_ABILITIES = [['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma'], ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution']];

/**
 * What a Spellcaster or Manifester class casts from: its ability, how it
 * casts, the SRD class whose tables give its spells per day and known (or
 * power points and powers known), and its list, built level by level from the
 * SRD's spells or powers and the library's own.
 */
function magicSection(app, store, entry, persist) {
  const host = h('section.content-magic');
  const draw = () => {
    const power = Boolean(entry.manifester);
    if (!power && !entry.spellcaster) { refill(host); host.hidden = true; return; }
    host.hidden = false;
    const at = power ? 'manifesting' : 'casting';
    const block = entry[at] = entry[at] || {};
    if (!block.ability) block.ability = power ? 'int' : 'int';
    if (!power && !block.type) block.type = 'arcane';
    if (!power && !block.style) block.style = 'prepared';
    const listKey = power ? 'powerList' : 'spellList';
    const list = block[listKey] = block[listKey] || {};
    const kind = power ? 'powers' : 'spells';
    const reference = referenceNow(kind);
    if (!reference) loadReference(kind).then(draw).catch(() => {});

    // What can go on the list, each with the level it is usually found at.
    const classNames = app.rules.classes.classes.map((c) => c.name);
    const choices = new Map();
    for (const e of reference?.list || []) {
      const levels = Object.values(e.levels || {}).filter((n) => Number.isFinite(n));
      choices.set(e.name, { level: levels.length ? Math.min(...levels) : (power ? 1 : 0), from: 'SRD' });
    }
    for (const sp of store.list('spell').filter((x) => x?.name && (x.mode === 'power') === power)) {
      const levels = Object.values(listLevels(sp.level, classNames));
      choices.set(sp.name, { level: levels.length ? Math.min(...levels) : (power ? 1 : 0), from: 'User Content' });
    }
    const tables = app.rules.classes.classes.filter((c) => (power ? c.manifesting?.ability : c.casting?.ability)).map((c) => c.name);
    const levels = power ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const listed = new Set(Object.values(list).flat());
    const changed = () => { persist(); draw(); };

    const name = h('select.field.grow', { dataset: { unbound: '' }, 'aria-label': power ? 'A power' : 'A spell' },
      h('option', { value: '', text: reference ? `- ${power ? 'a power' : 'a spell'} -` : `- loading the SRD\u2019s ${kind} -` }),
      ['User Content', 'SRD'].map((from) => {
        const names = [...choices.entries()].filter(([n, c]) => c.from === from && !listed.has(n)).map(([n]) => n).sort((a, b) => a.localeCompare(b));
        return names.length ? h('optgroup', { label: from }, names.map((n) => h('option', { value: n, text: n }))) : null;
      }));
    const level = h('select.field', { dataset: { unbound: '' }, 'aria-label': 'At level' },
      levels.map((L) => h('option', { value: L, text: levelLabel(L) })));
    name.addEventListener('change', () => {
      const suggested = choices.get(name.value)?.level;
      if (suggested !== undefined && levels.includes(suggested)) level.value = String(suggested);
    });

    refill(host,
      h('h3', { text: power ? 'Manifesting' : 'Spellcasting' }),
      h('div.content-fields',
        h('div.cell', h('span.label', { text: power ? 'Manifesting ability' : 'Casting ability' }), select(`${at}.ability`, block.ability, CASTING_ABILITIES)),
        power ? null : h('div.cell', h('span.label', { text: 'Arcane or divine' }), select('casting.type', block.type, [['arcane', 'Arcane'], ['divine', 'Divine']])),
        power ? null : h('div.cell', h('span.label', { text: 'How it casts' }), select('casting.style', block.style, CASTING_STYLES)),
        h('div.cell',
          h('span.label', { text: power ? 'Power points and powers known as a' : 'Spells per day and known as a' }),
          listSelect(`${at}.progression`, block.progression || '', tables, '- choose a class -'),
          h('span.hint', { text: power ? 'Its tables: power points, powers known and highest power level, by class level.' : 'Its tables: spells per day and spells known, by class level.' }))),
      h('h4', { text: power ? 'Power list' : 'Spell list' }),
      h('p.hint', { text: `The ${kind} this class ${power ? 'learns' : 'casts'} from, by level: the SRD\u2019s and your User Content\u2019s. A character of this class chooses from these.` }),
      h('div.magic-list-levels', levels.map((L) => {
        const names = (list[L] || []).filter(Boolean);
        return h('div.magic-list-level',
          h('span.magic-list-label', { text: levelLabel(L) }),
          names.length
            ? h('ul.language-chips', names.map((n, i) => h('li.language-chip',
              h('span', { text: n }),
              choices.get(n)?.from === 'User Content' ? h('span.tag', { text: 'User Content' }) : null,
              button('x', () => { list[L].splice(i, 1); if (!list[L].length) delete list[L]; changed(); }, { subtle: true, danger: true, title: `Take ${n} off the list` }))))
            : h('span.hint', { text: 'none' }));
      })),
      h('div.row.magic-list-adder',
        name,
        level,
        button('Add to the list', () => {
          if (!name.value) return;
          const L = Number(level.value);
          list[L] = [...(list[L] || []), name.value];
          changed();
        }, { subtle: true })));
  };
  draw();
  return { host, draw };
}

/** A dropdown of a fixed list, keeping a value it does not hold rather than losing it. */
function listSelect(path, value, list, blank) {
  const options = [['', blank || '- choose -'], ...list.map((x) => (Array.isArray(x) ? x : [x, x]))];
  if (value && !options.some(([v]) => v === value)) options.push([value, `${value} (not on the list)`]);
  return select(path, value || '', options);
}

/** One field of an entry, drawn by its description. */
function fieldFor(f, entry, lists) {
  const value = f.key.split('.').reduce((o, k) => (o == null ? o : o[k]), entry);
  let control;
  switch (f.type) {
    case 'int': control = field(f.key, value, { type: 'int', placeholder: f.placeholder }); break;
    case 'bool': return h('div.cell.cell-check', checkbox(f.key, value, f.label, { title: f.hint }));
    case 'select': control = listSelect(f.key, value ?? '', f.options.filter(([v]) => v !== ''), f.options.find(([v]) => v === '')?.[1]); break;
    case 'size': control = f.blank ? listSelect(f.key, value, lists.sizes, f.blank) : select(f.key, value || 'Medium', lists.sizes); break;
    case 'creatureType': control = listSelect(f.key, value, lists.types, f.blank); break;
    case 'creatureSubtype': control = listSelect(f.key, value, lists.subtypes, f.blank); break;
    case 'list': control = field(f.key, value || [], { type: 'list', placeholder: 'comma, separated' }); break;
    case 'textarea': control = textarea(f.key, value, { rows: 4 }); break;
    case 'abilities':
      control = h('div.ability-adjust', ABILITY_KEYS.map((k) => h('label.ability-adjust-cell',
        h('span.label', { text: k.toUpperCase() }),
        field(`${f.key}.${k}`, value?.[k] ?? 0, { type: 'int' }))));
      break;
    default: control = field(f.key, value, { placeholder: f.placeholder });
  }
  return h(`div.cell${f.wide ? '.wide' : ''}`,
    h('span.label', { text: f.label }),
    control,
    f.hint ? h('span.hint', { text: f.hint }) : null);
}

/* ==========================================================================
   A spell or power, as the books print one
   ========================================================================== */

/**
 * The stat block: the name, the school (or discipline) with its subschool and
 * descriptors, then each line of the block in the books' order - Level,
 * Components, Casting Time, Range, Target, Effect, Area, Duration, Saving
 * Throw, Spell Resistance - the description, and what trails it. A power
 * reads the same with the psionic words: Discipline, Display, Manifesting
 * Time, Power Resistance, Power Points, Augment.
 */
function statblock(entry, type, onShapeChange, featNames, skillNames) {
  const host = h('div.statblock-host');
  const field$ = (key) => type.fields.find((f) => f.key === key);

  const draw = () => {
    const power = entry.mode === 'power';
    const label = (f) => (power && f.labelPower) || f.label;
    const shown = (f) => !f.only || f.only === (power ? 'power' : 'spell');
    const placeholder = (f) => (power && f.placeholderPower) || f.placeholder;

    const kind = select('mode', entry.mode || 'spell', field$('mode').options);
    // A spell and a power have different words for the same lines: the block is drawn again in the other's.
    kind.addEventListener('change', () => setTimeout(draw, 0));

    const line = (key) => {
      const f = field$(key);
      if (!shown(f)) return null;
      return h('div.statblock-line',
        h('span.statblock-label', { text: `${label(f)}:` }),
        f.type === 'textarea'
          ? textarea(f.key, entry[f.key], { rows: 3 })
          : field(f.key, entry[f.key], { placeholder: placeholder(f) }));
    };
    const schools = power ? DISCIPLINES : SPELL_SCHOOLS;
    const subschools = power ? SUBDISCIPLINES : SPELL_SUBSCHOOLS;
    const description = field$('description');
    const effects = field$('specials');

    refill(host,
      h('div.content-fields',
        fieldFor(field$('source'), entry, {}),
        h('div.cell', h('span.label', { text: 'Kind' }), kind)),
      h('article.statblock', { dataset: { mode: power ? 'power' : 'spell' } },
        field('name', entry.name, { placeholder: power ? 'Name of the power' : 'Name of the spell', className: 'statblock-name' }),
        h('div.statblock-school',
          h('label.statblock-pick', h('span.label', { text: power ? 'Discipline' : 'School' }), listSelect('school', entry.school, schools, power ? 'Discipline' : 'School')),
          h('label.statblock-pick', h('span.label', { text: power ? 'Subdiscipline' : 'Subschool' }), listSelect('subschool', entry.subschool, subschools, 'None')),
          h('label.statblock-pick.grow', h('span.label', { text: 'Descriptors' }), field('descriptors', entry.descriptors, { placeholder: field$('descriptors').placeholder }))),
        ['level', 'components', 'castingTime', 'range', 'target', 'effect', 'area', 'duration', 'savingThrow', 'resistance', 'powerPoints'].map(line),
        h('div.statblock-description',
          h('span.label', { text: label(description) }),
          textarea('description', entry.description, { rows: 8, placeholder: power ? 'What the power does.' : 'What the spell does.' })),
        ['materials', 'focus', 'xpCost', 'augment'].map(line),
        h('div.statblock-effects',
          h('span.statblock-label', { text: `${effects.label}:` }),
          h('p.hint', { text: effects.hint }),
          effectsEditor('specials.0.effects', () => {
            entry.specials = entry.specials?.length ? entry.specials : [{ name: '', type: '', text: '', effects: [] }];
            return (entry.specials[0].effects = entry.specials[0].effects || []);
          }, {
            skillNames: skillNames || [],
            featNames,
            addLabel: 'Add a bonus',
            emptyText: power ? 'None. A power that gives a bonus while it lasts says so here.' : 'None. A spell that gives a bonus while it lasts says so here.',
            onShapeChange,
          }))));
  };

  draw();
  return host;
}

/* ==========================================================================
   The primer - how effects work, shown when nothing is open
   ========================================================================== */

function effectsPrimer() {
  const example = (what, rows) => h('div.primer-example',
    h('p', h('strong', { text: what })),
    h('table.primer-table',
      h('thead', h('tr', ['Changes', 'Type', 'By', 'Only when'].map((c) => h('th', { text: c })))),
      h('tbody', rows.map((r) => h('tr', r.map((c) => h('td', { text: c })))))));

  return h('section.primer',
    h('h2', { text: 'How content changes a sheet' }),
    h('p', { text: 'What an entry does is a list of its abilities: a race\u2019s traits, a class\u2019s features, a feat\u2019s benefit, an item\u2019s effects. Each one shows on the sheet of whoever takes it, with its words, its uses and - for a spell-like or supernatural ability - its DC.' }),
    h('p', { text: `An ability may be ${Object.values(SPECIAL_TYPES).map((t) => `${t.label} (${t.mark})`).join(', ')}, or left unmarked. Give it uses and the sheet tracks them, and gives them back when they reset: per day, per week, per encounter.` }),
    h('p', { text: 'Its bonuses are the part the sheet can count: each one names a number, a bonus type and an amount.' }),
    example('A ring of protection +2', [['Armor Class', 'deflection', '+2', '']]),
    example('A homebrew race of stone-skinned folk', [
      ['Armor Class', 'natural', '+2', ''],
      ['Hide', 'racial', '+4', 'in rocky terrain'],
      ['Fortitude', 'racial', '+2', 'against poison'],
    ]),
    h('h3', { text: 'Stacking' }),
    h('p', { text: 'Two bonuses of the same type do not add; the larger one applies. A ring of protection +1 and a shield of faith +3 give +3, not +4. Dodge, circumstance and untyped bonuses are the exceptions, and stack with themselves. Penalties always count.' }),
    h('h3', { text: 'Situational bonuses' }),
    h('p', { text: 'A bonus with something written under Only when is never added to a total - the sheet cannot know whether you are fighting a giant. It is noted on the sheet instead, with the ability it came from and the condition it needs, the way you would pencil it in the margin.' }),
    h('h3', { text: 'What a bonus can change' }),
    h('p.primer-targets', { text: `${Object.values(TARGETS).join(', ')}, and any individual skill.` }));
}

/* ==========================================================================
   Files
   ========================================================================== */

const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'content';

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportLibrary(store) {
  download(`content-${new Date().toISOString().slice(0, 10)}.json`, store.exportFile());
}

function importControl(store, after) {
  const input = h('input', {
    type: 'file', accept: 'application/json', class: 'hidden',
    onchange: async (ev) => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try {
        const added = store.importFile(JSON.parse(await file.text()));
        alert(added ? `${added} ${added === 1 ? 'entry' : 'entries'} added.` : 'That file held no content the library could read.');
        after();
      } catch (err) {
        alert(`That file could not be read: ${err.message}`);
      }
      ev.target.value = '';
    },
  });
  return h('span', input, button('Import', () => input.click(), {
    subtle: true, title: 'A content file, a single entry, or an exported character - its homebrew comes with it.',
  }));
}

export { download, slug };
