// /embedmsg: a message from the bot, as an embed, in a channel of the admin's choosing.
//
//   /embedmsg             opens a form: the channel, from a dropdown, and the
//                         message; sending it posts the message as an embed
//                         in that channel, as the bot
//
// The message can run to several lines and use Discord's formatting. Nothing
// in it can ping anyone. Only a server admin can use it, as with /dmnotes:
// registered for the Administrator permission, and checked again here.
//
// Settings: DISCORD_BOT_TOKEN. The bot needs View Channel, Send Messages and
// Embed Links in the channel it posts to.

import { json } from '../http.js';
import { say, isAdmin, field, discord } from './dmnotes.js';

const MODAL = 9;
const API = 'https://discord.com/api/v10';
const PREFIX = 'embedmsg:';
const COLOR = 0x7c5cff;
// An embed's description caps at 4096 characters; a form's text box at 4000.
const MAX_MESSAGE = 4000;

export const isEmbedMsg = (interaction) => interaction.data?.name === 'embedmsg'
  || String(interaction.data?.custom_id || '').startsWith(PREFIX);

/** /embedmsg, or the form it opened coming back. */
export async function embedMsg(env, interaction) {
  if (!isAdmin(interaction)) return say('Only server admins can use /embedmsg.');
  if (!env.DISCORD_BOT_TOKEN) return say('/embedmsg is not set up on this server yet.');
  return interaction.data?.custom_id ? post(env, interaction) : openForm();
}

function openForm() {
  return json({
    type: MODAL,
    data: {
      custom_id: PREFIX + 'form',
      title: 'Embedded message',
      components: [{
        type: 18,
        label: 'Channel',
        description: 'Where the bot posts it.',
        // Text and announcement channels.
        component: { type: 8, custom_id: 'channel', channel_types: [0, 5], min_values: 1, max_values: 1, required: true },
      }, {
        type: 18,
        label: 'Message',
        description: 'Posted by the bot as an embed. Discord formatting works.',
        component: { type: 4, custom_id: 'message', style: 2, required: true, max_length: MAX_MESSAGE },
      }],
    },
  });
}

async function post(env, interaction) {
  if (interaction.data.custom_id !== PREFIX + 'form') return say('That form is not one this bot made.');
  const channel = String(field(interaction.data.components, 'channel') || '');
  if (!/^\d{1,25}$/.test(channel)) return say('Choose the channel to post in.');
  const message = String(field(interaction.data.components, 'message') || '').trim();
  if (!message) return say('There was no message to post.');
  try {
    const posted = await discord('POST', `${env.DISCORD_API || API}/channels/${channel}/messages`, {
      embeds: [{ description: message, color: COLOR }],
      allowed_mentions: { parse: [] },
    }, env.DISCORD_BOT_TOKEN);
    return say(`Posted in <#${channel}>: https://discord.com/channels/${interaction.guild_id}/${channel}/${posted.id}`);
  } catch (err) {
    if (/ 40[13] /.test(err.message)) {
      return say(`I can't post in <#${channel}>. Give me View Channel, Send Messages and Embed Links there.`);
    }
    return say(`I couldn't post the message: ${err.message}`);
  }
}
