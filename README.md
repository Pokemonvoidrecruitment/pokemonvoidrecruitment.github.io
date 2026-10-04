# Pokémon Void Recruitment Backend

This is the production-oriented backend for the existing Team Application front end plus Discord notification/DM integration.

## Responsibilities
- Discord OAuth login and session handling.
- Store application records in the application backend's SQLite database.
- Provide the existing front end's `/api/*` contract.
- Director authorization by Discord role and/or explicit Discord IDs.
- Claim/release applications and change statuses.
- Create interview records when an application enters Interview.
- Notify Directors in a Discord channel.
- Optionally DM applicants on Interview/Accepted/Declined.
- Keep application answers out of Discord embeds and out of the Discord bot's own storage.

## Production notes
Use HTTPS. Put the backend behind a reverse proxy. Set `FRONTEND_ORIGIN` to the exact site origin. Use a long random `INTERNAL_EVENT_SECRET`. Back up the application database securely. The sample SQLite deployment is suitable for a small team; PostgreSQL can be substituted later if desired.

## Discord setup
1. Create a Discord application/bot.
2. Enable the Server Members intent if you want Director-role authorization.
3. Add the bot to the recruitment server with permission to view/send messages in the Director channel and DM users.
4. Create a Discord OAuth2 redirect URI matching `DISCORD_REDIRECT_URI`.
5. Put the Director role ID and channel ID in `.env`.

## Run
```bash
npm install
cp .env.example .env
# fill .env
npm start
```

The front end should set `assets/js/config.js` to the public backend origin, for example:
```js
window.VOID_RECRUITMENT = {
  apiBaseUrl: "https://api.example.com",
  discordLoginPath: "/auth/discord"
};
```
