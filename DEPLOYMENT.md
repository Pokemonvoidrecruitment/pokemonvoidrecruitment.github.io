# Deployment checklist

## 1. Discord Developer Portal
- Create an application and bot.
- OAuth2 redirect URI: `https://YOUR-DOMAIN/auth/discord/callback`
- OAuth2 scope: `identify`
- Enable Server Members Intent for role-based Director authorization.
- Invite the bot to the recruitment server with permission to view/send in the Director channel.

## 2. Environment
Copy `.env.example` to `.env` and set:
- `PUBLIC_BASE_URL=https://YOUR-DOMAIN`
- `DISCORD_REDIRECT_URI=https://YOUR-DOMAIN/auth/discord/callback`
- Discord client ID/secret and bot token
- `DISCORD_GUILD_ID`
- `DIRECTOR_ROLE_ID`
- `DIRECTOR_CHANNEL_ID`
- `INTERNAL_EVENT_SECRET` to a long random value

`DIRECTOR_DISCORD_IDS` is an optional emergency/explicit allow-list.

## 3. Start
```bash
npm install
NODE_ENV=production npm start
```

The backend serves the existing Team Application from `/public`, so the same domain provides both the web app and `/api` endpoints. This avoids cross-origin cookies and is the simplest production deployment.

## 4. Data boundary
The application backend stores application records and interview records. The Discord integration does not store application answers. Discord notifications contain only metadata such as application ID, applicant display name, roles, and status.

## 5. Recommended production hardening
- Use HTTPS.
- Restrict the Director channel so only recruitment staff can see it.
- Back up the application database securely.
- Rotate OAuth/bot credentials if exposed.
- Consider PostgreSQL instead of SQLite if you deploy multiple backend instances.
