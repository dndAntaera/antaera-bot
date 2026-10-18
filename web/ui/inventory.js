// Inventory, equipment slots, the shop, and the attack calculator.
//
// The numbers are engine/inventory.js's; this file draws them and records what
// the player does: buying, selling, reordering and removing items, putting
// items into slots, and choosing how to attack. Every item is the SRD's or the
// player's User Content, its mechanics its entry's: a homebrew sword is
// written in User Content and bought in the Shop, never typed in here.

import { h, field, checkbox, select, labelled, panel, row, button, refill, total, out } from './dom.js';
import {
  BODY_SLOTS, itemFromReference, buyItem, removeItem, purchaseOf, slotChoices, attackFor, newItemId,
} from '../engine/inventory.js';
import { describeTarget } from '../engine/effects.js';
import { copyToUserContent } from './names.js';
import { loadReference, referenceNow, lookUp, referenceHref } from '../reference.js';
import { referenceCard } from './reference.js';

const lower = (s) => String(s || '').trim().toLowerCase();
const gp = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} gp`;
const lb = (n) => `${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} lb.`;
const sign = (n) => (n < 0 ? String(n) : `+${n}`);

function withReference(app, kind, panelKey) {
  if (referenceNow(kind)) return;
  loadReference(kind).then(() => app.rebuildPanel?.(panelKey)).catch(() => {});
}

/** What an item's statistics say, in a line. */
export function statsLine(item) {
  const s = item?.stats;
  if (!s) return item?.slot ? `${item.slot} slot` : '';
  if (s.kind === 'weapon') {
    return [s.hands, s.damage || s.damageMedium, s.critical, s.range ? `${s.range} ft.` : '', s.damageType].filter(Boolean).join(', ');
  }
  return [
    s.armorType && s.kind === 'armor' ? `${s.armorType} armor` : '',
    `+${Number(s.bonus || 0) + Number(s.enhancement || 0)} AC`,
    s.maxDex !== null && s.maxDex !== undefined && s.maxDex !== '' ? `max Dex +${s.maxDex}` : '',
    s.acp ? `check -${s.acp}` : '',
    s.asf ? `spell failure ${s.asf}%` : '',
  ].filter(Boolean).join(', ');
}

/* ==========================================================================
   The inventory
   ========================================================================== */

export function inventoryPanel(app) {
  const c = app.character;
  const inv = app.derived.inventory;
  const changed = (...also) => { app.recompute(); app.rebuildPanel('inventory'); for (const key of also) if (app.panels[key]) app.rebuildPanel(key); };
  c.wealth.items = c.wealth.items || [];
  c.wealth.ledger = c.wealth.ledger || [];
  withReference(app, 'equipment', 'inventory');

  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= c.wealth.items.length) return;
    const list = c.wealth.items;
    [list[i], list[j]] = [list[j], list[i]];
    changed();
  };
  const take = (item, how) => {
    const next = removeItem(c, item.id, how);
    c.wealth.items = next.items;
    c.wealth.ledger = next.ledger;
    c.equipment = next.equipment;
    changed('equipment', 'trackers');
  };

  const rows = c.wealth.items.map((item, i) => {
    const line = inv.items[i] || {};
    const paid = purchaseOf(c, item.id);
    const actions = h('td.inventory-actions');
    const normal = () => refill(actions,
      button('Sell', () => take(item, 'sell'), { subtle: true, title: `Sell for half its value: ${gp((Number(item.value) || 0) * (Number(item.qty) || 0) / 2)}.` }),
      button('✕', () => (paid ? confirmRemove() : take(item, 'discard')), { subtle: true, danger: true, title: 'Remove' }));
    // Removing something bought asks, in place, whether the purchase is undone.
    const confirmRemove = () => refill(actions,
      button(`Refund ${gp(paid)}`, () => take(item, 'refund'), { subtle: true, title: 'Undo the purchase: the coins come back.' }),
      button('Keep the cost', () => take(item, 'discard'), { subtle: true, title: 'It is gone, and what it cost stays spent.' }),
      button('Cancel', normal, { subtle: true }));
    normal();

    const detailsRow = h('tr.inventory-more', { hidden: true }, h('td', { colSpan: 9 }, itemDetails(app, item, i, changed)));
    const ref = item.ref && lookUp('equipment', item.ref);
    return [
      h('tr.inventory-row',
        h('td.inventory-order',
          button('▲', () => move(i, -1), { subtle: true, title: 'Move up' }),
          button('▼', () => move(i, 1), { subtle: true, title: 'Move down' })),
        h('td.inventory-name',
          h('button.inventory-toggle', { type: 'button', 'aria-expanded': 'false', onclick: (ev) => { detailsRow.hidden = !detailsRow.hidden; ev.currentTarget.setAttribute('aria-expanded', String(!detailsRow.hidden)); } },
            h('span', { text: item.name || 'Unnamed item' })),
          h('span.tag', { text: item.category || 'Gear' }),
          (line.slots || []).length ? h('span.tag.is-equipped', { text: 'equipped' }) : null,
          item.custom ? h('span.tag', { text: 'User Content' }) : null,
          ref ? h('a.hint', { href: referenceHref('equipment', item.ref), text: 'SRD' }) : null),
        h('td', { dataset: { label: 'Qty' } }, field(`wealth.items.${i}.qty`, item.qty, { type: 'int', min: 0, width: '4rem' })),
        h('td.num', { dataset: { label: 'Weight' }, text: item.weight ? lb(item.weight) : '-' }),
        h('td.num', { dataset: { label: 'Value' }, text: item.value ? gp(item.value) : '-' }),
        h('td.num', { dataset: { label: 'Total weight' } }, out(`inventory.items.${i}.lineWeight`, { format: 'lb' })),
        h('td.num', { dataset: { label: 'Total value' } }, out(`inventory.items.${i}.lineValue`, { format: 'gp' })),
        h('td.num', { dataset: { label: 'Paid' }, text: paid ? gp(paid) : '-' }),
        actions),
      detailsRow,
    ];
  });

  const ledgerHost = h('div.list');
  refill(ledgerHost, c.wealth.ledger.map((entry, i) => h('div.list-row.ledger-row',
    h('span.tag', { text: entry.kind === 'purchase' ? 'bought' : entry.kind === 'sale' ? 'sold' : 'other' }),
    field(`wealth.ledger.${i}.label`, entry.label, { placeholder: 'What it was', className: 'grow' }),
    labelled('gp', field(`wealth.ledger.${i}.amount`, entry.amount, { type: 'number', step: '0.01', width: '7rem', title: 'Positive for coins gained, negative for coins spent.' })),
    button('✕', () => { c.wealth.ledger.splice(i, 1); changed(); }, { subtle: true, danger: true, title: 'Remove this entry' }))));

  const load = inv.capacity;
  return panel('inventory', 'Inventory',
    h('div.summary-strip',
      total('Starting wealth', 'wealth.startingGold', { format: 'gp' }),
      total('Spent on items', 'inventory.spent', { format: 'gp' }),
      total('Other gains', 'inventory.gains', { format: 'gp' }),
      total('Coins', 'inventory.coins', { format: 'gp', big: true }),
      total('Items worth', 'inventory.itemsValue', { format: 'gp' }),
      total('Total wealth', 'inventory.total', { format: 'gp', big: true }),
      total('Expected at this level', 'wealth.expected', { format: 'gp', title: 'Wealth by level: guidance, not a limit.' })),
    inv.legacy ? h('p.hint', { text: 'This sheet counted its coins by hand before the inventory; that count is where the ledger starts.' }) : null,
    h('div.table-scroll', h('table.inventory-table',
      h('thead', h('tr', ['', 'Item', 'Qty', 'Weight', 'Value', 'Total weight', 'Total value', 'Paid', ''].map((t) => h('th', { text: t })))),
      h('tbody', rows.length ? rows : h('tr', h('td.empty', { colSpan: 9, text: 'Nothing carried yet. Buy something in the shop.' }))),
      h('tfoot', h('tr',
        h('td'), h('th', { text: 'Carried' }), h('td'), h('td'), h('td'),
        h('td.num', out('inventory.itemsWeight', { format: 'lb' })),
        h('td.num', out('inventory.itemsValue', { format: 'gp' })),
        h('td'), h('td'))))),
    row(
      h('a.btn', { href: `#/sheet/${c.id}/shop` }, 'Go to the shop'),
      h('a.hint', { href: '#/content/item', text: 'An item the SRD does not have? Write it in User Content, then buy it in the shop.' })),
    h('div.block',
      h('h3', 'Load'),
      row(
        total('Carried', 'inventory.carried', { format: 'lb', big: true, title: 'Items, and coins at 50 to the pound.' }),
        h('div.total', h('span.label', { text: 'Load' }), h('span.out', { text: inv.load })),
        h('div.total', h('span.label', { text: 'Light' }), h('span.out', { text: `up to ${load.light} lb.` })),
        h('div.total', h('span.label', { text: 'Medium' }), h('span.out', { text: `up to ${load.medium} lb.` })),
        h('div.total', h('span.label', { text: 'Heavy' }), h('span.out', { text: `up to ${load.heavy} lb.` }))),
      h('p.hint', { text: `${lb(inv.coinWeight)} of that is coins. A medium load caps Dexterity to AC at +3 with a -3 check penalty, a heavy one at +1 and -6; the worse of load and armor applies.` })),
    h('div.block',
      h('h3', 'Coins in and out'),
      h('p.hint', { text: 'Every purchase is written here as it is made. Add loot, pay for an inn, record a debt: positive for coins gained, negative for coins spent.' }),
      ledgerHost,
      row(
        button('Add an entry', () => { c.wealth.ledger.push({ id: newItemId(), kind: 'other', label: '', amount: 0 }); changed(); }, { subtle: true }),
        startingWealthRow(app))));
}

