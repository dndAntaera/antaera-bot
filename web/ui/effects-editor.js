// The effects editor: a small table of "what this changes".
//
// It is the same control wherever an effect can live - among an ability's
// bonuses in User Content, on a magic item's row - and it binds through the
// ordinary [data-field] paths, so whichever form it sits in saves it like any
// other field. Only adding and removing a row, and changing what kind of thing
// a row changes, are handled here, because those change the row's shape.
//
// A row says what it changes in one dropdown. Most choices are the thing
// itself - Armor Class, Will, melee attacks. Two take a second dropdown beside
// them: Skill, which then names the skill (or all of them), and - where the
// editor is given the feats - Grants a feat, which names the feat instead of a
// bonus.

import { h, field, select, checkbox, button, refill } from './dom.js';
import { TARGETS, GRANTS_FEAT } from '../engine/effects.js';
import { BONUS_TYPES } from '../engine/library.js';

const GROUPS = [
  ['Abilities', ['ability.str', 'ability.dex', 'ability.con', 'ability.int', 'ability.wis', 'ability.cha']],
  ['Defense', ['ac', 'spellResistance']],
  ['Saving throws', ['save.all', 'save.fort', 'save.ref', 'save.will']],
  ['Attacks and damage', ['attack.all', 'attack.melee', 'attack.ranged', 'damage.melee', 'damage.ranged', 'grapple']],
  ['Everything else', ['initiative', 'speed', 'hp', 'skillPoints.perLevel', 'feats.bonus']],
];

/** What kind of thing a row changes: the target itself, or 'skill', or 'feat'. */
const kindOf = (target) => {
  if (target === GRANTS_FEAT) return 'feat';
  if (String(target || '').startsWith('skill.')) return 'skill';
  return target || '';
};

/** The first dropdown: every target by group, then Skill, then - when given feats - Grants a feat. */
function kindChoice(kind, target, withFeats) {
  const el = h('select.field.effect-target', { dataset: { unbound: '' }, 'aria-label': 'Changes' });
  el.append(h('option', { value: '', text: '- changes what -', selected: !kind }));
  for (const [label, targets] of GROUPS) {
    el.append(h('optgroup', { label },
      targets.map((t) => h('option', { value: t, text: TARGETS[t], selected: t === kind }))));
  }
  el.append(h('optgroup', { label: 'Skills and feats' },
    h('option', { value: 'skill', text: 'Skill', selected: kind === 'skill' }),
    withFeats ? h('option', { value: 'feat', text: 'Grants a feat', selected: kind === 'feat' }) : null));
  // A target this list does not offer - a typo, or one from older content -
  // is kept visible rather than silently replaced with the first option.
  if (kind && ![...el.options].some((o) => o.value === kind)) {
    el.append(h('option', { value: kind, text: `${target} (not recognized)`, selected: true }));
  }
  return el;
}

/** The skill a Skill row names: all of them, or one, by its name. */
function skillChoice(path, target, skillNames) {
  const options = [['skill.*', 'All skills'], ...skillNames.map((name) => [`skill.${name}`, name])];
  if (target && !options.some(([v]) => v === target)) options.push([target, `${target.slice(6)} (not on the sheet)`]);
  const el = select(`${path}.target`, target || 'skill.*', options, { className: 'effect-skill' });
  el.setAttribute('aria-label', 'Which skill');
  return el;
}

/** The feat a Grants a feat row names, from the SRD's and User Content's. */
function featChoice(path, value, featNames) {
  const options = [['', '- a feat -'], ...featNames.map((n) => [n, n])];
  if (value && !featNames.includes(value)) options.push([value, `${value} (not in the SRD or User Content)`]);
  const el = select(`${path}.feat`, value || '', options, { className: 'effect-feat', title: 'Held as a feat, filling no slot, and doing what the feat does.' });
  el.setAttribute('aria-label', 'Which feat');
  return el;
}

