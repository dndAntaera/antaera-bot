// /dmnotes: the DM's own thoughts at the top of the wiki's latest announcement.
//
// The wiki (antaera_Wiki, .github/scripts/announce.py) posts its update
// announcements as this bot (through a webhook, before it could). /dmnotes
// opens a form for the DM's Notes; saving it writes them into that message's
// text, above the ping, and running it again edits them. An empty form takes them off. The wiki only
// ever edits the announcement's embed, so its later edits leave the notes be.
//
// Only a server admin can use it: the command is registered for the
// Administrator permission (scripts/discord-commands.json), and the
// permission is checked again here, since a server can loosen the first.
//
// Settings, both secrets:
//   WIKI_WEBHOOK_URL    the wiki's webhook: it names the announcement channel,
//                       and only it can edit the posts it made
//   DISCORD_BOT_TOKEN   to read the announcement channel for the latest post,
//                       and to edit the bot's own; the bot must be in the
//                       server with View Channel and Read Message History
// and DISCORD_APPLICATION_ID, a var in wrangler.toml.
// Without them the command says it is not set up.

import { json } from '../http.js';

const MESSAGE = 4;
const MODAL = 9;
const EPHEMERAL = 64;
const ADMINISTRATOR = 1n << 3n;
const API = 'https://discord.com/api/v10';
const HEADER = "### DM's Notes";
// A message's text caps at 2000 characters, shared with the heading and ping.
const MAX_NOTES = 1800;
const PREFIX = 'dmnotes:';

const say = (content) => json({ type: MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });

export const isDmNotes = (interaction) => interaction.data?.name === 'dmnotes'
  || String(interaction.data?.custom_id || '').startsWith(PREFIX);

function isAdmin(interaction) {
  try {
    return (BigInt(interaction.member?.permissions ?? 0) & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

/** /dmnotes, or the form it opened coming back. */
export async function dmNotes(env, interaction) {
  if (!isAdmin(interaction)) return say('Only server admins can use /dmnotes.');
  if (!env.WIKI_WEBHOOK_URL || !env.DISCORD_BOT_TOKEN) return say('/dmnotes is not set up on this server yet.');
  try {
    return interaction.data?.custom_id ? await save(env, interaction) : await openForm(env);
  } catch (err) {
    return say(`I couldn't reach the announcement: ${err.message}`);
  }
}

async function openForm(env) {
  const post = await latestAnnouncement(env);
  if (!post) return say("There's no wiki announcement to add notes to yet.");
  const input = { type: 4, custom_id: 'notes', style: 2, required: false, max_length: MAX_NOTES };
  const current = splitNotes(post.content)[0];
  if (current) input.value = current;
  return json({
    type: MODAL,
    data: {
      custom_id: PREFIX + post.id,
      title: "DM's Notes",
      components: [{
        type: 18,
        label: 'Your thoughts on this update',
        description: 'Shown at the top of the latest announcement. Leave empty to remove them.',
        component: input,
      }],
    },
  });
}

async function save(env, interaction) {
  const id = interaction.data.custom_id.slice(PREFIX.length);
  if (!/^\d{1,25}$/.test(id)) return say('That form is not one this bot made.');
  const notes = String(field(interaction.data.components, 'notes') || '').trim();
  const webhook = await discord('GET', hook(env, ''));
  const botUrl = `${env.DISCORD_API || API}/channels/${webhook.channel_id}/messages/${id}`;
  const post = await discord('GET', botUrl, null, env.DISCORD_BOT_TOKEN);
  const content = withNotes(post.content, notes);
  if (content.length > 2000) return say(`Those notes are ${content.length - 2000} characters too long; nothing was changed.`);
  // A post is edited by whoever made it: the webhook its own, the bot its own.
  const [url, token] = post.webhook_id ? [hook(env, `/messages/${id}`), null] : [botUrl, env.DISCORD_BOT_TOKEN];
  // Editing never pings; the mentions already there are named so they stay mentions.
  await discord('PATCH', url, {
    content,
    allowed_mentions: { parse: [], roles: [...content.matchAll(/<@&(\d+)>/g)].map((m) => m[1]) },
  }, token);
  const link = `https://discord.com/channels/${interaction.guild_id}/${post.channel_id}/${post.id}`;
  return say(notes ? `DM's Notes saved: ${link}` : `DM's Notes removed: ${link}`);
}

async function latestAnnouncement(env) {
  const webhook = await discord('GET', hook(env, ''));
  const messages = await discord('GET', `${env.DISCORD_API || API}/channels/${webhook.channel_id}/messages?limit=50`,
    null, env.DISCORD_BOT_TOKEN);
  // Newest first. The wiki posts as this bot, or (before it did) through the
  // webhook. Its announcements are titled "... updated"; the bot's rolls and
  // the wiki's test posts are passed over.
  const poster = (m) => m.webhook_id === webhook.id || (!m.webhook_id && m.author?.id === env.DISCORD_APPLICATION_ID);
  return messages.find((m) => poster(m) && / updated$/.test(m.embeds?.[0]?.title || '')) || null;
}

// The notes sit above everything else in the message's text:
//
//   ### DM's Notes
//   > first line
//
//   Ping: || @Scars ||
export function splitNotes(content) {
  const lines = String(content || '').split('\n');
  if (lines[0] !== HEADER) return ['', String(content || '')];
  let i = 1;
  const notes = [];
  for (; i < lines.length && lines[i].startsWith('>'); i++) notes.push(lines[i].replace(/^> ?/, ''));
  if (lines[i] === '') i++;
  return [notes.join('\n'), lines.slice(i).join('\n')];
}

export function withNotes(content, notes) {
  const rest = splitNotes(content)[1];
  if (!notes) return rest;
  return `${HEADER}\n${notes.split('\n').map((l) => `> ${l}`).join('\n')}\n\n${rest}`.trimEnd();
}

// A form's value, in a Label or in the Action Row older forms used.
function field(components, id) {
  for (const c of components || []) {
    if (c.custom_id === id) return c.value;
    const found = field([c.component, ...(c.components || [])].filter(Boolean), id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function hook(env, suffix) {
  const url = new URL(env.WIKI_WEBHOOK_URL);
  url.pathname = url.pathname.replace(/\/$/, '') + suffix;
  return url.toString();
}

async function discord(method, url, body = null, botToken = null) {
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
