# bot-fakezxc

A minimal Discord bot built with discord.js 14.27.0. It registers a global `/hello` slash command and replies with `Hello World!`.

## Required environment variables

- `DISCORD_TOKEN`: the bot token. Store it only in Waifly's server environment or in a server-side `.env` file; never commit the real value.
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

Set Runtime to `node`, Node.js Version to `22`, Main File (Node.js) to `index.js`, Git Repo Address to this repository, and Install Branch to `main`. Enable Auto Update. Keep User Uploaded Files disabled.

If Waifly does not provide environment variable fields, create a file named `.env` in the server's Files tab after the repository has been cloned:

```env
DISCORD_TOKEN=your_regenerated_bot_token
DISCORD_CLIENT_ID=1562976882872426517
```

The bot loads `.env` using Node.js's built-in environment-file support. The `.env` file is ignored by Git and must stay on the server; never upload it to GitHub. Restart the server after creating or changing it. The bot registers the global slash command on each start; global command updates can take a while to appear in Discord.