const ENHANCEMENTS = Array.from({ length: 11 }, (_, n) => [n, n ? `+${n}` : 'none']);

/**
 * An inventory row opened: what it is, its notes, and the choices an item of
 * its kind takes - a weapon's or armor's enhancement, and masterwork. Its
 * statistics and what it does are its entry's, in the SRD or User Content.
 */
function itemDetails(app, item, i, changed) {
  const s = item.stats;
  const enhancement = () => {
    const el = select(`wealth.items.${i}.stats.enhancement`, s.enhancement || 0, ENHANCEMENTS);
    el.dataset.kind = 'int';
    return labelled('Enhancement', el);
  };
  const content = app.derived.index.itemByName?.get(item.name);
  return h('div.inventory-details',
    s ? h('p.hint', { text: statsLine(item) }) : null,
    s && ['weapon', 'armor', 'shield'].includes(s.kind) ? row(
      enhancement(),
      checkbox(`wealth.items.${i}.stats.masterwork`, s.masterwork, 'Masterwork')) : null,
    row(labelled('Notes', field(`wealth.items.${i}.notes`, item.notes, { className: 'grow', placeholder: 'Where it came from, who made it' }), { wide: true })),
    typedOnItem(app, item, content, changed),
    item.ref && lookUp('equipment', item.ref) ? h('div.row-reference-body', referenceCard('equipment', lookUp('equipment', item.ref))) : null,
    content?.description ? h('p.special-text', { text: content.description }) : null);
}

