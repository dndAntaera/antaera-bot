// The ability tracker's editor: a list of special abilities, one card each.
//
// Every kind of content says what it does with one of these - a race's
// traits, a class's features, a feat's benefit, an item's effects, a spell's
// effect on whoever it is on - and the sheet draws its own list from what they
// say (engine/specials.js). A card holds an ability's name and whether it is
// Extraordinary, Spell-Like or Supernatural; what it does, in words; how many
// uses it has and when they come back; what its DC is built on; and its
// bonuses, any of which may be situational - or, among them, a feat it grants,
// chosen from the SRD's and User Content's.
//
// Like the effects editor it binds through ordinary [data-field] paths, so the
// form it sits in saves it like any other field. Only adding and removing an
// ability is handled here, because that changes the shape of the list.

import { h, field, select, textarea, button, refill, labelled } from './dom.js';
import { effectsEditor } from './effects-editor.js';
import { SPECIAL_TYPES, USES_PER, SPECIAL_SAVES, blankSpecial } from '../engine/specials.js';
import { GRANTS_FEAT } from '../engine/effects.js';

const TYPE_OPTIONS = [['', '-'], ...Object.entries(SPECIAL_TYPES).map(([key, t]) => [key, `${t.label} (${t.mark})`])];
const DC_ABILITIES = [['cha', 'Charisma'], ['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom']];

/**
 * @param basePath  where the list lives in the bound model: "specials" in the
 *                  content editor, "race.specials" on a sheet
 * @param getList   returns the live array (created if missing)
 * @param opts.skillNames     the skills a bonus may name
 * @param opts.featNames      the feats an ability may grant: the SRD's and User Content's
 * @param opts.level          whether each ability is gained at a class level
 * @param opts.addLabel       the add button's words: "Add a trait"
 * @param opts.emptyText      what an empty list says
 * @param opts.onShapeChange  called after an ability is added or removed
 */
export function specialsEditor(basePath, getList, opts = {}) {
  const host = h('div.specials-list');

  const remove = (i) => {
    getList().splice(i, 1);
    rebuild();
    opts.onShapeChange?.();
  };

  const card = (special, i) => {
    const path = `${basePath}.${i}`;
    // A feat granted before grants were bonuses becomes one of its bonuses.
    if (special.feat) {
      special.effects = [...(special.effects || []), { target: GRANTS_FEAT, feat: special.feat, featChoice: special.featChoice || '' }];
      delete special.feat;
      delete special.featChoice;
    }
    const kind = select(`${path}.type`, special.type || '', TYPE_OPTIONS, {
      className: 'special-type',
      title: 'Extraordinary, Spell-Like or Supernatural: marked (Ex), (SLA) or (Su) beside the name on the sheet. Leave it empty for no mark.',
    });
    const fx = special.effects || [];
    const bonuses = h('details.special-bonuses', { open: fx.length > 0 },
      h('summary', fx.length ? `Bonuses (${fx.length})` : 'Bonuses'),
      h('p.hint', { text: `Skill, attack, save or other bonuses it gives${opts.featNames ? ', or a feat it grants' : ''}. Write a condition under Only when and a bonus is situational: noted on the sheet with where it came from, and left out of the total.` }),
      effectsEditor(`${path}.effects`, () => (getList()[i].effects = getList()[i].effects || []), {
        skillNames: opts.skillNames || [],
        featNames: opts.featNames,
        addLabel: 'Add a bonus',
        emptyText: 'None. As written, this is text and changes no numbers.',
        onShapeChange: () => {
          const n = (getList()[i].effects || []).length;
          bonuses.querySelector('summary').textContent = n ? `Bonuses (${n})` : 'Bonuses';
          opts.onShapeChange?.();
        },
      }));

    const el = h('div.special-card', { dataset: { type: special.type || '' } },
      h('div.special-head',
        labelled('Name', field(`${path}.name`, special.name, { placeholder: opts.namePlaceholder || 'What it is called', className: 'grow' })),
        labelled('Type', kind),
        opts.level ? labelled('Level', field(`${path}.level`, special.level, { type: 'int', min: 1, width: '4rem', title: 'The class level it is gained at.' })) : null,
        button('x', () => remove(i), { subtle: true, danger: true, title: 'Remove this ability', className: 'special-remove' })),
      labelled('What it does', textarea(`${path}.text`, special.text, { rows: 3, placeholder: 'As the sheet should show it.' }), { wide: true }),
      h('div.special-uses',
        labelled('Uses', field(`${path}.uses`, special.uses, { type: 'int', min: 0, width: '4.5rem', placeholder: 'Any', title: 'How many times it can be used before it resets. Leave empty for an ability with no limit.' })),
        labelled('Uses Reset', select(`${path}.usesPer`, special.usesPer || 'day', USES_PER)),
        h('div.only-sla', labelled('Spell level', field(`${path}.spellLevel`, special.spellLevel, { type: 'int', min: 0, max: 9, width: '4rem', title: 'The level of the spell it duplicates. Its DC is 10 + this + Charisma modifier.' }))),
        h('div.only-su', labelled('DC from', select(`${path}.dcAbility`, special.dcAbility || 'cha', DC_ABILITIES, { title: 'Its DC is 10 + half the hit dice + this ability’s modifier.' }))),
        h('div.only-dc', labelled('Save', select(`${path}.save`, special.save || '', SPECIAL_SAVES)))),
      bonuses);
    // The DC's fields follow the type as it is chosen.
    kind.addEventListener('change', () => { el.dataset.type = kind.value; });
    return el;
  };

  function rebuild() {
    const list = getList();
    refill(host, list.length
      ? list.map((special, i) => card(special, i))
      : h('p.hint.specials-empty', { text: opts.emptyText || 'None yet.' }));
  }

  rebuild();
  return h('div.specials-editor',
    host,
    button(opts.addLabel || 'Add an ability', () => {
      getList().push(blankSpecial(opts.level ? { level: 1 } : {}));
      rebuild();
      opts.onShapeChange?.();
      host.lastElementChild?.querySelector('input')?.focus();
    }, { subtle: true }));
}
