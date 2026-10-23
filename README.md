# Ritmo + Discord bot

This repository contains the Ritmo habit tracker interface and a discord.js 14.27.0 bot. One Node.js process serves the site and connects the bot to Discord.

## Run locally

Requires Node.js 22 or newer.

1. Copy `.env.example` to `.env` and fill in the bot token.
2. Run `npm install`.
3. Run `npm start`.
4. Open http://localhost:3000.

The site is served from `public/`. Its current prototype data is stored in the browser's localStorage. It is not yet shared with Discord or other devices.

## Required environment variables

- `DISCORD_TOKEN`: the bot token. Keep it in a local `.env` or Waifly server file; never commit it.
- `DISCORD_CLIENT_ID`: the Discord application ID, currently `1562976882872426517`.
- `SERVER_PORT` or `PORT`: the public port assigned by Waifly. Local development defaults to `3000`.

## Waifly

Use Runtime `node`, Node.js `22`, Main File `index.js`, Git Repo Address `https://github.com/Fake-zzz/bot-fakezxc`, and branch `main`. Enable Auto Update and leave User Uploaded Files disabled.

Keep the existing server-side `.env` file in the server root, beside `index.js`:

```env
DISCORD_TOKEN=your_regenerated_bot_token
DISCORD_CLIENT_ID=1562976882872426517
```

The server reads Waifly's `SERVER_PORT` allocation and binds the website to `0.0.0.0`. With the primary allocation shown for this server, the site should be reachable at `http://node4.waifly.com:25054` after the updated repository is pulled and the server restarts.

The web UI currently stores information only in each visitor's browser. A shared database and API are a separate next step.