/**
 * Bonuses or uses typed onto an inventory row before: they still count, and
 * they belong in the item's entry in User Content - written there by the
 * button, as a new entry, or into the one that exists by hand.
 */
function typedOnItem(app, item, content, changed) {
  const fx = (item.effects || []).filter((e) => e?.target);
  const uses = Number(item.uses) > 0 ? Number(item.uses) : 0;
  if (!fx.length && !uses) return null;
  const words = [
    fx.map((e) => `${Number(e.value) < 0 ? '' : '+'}${Number(e.value) || 0}${e.type && e.type !== 'untyped' ? ` ${e.type}` : ''} ${describeTarget(e.target)}${e.condition ? ` (${e.condition})` : ''}`).join('; '),
    uses ? `${uses} uses a day` : '',
  ].filter(Boolean).join('; ');
  const clear = () => { delete item.effects; delete item.uses; delete item.usesUsed; changed('equipment', 'trackers', 'abilitiesList'); };
  return h('div.typed-before',
    h('p.hint', { text: `Typed onto this item before: ${words}. It still counts while worn.${content ? ' Write it into the item\u2019s entry in User Content instead, and remove it here.' : ''}` }),
    content
      ? button('Remove what was typed here', clear, { subtle: true, danger: true })
      : copyToUserContent(app, 'item', {
        name: item.name, category: item.category || 'Wondrous item', weight: Number(item.weight) || 0, value: Number(item.value) || 0,
        slot: item.slot || '', description: item.notes || '', source: 'Homebrew',
        ...(item.stats ? { stats: structuredClone(item.stats) } : {}),
        specials: [{ name: '', type: '', text: '', uses: uses || null, usesPer: 'day', effects: fx }],
      }, clear));
}

