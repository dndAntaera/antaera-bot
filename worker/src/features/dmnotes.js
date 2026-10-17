// /dmnotes: the DM's own thoughts on a wiki announcement, at the top of its embed.
//
//   /dmnotes message      opens a form for the DM's Notes on the announcement
//                         that message link points to
//
// The wiki (antaera_Wiki, .github/scripts/announce.py) posts its update
// announcements as this bot (through a webhook, before it could). Saving the
// form writes the notes at the top of the announcement's embed; running it
// again on the same link edits them, and an empty form takes them off. The
// wiki keeps whatever notes an announcement's embed carries when it edits the
// list beneath them. Any embed the bot posted can carry notes, /embedmsg's too.
//
// Only a server admin can use it: the command is registered for the
// Administrator permission (scripts/discord-commands.json), and the
// permission is checked again here, since a server can loosen the first.
//
// Settings: DISCORD_BOT_TOKEN, to read the post and edit the bot's own; the bot
// needs View Channel and Read Message History where the post is. And, for
// announcements the webhook posted before the bot did, WIKI_WEBHOOK_URL, the
// only one that can edit those. DISCORD_APPLICATION_ID is a var in
// wrangler.toml: the bot's id, which says which posts are its own.

import { json } from '../http.js';

const MESSAGE = 4;
const MODAL = 9;
const EPHEMERAL = 64;
const ADMINISTRATOR = 1n << 3n;
const API = 'https://discord.com/api/v10';
export const HEADER = "**DM's Notes**";
// Where the notes were kept before they moved into the embed: the message's text.
const OLD_HEADER = "### DM's Notes";
// An embed's description caps at 4096 characters, shared with the update's list.
const DESCRIPTION_CAP = 4096;
const MAX_NOTES = 1500;
const PREFIX = 'dmnotes:';

