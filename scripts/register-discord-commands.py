"""Register the Discord bot's slash commands with Discord.

    set DISCORD_APPLICATION_ID=...   (the application id, from the developer portal)
    set DISCORD_BOT_TOKEN=...        (the bot token, from the portal's Bot page)
    python scripts/register-discord-commands.py [guild id] [--endpoint URL]

Sends scripts/discord-commands.json to Discord, replacing the application's
commands. With a server (guild) id they are registered on that server only,
which shows them at once; without one they are global, which can take a while
to appear everywhere. With no id given but WIKI_WEBHOOK_URL set, the server is
the one the wiki's webhook posts to - which is how the deploy runs it.

--endpoint also sets the application's Interactions Endpoint URL, the address
Discord sends commands to. Discord checks it there and then with a signed
ping, so the Worker must already have DISCORD_PUBLIC_KEY.

The deploy runs this on every push once DISCORD_BOT_TOKEN is a repository
secret, so a change to discord-commands.json needs nothing more. The token is
read from the environment and never written anywhere; keep it that way.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

COMMANDS = Path(__file__).resolve().parent / 'discord-commands.json'
API = 'https://discord.com/api/v10'


def call(method, url, token=None, body=None):
    headers = {'User-Agent': 'DiscordBot (https://github.com/dndAntaera/antaera-sheets, 1.0)'}
    if token:
        headers['Authorization'] = f'Bot {token}'
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read() or b'null')
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors='replace')
        if err.code == 403 and 'guilds/' in url:
            detail += ('\nThe bot is not in that server yet: add it with the invite link in '
                       'MAINTAINING.md ("The Discord bot"), then run this again.')
        sys.exit(f'Discord said {err.code} to {method}: {detail}')


def main():
    app = os.environ.get('DISCORD_APPLICATION_ID', '').strip()
    token = os.environ.get('DISCORD_BOT_TOKEN', '').strip()
    if not app or not token:
        sys.exit('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first.')
    args = sys.argv[1:]
    endpoint = ''
    if '--endpoint' in args:
        i = args.index('--endpoint')
        endpoint = args[i + 1].strip()
        del args[i:i + 2]
    guild = args[0].strip() if args else ''
    webhook = os.environ.get('WIKI_WEBHOOK_URL', '').strip()
    if not guild and webhook:
        guild = call('GET', webhook)['guild_id']

    if endpoint:
        call('PATCH', f'{API}/applications/@me', token, json.dumps({'interactions_endpoint_url': endpoint}).encode())
        print(f'Discord sends the bot\'s commands to {endpoint}.')

    where = f'guilds/{guild}/commands' if guild else 'commands'
    names = [c['name'] for c in call('PUT', f'{API}/applications/{app}/{where}', token, COMMANDS.read_bytes())]
    print(f"Registered {', '.join('/' + n for n in names)} {'on server ' + guild if guild else 'globally'}.")


if __name__ == '__main__':
    main()