/** Starting wealth: wealth by level, a figure of one's own, or the campaign's. */
function startingWealthRow(app) {
  const w = app.derived.wealth;
  const inCampaign = Boolean(app.rules.campaign);
  return inCampaign
    ? h('span.hint', { text: w.source === 'campaign' ? 'Starting wealth is set by the campaign.' : 'Starting wealth is wealth by level.' })
    : labelled('Starting wealth, your own figure', field('wealth.startingGold', app.character.wealth?.startingGold, { type: 'int', width: '7rem', placeholder: w.expected !== null ? String(w.expected) : 'by level', title: 'Leave empty for wealth by level.' }));
}

/* ==========================================================================
   Equipment slots
   ========================================================================== */

export function equipmentPanel(app) {
  const c = app.character;
  c.equipment = c.equipment || { armor: null, shield: null, weapons: [], slots: {} };
  c.equipment.slots = c.equipment.slots || {};
  c.equipment.weapons = c.equipment.weapons || [];
  const items = new Map((c.wealth?.items || []).map((item, i) => [item.id, { item, i }]));
  const changed = () => { app.recompute(); app.rebuildPanel('equipment'); if (app.panels.inventory) app.rebuildPanel('inventory'); if (app.panels.attackCards) app.rebuildPanel('attackCards'); };

  const put = (key, id) => {
    if (key === 'armor' || key === 'shield') c.equipment[key] = id || null;
    else if (key.startsWith('weapon:')) c.equipment.weapons[Number(key.slice(7))] = id || null;
    else c.equipment.slots[key] = id || null;
    changed();
  };
  const current = (key) => (key === 'armor' || key === 'shield' ? c.equipment[key]
    : key.startsWith('weapon:') ? c.equipment.weapons[Number(key.slice(7))] : c.equipment.slots[key]);

  const slot = (key, label, hint, extra = null) => {
    const choices = slotChoices(c, key);
    const now = current(key);
    const held = now ? items.get(now) : null;
    return h(`div.equip-slot${held ? '.is-filled' : ''}`,
      h('div.equip-slot-head', h('span.equip-slot-label', { text: label }), hint ? h('span.hint', { text: hint }) : null),
      h('select.field', {
        'aria-label': label,
        dataset: { unbound: '' },
        onchange: (ev) => put(key, ev.target.value),
      },
      h('option', { value: '', text: choices.length ? '- empty -' : '—', selected: !now }),
      choices.map((x) => h('option', { value: x.item.id, text: `${x.item.name}${x.free > 1 ? ` (${x.free} free)` : ''}`, selected: x.item.id === now }))),
      held ? h('span.hint.equip-stats', { text: statsLine(held.item) }) : null,
      held && held.item.stats ? row(
        labelled('Enhancement', field(`wealth.items.${held.i}.stats.enhancement`, held.item.stats.enhancement, { type: 'int', min: 0, max: 10, width: '4rem' })),
        checkbox(`wealth.items.${held.i}.stats.masterwork`, held.item.stats.masterwork, 'Masterwork')) : null,
      extra);
  };

  const weaponSlots = c.equipment.weapons.length ? c.equipment.weapons : [null];
  if (!c.equipment.weapons.length) c.equipment.weapons = [null];

  return panel('equipment', 'Equipment',
    h('p.hint', {}, 'What is worn and held, chosen from the ', h('a', { href: `#/sheet/${c.id}/inventory`, text: 'inventory' }), '. Armor, shield and weapons set Armor Class and attacks; a magic item’s effects count while it is in a slot.'),
    h('div.block', h('h3', 'Armor and shield'),
      h('div.equip-grid', slot('armor', 'Armor'), slot('shield', 'Shield'))),
    h('div.block', h('h3', 'Weapons'),
      h('div.equip-grid', weaponSlots.map((_, i) => slot(`weapon:${i}`, `Weapon ${i + 1}`, null,
        weaponSlots.length > 1 ? button('Remove this slot', () => { c.equipment.weapons.splice(i, 1); changed(); }, { subtle: true, danger: true }) : null))),
      button('Add a weapon slot', () => { c.equipment.weapons.push(null); changed(); }, { subtle: true })),
    h('div.block', h('h3', 'Magic item slots'),
      h('p.hint', { text: 'Where 3.5 wears its magic items: one item a slot, and two rings.' }),
      h('div.equip-grid', BODY_SLOTS.map((b) => slot(b.key, b.label, b.examples)))),
    row(h('a.btn', { href: `#/sheet/${c.id}/shop` }, 'Go to the shop')));
}

