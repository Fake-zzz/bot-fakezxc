# bot-fakezxc

A minimal Discord bot built with discord.js 14.27.0. It registers a global `/hello` slash command and replies with `Hello World!`.

## Required environment variables

- `DISCORD_TOKEN`: the bot token. Store it in Waifly's environment/startup variables; never commit it.
- `DISCORD_CLIENT_ID`: the application ID. For this bot: `1562976882872426517`.

## Run locally

Requires Node.js 22 or newer.

```sh
npm install
DISCORD_TOKEN=your_token DISCORD_CLIENT_ID=1562976882872426517 npm start
```

On Windows PowerShell, set the variables for the current session before running `npm start`:

```powershell
$env:DISCORD_TOKEN = "your_token"
$env:DISCORD_CLIENT_ID = "1562976882872426517"
npm start
```

## Waifly

Set the Startup command to `npm start` (or `node index.js`), select Node.js 22, and add both variables in the server's environment/startup settings. Enable Auto Update so the repository is pulled at server startup. The bot registers its slash command on each start; global command updates can take a while to appear in Discord.