export const say = (content) => json({ type: MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export const isDmNotes = (interaction) => interaction.data?.name === 'dmnotes'
  || String(interaction.data?.custom_id || '').startsWith(PREFIX);

export function isAdmin(interaction) {
  try {
    return (BigInt(interaction.member?.permissions ?? 0) & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

/** /dmnotes, or the form it opened coming back. */
export async function dmNotes(env, interaction) {
  if (!isAdmin(interaction)) return say('Only server admins can use /dmnotes.');
  if (!env.DISCORD_BOT_TOKEN) return say('/dmnotes is not set up on this server yet.');
  try {
    return interaction.data?.custom_id ? await save(env, interaction) : await openForm(env, interaction);
  } catch (err) {
    return say(`I couldn't reach that message: ${err.message}`);
  }
}

/** A message link's channel and message, if it is a link to this server. */
export function parseLink(link, guildId) {
  const m = String(link || '').trim().match(/^https:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)\/?$/);
  if (!m || (guildId && m[1] !== String(guildId))) return null;
  return { channel: m[2], message: m[3] };
}

async function fetchPost(env, channel, message) {
  return discord('GET', `${env.DISCORD_API || API}/channels/${channel}/messages/${message}`, null, env.DISCORD_BOT_TOKEN);
}

/** Why this post cannot carry notes, or null if it can. */
function refusal(env, post) {
  if (!post.embeds?.[0]) return 'That message has no embed to put notes in.';
  if (post.webhook_id) {
    return post.webhook_id === webhookId(env) ? null
      : 'That message was posted by a webhook other than the wiki\'s, so I can\'t edit it.';
  }
  return post.author?.id === env.DISCORD_APPLICATION_ID ? null
    : 'That message isn\'t one I posted, so I can\'t edit it.';
}

async function openForm(env, interaction) {
  const link = (interaction.data?.options || []).find((o) => o.name === 'message')?.value;
  const where = parseLink(link, interaction.guild_id);
  if (!where) return say('That isn\'t a link to a message in this server. Right-click the announcement, choose Copy Message Link, and paste that.');
  const post = await fetchPost(env, where.channel, where.message);
  const no = refusal(env, post);
  if (no) return say(no);

  const input = { type: 4, custom_id: 'notes', style: 2, required: false, max_length: MAX_NOTES };
  const current = splitNotes(post.embeds[0].description)[0] || splitNotes(post.content, OLD_HEADER)[0];
  if (current) input.value = current;
  return json({
    type: MODAL,
    data: {
      custom_id: `${PREFIX}${where.channel}:${where.message}`,
      title: "DM's Notes",
      components: [{
        type: 18,
        label: 'Your thoughts on this update',
        description: 'Shown at the top of the announcement. Leave empty to remove them.',
        component: input,
      }],
    },
  });
}

async function save(env, interaction) {
  const m = interaction.data.custom_id.slice(PREFIX.length).match(/^(\d{1,25}):(\d{1,25})$/);
  if (!m) return say('That form is not one this bot made.');
  const [, channel, message] = m;
  const notes = String(field(interaction.data.components, 'notes') || '').trim();
  const post = await fetchPost(env, channel, message);
  const no = refusal(env, post);
  if (no) return say(no);

  const [embed, ...others] = post.embeds;
  const description = withNotes(embed.description, notes);
  if (description.length > DESCRIPTION_CAP) {
    return say(`That announcement's list leaves room for ${Math.max(0, DESCRIPTION_CAP - (description.length - notes.length))} characters of notes; nothing was changed.`);
  }
  // Notes kept in the text before they moved into the embed go, so they are not shown twice.
  const content = splitNotes(post.content, OLD_HEADER)[1];
  const body = {
    embeds: [{ ...embed, description }, ...others],
    // Editing never pings; the mentions already there are named so they stay mentions.
    allowed_mentions: { parse: [], roles: [...String(content).matchAll(/<@&(\d+)>/g)].map((r) => r[1]) },
  };
  if (content !== post.content) body.content = content;

  // A post is edited by whoever made it: the webhook its own, the bot its own.
  if (post.webhook_id) {
    await discord('PATCH', hook(env, `/messages/${message}`), body);
  } else {
    await discord('PATCH', `${env.DISCORD_API || API}/channels/${channel}/messages/${message}`, body, env.DISCORD_BOT_TOKEN);
  }
  const link = `https://discord.com/channels/${interaction.guild_id}/${channel}/${message}`;
  return say(notes ? `DM's Notes saved: ${link}` : `DM's Notes removed: ${link}`);
}

// The notes sit at the top of the embed's description, above the update's list:
//
//   **DM's Notes**
//   > first line
//
//   **Edited**
//   • ...
export function splitNotes(text, header = HEADER) {
  const lines = String(text || '').split('\n');
  if (lines[0] !== header) return ['', String(text || '')];
  let i = 1;
  const notes = [];
  for (; i < lines.length && lines[i].startsWith('>'); i++) notes.push(lines[i].replace(/^> ?/, ''));
  if (lines[i] === '') i++;
  return [notes.join('\n'), lines.slice(i).join('\n')];
}

export function withNotes(text, notes, header = HEADER) {
  const rest = splitNotes(text, header)[1];
  if (!notes) return rest;
  return `${header}\n${notes.split('\n').map((l) => `> ${l}`).join('\n')}\n\n${rest}`.trimEnd();
}

// A form's value, in a Label or in the Action Row older forms used; for a
// select, the first thing chosen.
export function field(components, id) {
  for (const c of components || []) {
    if (c.custom_id === id) return c.value ?? c.values?.[0];
    const found = field([c.component, ...(c.components || [])].filter(Boolean), id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function webhookId(env) {
  return String(env.WIKI_WEBHOOK_URL || '').match(/\/webhooks\/(\d+)\//)?.[1] || null;
}

function hook(env, suffix) {
  const url = new URL(env.WIKI_WEBHOOK_URL);
  url.pathname = url.pathname.replace(/\/$/, '') + suffix;
  return url.toString();
}

export async function discord(method, url, body = null, botToken = null) {
  const headers = { 'User-Agent': 'DiscordBot (https://github.com/dndAntaera/antaera-bot, 1.0)' };
  if (botToken) headers.Authorization = `Bot ${botToken}`;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) {
    // The webhook's token is in its path; keep it out of the answer.
    const path = new URL(url).pathname.replace(/(\/webhooks\/\d+\/)[^/]+/, '$1…');
    throw new Error(`Discord answered ${response.status} to ${method} ${path}`);
  }
  return response.status === 204 ? null : response.json();
}
