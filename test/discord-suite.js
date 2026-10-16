// Tests for the Discord bot: the signature check, then commands - who is
// recognized, which character rolls, and what comes back - against the real
// Worker. Commands are handed to handleInteraction once a signature has been
// checked, so they run in any browser; the signature itself is tested wherever
// this browser can make an Ed25519 key.
//
// Uses the plumbing from worker-suite.js. Run through test/worker.html.

import { call, signIn, people, googler, discorder, env } from './worker-suite.js';
import worker from '../worker/src/index.js';
import { verifyDiscord, handleInteraction, SHORTCUTS } from '../worker/src/features/discord.js';

const account = async (profile, provider = 'google') => {
  people[provider] = profile;
  const s = await signIn(provider);
  const me = (await call('GET', '/api/me', { token: s.token })).data;
  return { token: s.token, id: me.id, name: me.name };
};

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** A character saved with the snapshot the app writes. */
const rollsFor = (name) => ({
  version: 1,
  name,
  build: 'Half-Orc Fighter 3',
  level: 3,
  hp: { max: 28, current: 20 },
  ac: { total: 17, touch: 11, flatFooted: 16 },
  speed: 30,
  initiative: 1,
  bab: 3,
  melee: 6,
  ranged: 4,
  grapple: 6,
  abilities: { str: { score: 16, mod: 3 }, dex: { score: 12, mod: 1 }, con: { score: 14, mod: 2 }, int: { score: 8, mod: -1 }, wis: { score: 10, mod: 0 }, cha: { score: 8, mod: -1 } },
  saves: { fort: 5, ref: 2, will: 1 },
  skills: [{ name: 'Climb', total: 7, usable: true }, { name: 'Tumble', total: 1, usable: false }],
  attacks: [{ name: 'Greataxe', bonuses: [7], damage: '1d12+4', critical: '20/x3' }],
});

const commandFrom = (discordId, name, options = []) => ({ type: 2, member: { user: { id: discordId } }, data: { name, options } });
const reply = async (response) => ({ status: response.status, data: await response.json() });

