import "dotenv/config";

const required = ["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","DISCORD_REDIRECT_URI","DISCORD_BOT_TOKEN","DISCORD_GUILD_ID","DIRECTOR_ROLE_ID","DIRECTOR_CHANNEL_ID","INTERNAL_EVENT_SECRET"];
for (const key of required) if (!process.env[key]) console.warn(`[config] Missing ${key}; related functionality will be unavailable.`);

export const config = {
  port: Number(process.env.PORT || 3000),
  isDev: process.env.NODE_ENV !== "production",
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, ""),
  frontendOrigin: (process.env.FRONTEND_ORIGIN || "").replace(/\/$/, ""),
  cookieName: process.env.SESSION_COOKIE_NAME || "pv_recruitment",
  sessionTtlMs: Number(process.env.SESSION_TTL_DAYS || 7) * 86400000,
  discord: {
    clientId: process.env.DISCORD_CLIENT_ID || "",
    clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
    redirectUri: process.env.DISCORD_REDIRECT_URI || "",
    botToken: process.env.DISCORD_BOT_TOKEN || "",
    guildId: process.env.DISCORD_GUILD_ID || "",
    directorRoleId: process.env.DIRECTOR_ROLE_ID || "",
    directorChannelId: process.env.DIRECTOR_CHANNEL_ID || "",
    directorIds: new Set([
      ...(process.env.DIRECTOR_DISCORD_IDS || "").split(",").map(x=>x.trim()).filter(Boolean),
      // Automatically include dev-director in development mode
      ...(process.env.NODE_ENV !== "production" ? ["dev-director"] : [])
    ]),
    applicantDMs: process.env.APPLICANT_DMS !== "false"
  },
  internalEventSecret: process.env.INTERNAL_EVENT_SECRET || "dev-internal-secret",
  dbPath: process.env.DB_PATH || "./data/recruitment.sqlite"
};

