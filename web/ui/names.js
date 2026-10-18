// Choosing content by name, and moving what was typed in before.
//
// Everything on a sheet that changes the rules - a race, a class, a template,
// a feat, a misc feature, an item's mechanics - is the SRD's or the player's
// User Content, chosen from a list. Only the story is written on the sheet
// itself. A sheet from before may still carry something typed in by hand; it
// counts, it is flagged (engine/derive.js), and the button here writes it up
// in User Content, where it can be chosen from then on.

import { select, button } from './dom.js';

/**
 * A field naming a piece of content: a dropdown holding the names that exist.
 *
 * @param kind  'race' | 'class' | 'template' | 'feat' | 'feature'
 */
export function nameField(app, path, value, kind, opts = {}) {
  const names = app.contentNames?.(kind) || [];
  const options = [['', opts.empty || `- choose a ${kind === 'feature' ? 'misc feature' : kind} -`], ...names.map((n) => [n, n])];
  // A name from before is kept, and said to be missing, rather than quietly changed.
  if (value && !names.includes(value)) options.push([value, `${value} (in neither the SRD nor User Content)`]);
  return select(path, value || '', options, { className: opts.className, title: opts.title });
}

/**
 * "Copy into User Content": write something typed onto the sheet before into
 * the player's User Content, and carry it from there.
 *
 * @param entry  the content entry to write, as User Content keeps one
 * @param after  called once it is written: clear what the sheet typed, redraw
 */
export function copyToUserContent(app, kind, entry, after) {
  return button('Copy into User Content', () => {
    if (!entry?.name) return;
    if (!app.copyToUserContent?.(kind, entry)) {
      alert(`User Content already has a ${kind === 'feature' ? 'misc feature' : kind} called ${entry.name}. Rename one of them, or remove what is typed here and choose that one.`);
      return;
    }
    after?.();
  }, { subtle: true, title: 'Write this into your User Content, where it can be edited and chosen again, and use it from there.' });
}
