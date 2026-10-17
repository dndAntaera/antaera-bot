// Choosing content by name.
//
// An ordinary character may type a name the sheet does not know - a race of
// its own, a feat from another book - and say what it does by hand. A custom
// character takes only what exists, the SRD's or the player's User Content,
// so its names are chosen from a list rather than typed (engine/feats.js,
// isCustom). Both are bound fields, saved like any other.

import { field, select } from './dom.js';

/** Whether this character takes only content that exists. */
export const choosesOnly = (app) => Boolean(app.character?.meta?.custom);

/**
 * A field naming a piece of content: a typed field offering the known names,
 * or - for a custom character - a dropdown holding only them.
 *
 * @param kind  'race' | 'class' | 'template' | 'feat' | 'feature'
 */
export function nameField(app, path, value, kind, opts = {}) {
  if (!choosesOnly(app)) {
    return field(path, value, { list: `${kind}-names`, placeholder: opts.placeholder, className: opts.className, title: opts.title });
  }
  const names = app.contentNames?.(kind) || [];
  const options = [['', opts.empty || `- choose a ${kind === 'feature' ? 'misc feature' : kind} -`], ...names.map((n) => [n, n])];
  // A name from before is kept, and said to be missing, rather than quietly changed.
  if (value && !names.includes(value)) options.push([value, `${value} (in neither the SRD nor User Content)`]);
  return select(path, value || '', options, { className: opts.className, title: opts.title });
}