export function buildDiscordSuite() {
  const cases = [];
  const test = (name, run, opts = {}) => cases.push({ name, run, opts });

  test('an interaction must carry Discord’s signature', async (t) => {
    const unset = await worker.fetch(new Request('https://api.test/discord/interactions', { method: 'POST', body: '{"type":1}' }), env);
    t.eq(unset.status, 503, 'with no key set, the bot says it is not set up');

    let keys;
    try {
      keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    } catch {
      t.ok(true, 'this browser cannot make Ed25519 keys; the rest is checked in handleInteraction');
      return;
    }
    const publicKey = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
    const body = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(timestamp + body)));
    t.ok(await verifyDiscord(publicKey, signature, timestamp, body), 'a good signature verifies');
    t.ok(!(await verifyDiscord(publicKey, signature, timestamp, body.replace('1', '2'))), 'a changed body does not');

    const withKey = { ...env, DISCORD_PUBLIC_KEY: publicKey };
    const send = (sig) => worker.fetch(new Request('https://api.test/discord/interactions', {
      method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': timestamp },
    }), withKey);
    t.eq((await reply(await send(signature))).data, { type: 1 }, 'a signed ping is answered');
    t.eq((await send('0'.repeat(128))).status, 401, 'an unsigned one is refused');
  });

  test('a Discord account not signed in to the sheets is told how to join', async (t) => {
    const r = await reply(await handleInteraction(env, commandFrom('d-stranger', 'roll', [{ name: 'what', value: 'climb' }])));
    t.eq(r.data.type, 4);
    t.ok(/Sign in to the sheets/.test(r.data.data.content) && r.data.data.flags === 64, 'privately');
  });

  test('rolling from a sheet: the only character, a chosen one, and what cannot be rolled', async (t) => {
    const ada = await account(discorder('d-ada', 'ada'), 'discord');
    await call('PUT', '/api/characters/grukk', { token: ada.token, body: { name: 'Grukk', ruleset: 'srd', levels: [{ a: 'Fighter' }], rolls: rollsFor('Grukk') } });

    const climb = await reply(await handleInteraction(env, commandFrom('d-ada', 'roll', [{ name: 'what', value: 'climb +2' }])));
    const embed = climb.data.data.embeds[0];
    t.eq(embed.title, 'Grukk: Climb', 'the only character rolls without being named');
    t.ok(/^1d20 \(\d+\) \+7 \+2 = \*\*\d+\*\*$/.test(embed.description), embed.description);

    const axe = await reply(await handleInteraction(env, commandFrom('d-ada', 'roll', [{ name: 'what', value: 'greataxe' }])));
    t.ok(/Attack: 1d20/.test(axe.data.data.embeds[0].description) && /Damage: 1d12/.test(axe.data.data.embeds[0].description));

    const tumble = await reply(await handleInteraction(env, commandFrom('d-ada', 'roll', [{ name: 'what', value: 'tumble' }])));
    t.ok(/untrained/.test(tumble.data.data.content), 'a trained-only skill with no ranks is refused');

    await call('PUT', '/api/characters/vex', { token: ada.token, body: { name: 'Vex', ruleset: 'srd', levels: [{ a: 'Rogue' }], rolls: rollsFor('Vex') } });
    const which = await reply(await handleInteraction(env, commandFrom('d-ada', 'roll', [{ name: 'what', value: 'fort' }])));
    t.ok(/Which character/.test(which.data.data.content), 'with two, it asks which');
    const chosen = await reply(await handleInteraction(env, commandFrom('d-ada', 'character', [{ name: 'name', value: 'vex' }])));
    t.ok(/Vex/.test(chosen.data.data.content));
    const fort = await reply(await handleInteraction(env, commandFrom('d-ada', 'roll', [{ name: 'what', value: 'fort' }])));
    t.eq(fort.data.data.embeds[0].title, 'Vex: Fortitude save', 'and remembers the choice');

    const sheet = await reply(await handleInteraction(env, commandFrom('d-ada', 'sheet', [{ name: 'character', value: 'Grukk' }])));
    t.eq(sheet.data.data.embeds[0].fields[0], { name: 'AC', value: '17 (touch 11, flat-footed 16)', inline: true });

    const suggest = await reply(await handleInteraction(env, { type: 4, member: { user: { id: 'd-ada' } }, data: { name: 'roll', options: [{ name: 'what', value: 'gre', focused: true }, { name: 'character', value: 'grukk' }] } }));
    t.eq(suggest.data.data.choices[0], { name: 'Greataxe', value: 'Greataxe' }, 'what to roll autocompletes from the sheet');
  });

  test('the shortcuts: /r is /roll, /s is /sheet, /c is /character', async (t) => {
    const eve = await account(discorder('d-eve', 'eve'), 'discord');
    await call('PUT', '/api/characters/brin', { token: eve.token, body: { name: 'Brin', ruleset: 'srd', levels: [{ a: 'Fighter' }], rolls: rollsFor('Brin') } });
    await call('PUT', '/api/characters/tam', { token: eve.token, body: { name: 'Tam', ruleset: 'srd', levels: [{ a: 'Rogue' }], rolls: rollsFor('Tam') } });

    const chosen = await reply(await handleInteraction(env, commandFrom('d-eve', 'c', [{ name: 'name', value: 'tam' }])));
    t.ok(/Tam/.test(chosen.data.data.content), '/c chooses the character');
    const dice = await reply(await handleInteraction(env, commandFrom('d-eve', 'r', [{ name: 'what', value: '1d6' }])));
    t.ok(/^1d6 \(\d\) = \*\*\d\*\*$/.test(dice.data.data.embeds[0].description), dice.data.data.embeds[0].description);
    const sheet = await reply(await handleInteraction(env, commandFrom('d-eve', 's')));
    t.eq(sheet.data.data.embeds[0].title, 'Tam', '/s shows the chosen one');
    const suggest = await reply(await handleInteraction(env, { type: 4, member: { user: { id: 'd-eve' } }, data: { name: 'r', options: [{ name: 'what', value: 'gre', focused: true }] } }));
    t.eq(suggest.data.data.choices[0]?.value, 'Greataxe', 'and /r autocompletes as /roll does');

    // What is registered with Discord must be what the bot answers.
    const registered = await (await fetch(new URL('../scripts/discord-commands.json', import.meta.url))).json();
    const byName = Object.fromEntries(registered.map((c) => [c.name, c]));
    for (const [short, long] of Object.entries(SHORTCUTS)) {
      t.ok(byName[short], `/${short} is registered`);
      t.eq(byName[short]?.options, byName[long]?.options, `/${short} takes what /${long} does`);
    }
  });

  test('a character from before rolling arrived asks to be opened once', async (t) => {
    const cai = await account(discorder('d-cai', 'cai'), 'discord');
    await call('PUT', '/api/characters/old', { token: cai.token, body: { name: 'Oldie', ruleset: 'srd', levels: [{}] } });
    const r = await reply(await handleInteraction(env, commandFrom('d-cai', 'roll', [{ name: 'what', value: 'will' }])));
    t.ok(/Open the sheet once/.test(r.data.data.content));
    const other = await account(googler('g-dee', 'Dee', 'dee@example.com'));
    t.ok(other.id, 'someone else signed in with Google only');
    const theirs = await reply(await handleInteraction(env, commandFrom('d-cai', 'roll', [{ name: 'what', value: 'will' }, { name: 'character', value: 'Nobody' }])));
    t.ok(/None of your characters/.test(theirs.data.data.content));
  });

  test('/dmnotes: admins write the DM’s Notes atop the wiki’s latest announcement', async (t) => {
    // The wiki's webhook and channel, faked at the network for this test.
    const ping = 'Ping: || <@&555> ||';
    const posts = {
      '30': { id: '30', channel_id: 'C', webhook_id: 'W', content: ping, embeds: [{ title: 'Antæra Wiki updated (test)' }] },
      '20': { id: '20', channel_id: 'C', webhook_id: 'W', content: ping, embeds: [{ title: 'Antæra Wiki updated' }] },
    };
    let order = ['30', '20']; // newest first
    const outer = globalThis.fetch;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.host !== 'wiki.discord.test') return outer(input, init);
      if (url.pathname === '/api/webhooks/W/tok') return reply({ id: 'W', channel_id: 'C', guild_id: 'G' });
      if (url.pathname === '/api/v10/channels/C/messages') {
        return init.headers?.Authorization === 'Bot bot-token' ? reply(order.map((id) => posts[id])) : reply({}, 401);
      }
      // The bot reads any post, and edits only its own; the webhook edits only its own.
      const bot = url.pathname.match(/^\/api\/v10\/channels\/C\/messages\/(\d+)$/);
      if (bot && posts[bot[1]]) {
        if (init.headers?.Authorization !== 'Bot bot-token') return reply({}, 401);
        if ((init.method || 'GET') === 'PATCH') {
          if (posts[bot[1]].webhook_id) return reply({ message: 'Cannot edit a message authored by another user' }, 403);
          Object.assign(posts[bot[1]], JSON.parse(init.body));
        }
        return reply(posts[bot[1]]);
      }
      const m = url.pathname.match(/^\/api\/webhooks\/W\/tok\/messages\/(\d+)$/);
      if (m && posts[m[1]]) {
        if ((init.method || 'GET') === 'PATCH' && !posts[m[1]].webhook_id) return reply({ message: 'Unknown Webhook' }, 403);
        if ((init.method || 'GET') === 'PATCH') Object.assign(posts[m[1]], JSON.parse(init.body));
        return reply(posts[m[1]]);
      }
      return reply({ message: 'Unknown Message' }, 404);
    };
    try {
      const wiki = { ...env, DISCORD_APPLICATION_ID: 'APP', WIKI_WEBHOOK_URL: 'https://wiki.discord.test/api/webhooks/W/tok', DISCORD_BOT_TOKEN: 'bot-token', DISCORD_API: 'https://wiki.discord.test/api/v10' };
      const admin = { user: { id: 'd-dm' }, permissions: '8' };
      const open = (member, e = wiki) => handleInteraction(e, { type: 2, guild_id: 'G', member, data: { name: 'dmnotes' } });
      const submit = (value, member = admin, id = '20') => handleInteraction(wiki, { type: 5, guild_id: 'G', member, data: {
        custom_id: `dmnotes:${id}`, components: [{ type: 18, id: 1, component: { type: 4, id: 2, custom_id: 'notes', value } }] } });

      let r = await reply(await open({ user: { id: 'd-player' }, permissions: '1024' }));
      t.ok(/Only server admins/.test(r.data.data.content) && r.data.data.flags === 64, 'a member who is not an admin is turned away, privately');
      r = await reply(await submit('sneaky', { user: { id: 'd-player' }, permissions: '0' }));
      t.ok(!posts['20'].content.includes('sneaky'), 'and so is a form they send anyway');
      r = await reply(await open(admin, env));
      t.ok(/not set up/.test(r.data.data.content), 'without its settings it says so');

      r = await reply(await open(admin));
      t.eq(r.data.type, 9, 'an admin gets the form, with no sheets account needed');
      t.eq(r.data.data.custom_id, 'dmnotes:20', 'for the latest announcement, the test post passed over');

      r = await reply(await submit('  The calendar has a home now.\nMore soon.  '));
      t.eq(posts['20'].content, `### DM's Notes\n> The calendar has a home now.\n> More soon.\n\n${ping}`, 'the notes go at the very top, above the ping');
      t.eq(posts['20'].allowed_mentions, { parse: [], roles: ['555'] }, 'the ping stays a mention, and nothing new can ping');
      t.ok(/saved: https:\/\/discord.com\/channels\/G\/C\/20/.test(r.data.data.content), 'and the DM gets a link to the post');

      r = await reply(await open(admin));
      t.eq(r.data.data.components[0].component.value, 'The calendar has a home now.\nMore soon.', 'running it again shows the notes to edit');
      await submit('Rewritten.');
      t.eq(posts['20'].content, `### DM's Notes\n> Rewritten.\n\n${ping}`, 'new notes replace the old');
      r = await reply(await submit('x'.repeat(1990)));
      t.ok(/too long/.test(r.data.data.content) && posts['20'].content.includes('Rewritten.'), 'notes that would not fit change nothing');
      r = await reply(await submit('   '));
      t.eq(posts['20'].content, ping, 'an empty form takes them off');

      // Announcements the bot itself posts, as the wiki does now.
      posts['40'] = { id: '40', channel_id: 'C', author: { id: 'APP' }, content: ping, embeds: [{ title: 'Antæra Wiki updated' }] };
      posts['50'] = { id: '50', channel_id: 'C', author: { id: 'APP' }, content: '', embeds: [{ title: 'Grukk: Climb' }] };
      order = ['50', '40', '30', '20'];
      r = await reply(await open(admin));
      t.eq(r.data.data.custom_id, 'dmnotes:40', 'the bot’s own announcement is found, its rolls passed over');
      await submit('Posted by the bot.', admin, '40');
      t.eq(posts['40'].content, `### DM's Notes
> Posted by the bot.

${ping}`, 'and the bot edits it itself');
    } finally {
      globalThis.fetch = outer;
    }

    const registered = await (await fetch(new URL('../scripts/discord-commands.json', import.meta.url))).json();
    t.eq(registered.find((c) => c.name === 'dmnotes')?.default_member_permissions, '8', '/dmnotes is registered for Administrators only');
  });

  return cases;
}