/**
 * @param basePath  where the effects array lives in the bound model, e.g.
 *                  "specials.0.effects" in User Content
 * @param getList   returns the live array (created if missing)
 * @param opts.skillNames     the skills a Skill row may name
 * @param opts.featNames      the feats a row may grant; without them, no row can
 * @param opts.onShapeChange  called after a row is added, removed or changes kind
 */
export function effectsEditor(basePath, getList, opts = {}) {
  const host = h('div.effects-rows');
  const skillNames = opts.skillNames || [];
  const featNames = opts.featNames || null;

  const row = (effect, i) => {
    const path = `${basePath}.${i}`;
    const kind = kindOf(effect.target);
    const changes = kindChoice(kind, effect.target, Boolean(featNames));
    // Choosing what a row changes reshapes it: a skill needs naming, a feat replaces the bonus.
    changes.addEventListener('change', () => {
      const list = getList();
      const next = changes.value;
      const was = list[i] || {};
      if (next === 'feat') list[i] = { target: GRANTS_FEAT, feat: '', featChoice: '' };
      else if (next === 'skill') list[i] = { ...was, target: kindOf(was.target) === 'skill' ? was.target : 'skill.*', feat: undefined, featChoice: undefined };
      else list[i] = { ...was, target: next, feat: undefined, featChoice: undefined };
      if (next !== 'feat') {
        list[i].type = list[i].type || 'untyped';
        list[i].value = list[i].value ?? 0;
      }
      rebuild();
      opts.onShapeChange?.();
    });
    const remove = button('x', () => {
      getList().splice(i, 1);
      rebuild();
      opts.onShapeChange?.();
    }, { subtle: true, danger: true, title: 'Remove this row', className: 'effect-remove' });

    if (kind === 'feat') {
      return h('div.effect-row.is-feat',
        h('div.effect-target-cell', changes, featChoice(path, effect.feat, featNames || [])),
        field(`${path}.featChoice`, effect.featChoice, {
          placeholder: 'applies to, if it asks',
          className: 'effect-feat-choice',
          title: 'What the feat is taken on, if it asks: a weapon for Weapon Focus, a skill for Skill Focus.',
        }),
        remove);
    }
    return h('div.effect-row',
      h('div.effect-target-cell', changes, kind === 'skill' ? skillChoice(path, effect.target, skillNames) : null),
      select(`${path}.type`, effect.type || 'untyped', BONUS_TYPES.map((t) => [t, t]), { className: 'effect-type' }),
      field(`${path}.value`, effect.value, { type: 'int', className: 'effect-value' }),
      field(`${path}.condition`, effect.condition, {
        placeholder: 'always',
        className: 'effect-condition',
        title: 'Leave empty for an effect that always applies. Anything written here - "against poison", "while raging" - makes it a note beside the number instead of part of it.',
      }),
      checkbox(`${path}.perLevel`, effect.perLevel, 'per HD', { title: 'Multiply by hit dice: +1 hit point per level, say.' }),
      remove);
  };

  function rebuild() {
    const list = getList();
    refill(host, list.length
      ? [
        h('div.effect-head',
          h('span.label', { text: 'Changes' }),
          h('span.label', { text: 'Bonus type' }),
          h('span.label', { text: 'By' }),
          h('span.label', { text: 'Only when' }),
          h('span.label', { text: '' }),
          h('span.label', { text: '' })),
        list.map((effect, i) => row(effect || {}, i)),
      ]
      : h('p.hint.effects-empty', { text: opts.emptyText || 'No effects. As written, this is text only and changes no numbers.' }));
  }

  rebuild();
  return h('div.effects-editor',
    host,
    button(opts.addLabel || 'Add an effect', () => {
      getList().push({ target: '', type: 'untyped', value: 0, condition: '', perLevel: false });
      rebuild();
      opts.onShapeChange?.();
    }, { subtle: true }));
}
