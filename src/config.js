import "dotenv/config";

function clean(val, fallback = "") {
  return String(val || fallback).trim().replace(/[\r\n]+/g, "");
}

const railwayBase = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${clean(process.env.RAILWAY_PUBLIC_DOMAIN)}` : "";
const defaultBaseUrl = clean(process.env.PUBLIC_BASE_URL || railwayBase || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
const defaultRedirectUri = clean(process.env.DISCORD_REDIRECT_URI || `${defaultBaseUrl}/auth/discord/callback`);

const required = ["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","DISCORD_BOT_TOKEN","DISCORD_GUILD_ID","DIRECTOR_ROLE_ID","DIRECTOR_CHANNEL_ID"];
for (const key of required) {
  if (!process.env[key]) console.warn(`[config] Missing ${key}; related functionality will be unavailable.`);
}
console.log(`[config] OAuth Redirect URI: ${defaultRedirectUri}`);

const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER);

import crypto from "node:crypto";

const stableFallback = crypto.createHash("sha256").update(
  clean(process.env.DISCORD_CLIENT_SECRET || process.env.DISCORD_BOT_TOKEN || "pv-stable-internal-secret-seed")
).digest("hex");
const defaultInternalSecret = stableFallback;

export const config = {
  port: Number(process.env.PORT || 3000),
  isDev: !isProduction,
  isProduction,
  publicBaseUrl: defaultBaseUrl,
  frontendOrigin: clean(process.env.FRONTEND_ORIGIN || "https://pokemonvoidrecruitment.github.io").replace(/\/$/, ""),
  cookieName: clean(process.env.SESSION_COOKIE_NAME || "pv_recruitment"),
  sessionTtlMs: Number(process.env.SESSION_TTL_DAYS || 7) * 86400000,
  discord: {
    clientId: clean(process.env.DISCORD_CLIENT_ID),
    clientSecret: clean(process.env.DISCORD_CLIENT_SECRET),
    redirectUri: defaultRedirectUri,
    botToken: clean(process.env.DISCORD_BOT_TOKEN),
    guildId: clean(process.env.DISCORD_GUILD_ID),
    directorRoleId: clean(process.env.DIRECTOR_ROLE_ID),
    directorChannelId: clean(process.env.DIRECTOR_CHANNEL_ID),
    directorIds: new Set([
      ...clean(process.env.DIRECTOR_DISCORD_IDS || "").split(",").map(x=>x.trim()).filter(Boolean),
      // dev-director is strictly forbidden in production or cloud hosts
      ...(!isProduction && process.env.ENABLE_DEV_LOGIN === "true" ? ["dev-director"] : [])
    ]),
    applicantDMs: process.env.APPLICANT_DMS !== "false"
  },
  internalEventSecret: clean(process.env.INTERNAL_EVENT_SECRET || defaultInternalSecret),
  dbPath: clean(
    process.env.DB_PATH ||
    (process.env.RAILWAY_VOLUME_MOUNT_PATH ? `${process.env.RAILWAY_VOLUME_MOUNT_PATH}/recruitment.sqlite` : "./data/recruitment.sqlite")
  )
};

