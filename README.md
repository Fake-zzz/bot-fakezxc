# Ritmo + Discord bot

The bot keeps the Ritmo slash-command and sends scheduled task reminders, five-day habit milestones, and daily summaries. The website is hosted separately on GitHub Pages so the login uses HTTPS.

## Waifly settings

Use Runtime `node`, Node.js `22`, Main File `index.js`, and Git repository `https://github.com/Fake-zzz/bot-fakezxc` on branch `main`.

Set these variables in the Waifly panel (or in the server root `.env`):

- `DISCORD_TOKEN`: Discord bot token.
- `DISCORD_CLIENT_ID`: Discord application ID.
- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVER_KEY`: a Supabase secret key (`sb_secret_...`) or legacy `service_role` key. Keep it only on this server.

The notification loop checks every 30 seconds. Configure your Discord user ID, timezone, and daily summary time in the Ritmo site. The bot sends DMs to that Discord account.

## Commands

- `/hello`: replies with `Hello World!`.

Do not add secrets to GitHub or send them in chat.