/* ==========================================================================
   The shop
   ========================================================================== */

const shopState = { q: '', category: 'Weapons', qty: {} };

const SHOP_CATEGORIES = [
  ['Weapons', (e) => e.family === 'Weapons' && e.subcategory !== 'Unarmed Attacks' && e.cost],
  ['Armor and shields', (e) => e.family === 'Armor and Shields' && e.cost],
  ['Adventuring gear', (e) => e.subcategory === 'Adventuring Gear'],
  ['Tools and kits', (e) => e.subcategory === 'Tools and Skill Kits'],
  ['Clothing', (e) => e.subcategory === 'Clothing'],
  ['Special substances', (e) => e.subcategory === 'Special Substances and Items'],
  ['Mounts and transport', (e) => /Mounts|Transport/.test(e.subcategory || '')],
  ['Trade goods', (e) => e.family === 'Trade Goods'],
  ['User Content', null],
];

export function shopPanel(app) {
  const c = app.character;
  const inv = app.derived.inventory;
  withReference(app, 'equipment', 'shop');
  const list = h('div.table-scroll');
  const said = h('p.shop-said', { role: 'status' });

  const buy = (rowItem, qty, free) => {
    // A User Content item comes with its entry, which is where what it does is written.
    if (rowItem.custom) app.adopt?.('item', rowItem.name);
    const next = buyItem(c, rowItem, qty, { free });
    c.wealth.items = next.items;
    c.wealth.ledger = next.ledger;
    app.recompute();
    said.textContent = `${qty > 1 ? `${qty} x ` : ''}${rowItem.name} ${free ? 'added' : `bought for ${gp(rowItem.value * qty)}`}. It is in the inventory.`;
    draw();
  };

  const draw = () => {
    const coins = app.derived.inventory.coins;
    const mine = [...new Map((app.shelfEntries?.('item') || []).filter((e) => e?.name).map((e) => [e.name, { ...e, _custom: true }])).values()];
    const reference = referenceNow('equipment')?.list || [];
    const test = SHOP_CATEGORIES.find(([name]) => name === shopState.category)?.[1];
    const pool = shopState.category === 'User Content' ? mine : reference.filter(test || (() => true));
    const found = pool.filter((e) => !shopState.q || lower(e.name).includes(lower(shopState.q))).slice(0, 200);
    coinLine.textContent = `Coins: ${gp(coins)}`;
    if (!reference.length && shopState.category !== 'User Content') {
      refill(list, h('p.empty', { text: 'Opening the shop…' }));
      return;
    }
    refill(list, h('table.shop-table',
      h('thead', h('tr', ['Item', 'Cost', 'Weight', 'Details', 'Qty', ''].map((t) => h('th', { text: t })))),
      h('tbody', found.length ? found.map((e) => {
        // What a User Content item does stays its entry's, carried on the sheet by its name.
        const rowItem = e._custom
          ? { name: e.name, category: e.category || 'Gear', weight: Number(e.weight) || 0, value: Number(e.value) || 0, slot: e.slot || '', custom: true, ...(e.stats ? { stats: structuredClone(e.stats) } : {}) }
          : itemFromReference(e);
        const key = e.name;
        const qty = Math.max(1, Number(shopState.qty[key]) || 1);
        const cost = rowItem.value * qty;
        const short = cost > coins;
        return h('tr',
          h('td', h('span.shop-name', { text: e.name }), e._custom ? h('span.tag', { text: 'User Content' }) : null),
          h('td.num', { dataset: { label: 'Cost' }, text: rowItem.value ? gp(rowItem.value) : 'free' }),
          h('td.num', { dataset: { label: 'Weight' }, text: rowItem.weight ? lb(rowItem.weight) : '-' }),
          h('td.hint.shop-details', { text: statsLine(rowItem) || rowItem.category }),
          h('td', { dataset: { label: 'Qty' } }, h('input.field', {
            type: 'number', min: 1, value: qty, 'aria-label': `How many ${e.name}`, style: 'width:4rem', dataset: { unbound: '' },
            onchange: (ev) => { shopState.qty[key] = Math.max(1, Number(ev.target.value) || 1); draw(); },
          })),
          h('td.shop-actions',
            h('button.btn', { type: 'button', disabled: short, title: short ? `Costs ${gp(cost)}; you have ${gp(coins)}.` : `Pay ${gp(cost)}.`, onclick: () => buy(rowItem, qty, false) }, short ? 'Too dear' : 'Buy'),
            button('Take', () => buy(rowItem, qty, true), { subtle: true, title: 'Add it without paying: found, given, or already owned.' })));
      }) : h('tr', h('td.empty', { colSpan: 6, text: shopState.category === 'User Content' ? 'No items in your User Content yet. Write one under User Content, Item, and it is sold here.' : 'Nothing matches.' })))));
  };

  const coinLine = h('span.shop-coins');
  const search = h('input.field', { type: 'search', value: shopState.q, placeholder: 'Search the shop', 'aria-label': 'Search the shop', dataset: { unbound: '' }, oninput: (ev) => { shopState.q = ev.target.value; draw(); } });
  const tabs = h('div.shop-tabs', SHOP_CATEGORIES.map(([name]) => h(`button.btn${name === shopState.category ? '.primary' : '.subtle'}`, {
    type: 'button', onclick: () => { shopState.category = name; app.rebuildPanel('shop'); },
  }, name)));

  const panelEl = panel('shop', 'Shop',
    h('div.shop-top', coinLine, h('a.hint', { href: `#/sheet/${c.id}/inventory`, text: `Inventory: ${inv.items.length} item${inv.items.length === 1 ? '' : 's'}` })),
    tabs,
    row(labelled('Find', search, { wide: true })),
    said,
    list,
    h('p.hint', { text: 'Prices and weights are the SRD’s. Buying takes the cost from coins and writes it in the ledger; Take adds an item without paying.' }));
  draw();
  return panelEl;
}

/* ==========================================================================
   Attack cards
   ========================================================================== */

export function attackCardsPanel(app) {
  const c = app.character;
  c.combat = c.combat || {};
  const o = c.combat.calculator = { twoHands: {}, ...(c.combat.calculator || {}) };
  const weapons = (app.derived.weapons || []).map((w, i) => (w ? { ...w, slotIndex: i } : null)).filter(Boolean);
  const feats = app.derived.attackContext?.feats || new Set();
  const bab = app.derived.summary.bab;
  const changed = () => { app.recompute(); app.rebuildPanel('attackCards'); };
  const toggle = (key, label, title, when = true) => (when ? h('label.check', { title }, h('input', {
    type: 'checkbox', checked: Boolean(o[key]), dataset: { unbound: '' }, onchange: (ev) => { o[key] = ev.target.checked; changed(); },
  }), h('span', { text: label })) : null);
  const amount = (key, label, max, when) => (when ? labelled(label, h('input.field', {
    type: 'number', min: 0, max, value: o[key] || 0, style: 'width:4rem', dataset: { unbound: '' },
    onchange: (ev) => { o[key] = Math.max(0, Math.min(max, Number(ev.target.value) || 0)); changed(); },
  })) : null);

  if (!weapons.length) {
    return panel('attackCards', 'Attacks with weapons',
      h('p.empty', {}, 'No weapon in a weapon slot. Choose one on the ', h('a', { href: `#/sheet/${c.id}/equipment`, text: 'Equipment page' }), '.'));
  }

  const offHand = weapons.find((w) => w.slotIndex === o.offHand) || null;
  const cards = weapons.map((w) => {
    const role = offHand ? (w.slotIndex === o.offHand ? 'off' : 'primary') : null;
    const calc = attackFor(w, app.derived.attackContext, {
      ...o,
      twoWeapon: role,
      offHandLight: offHand?.hands === 'light',
      twoHands: Boolean(o.twoHands?.[w.slotIndex]),
    });
    return h('article.attack-card',
      h('header.attack-card-head',
        h('h3', { text: w.name }),
        h('span.tag', { text: w.hands }),
        role ? h('span.tag.is-equipped', { text: role === 'off' ? 'off hand' : 'primary hand' }) : null),
      h('div.attack-card-numbers',
        h('div.total.big', h('span.label', { text: 'Attack' }), h('span.out', { text: calc.routine })),
        h('div.total.big', h('span.label', { text: 'Damage' }), h('span.out', { text: calc.damage })),
        h('div.total', h('span.label', { text: 'Critical' }), h('span.out', { text: calc.critical })),
        w.range ? h('div.total', h('span.label', { text: 'Range' }), h('span.out', { text: `${w.range} ft.` })) : null),
      w.hands === 'one-handed' && !w.ranged ? h('label.check', {}, h('input', {
        type: 'checkbox', checked: Boolean(o.twoHands?.[w.slotIndex]), dataset: { unbound: '' },
        onchange: (ev) => { o.twoHands = { ...(o.twoHands || {}), [w.slotIndex]: ev.target.checked }; changed(); },
      }), h('span', { text: 'In two hands (1½ × Strength)' })) : null,
      h('details.attack-card-working',
        h('summary', 'How it adds up'),
        h('ul', calc.attackParts.map((p) => h('li', { text: `${sign(p.value)} ${p.label}` }))),
        h('p.hint', { text: 'Damage:' }),
        h('ul', [h('li', { text: `${w.damageDice || '-'} weapon` }), ...calc.damageParts.map((p) => h('li', { text: `${sign(p.value)} ${p.label}` }))])),
      calc.notes.length ? h('ul.attack-card-notes', calc.notes.map((n) => h('li.hint', { text: n }))) : null);
  });

  const conditional = [...(app.derived.effects.resolved['attack.all']?.conditional || []), ...(app.derived.effects.resolved['attack.melee']?.conditional || []), ...(app.derived.effects.resolved['attack.ranged']?.conditional || [])];
  return panel('attackCards', 'Attacks with weapons',
    h('div.attack-options',
      weapons.length > 1 ? labelled('Two-weapon fighting', h('select.field', {
        dataset: { unbound: '' }, onchange: (ev) => { o.offHand = ev.target.value === '' ? null : Number(ev.target.value); changed(); },
      }, h('option', { value: '', text: 'No - one weapon at a time', selected: o.offHand === null || o.offHand === undefined }),
      weapons.map((w) => h('option', { value: String(w.slotIndex), text: `Yes, ${w.name} in the off hand`, selected: o.offHand === w.slotIndex })))) : null,
      amount('powerAttack', 'Power Attack', bab, feats.has('power attack')),
      amount('combatExpertise', 'Combat Expertise', Math.min(5, bab), feats.has('combat expertise')),
      toggle('defensive', 'Fighting defensively', '-4 attack, +2 AC'),
      toggle('charge', 'Charging', '+2 attack, -2 AC'),
      toggle('flanking', 'Flanking', '+2 attack'),
      toggle('higherGround', 'Higher ground', '+1 melee attack'),
      toggle('rapidShot', 'Rapid Shot', 'One more ranged attack, all at -2', feats.has('rapid shot')),
      toggle('pointBlank', 'Within 30 ft.', 'Point Blank Shot: +1 ranged attack and damage', feats.has('point blank shot'))),
    h('div.attack-cards', cards),
    conditional.length ? h('ul.conditions', conditional.map((e) => h('li', { text: `${sign(e.value)} attack ${e.condition} (${e.source})` }))) : null,
    h('p.hint', {}, 'Weapons come from the weapon slots on the ', h('a', { href: `#/sheet/${c.id}/equipment`, text: 'Equipment page' }), '. The choices above are remembered with the sheet.'));
}
