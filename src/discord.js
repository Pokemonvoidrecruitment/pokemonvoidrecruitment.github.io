import { Client, GatewayIntentBits, Partials, EmbedBuilder } from "discord.js";
import { config } from "./config.js";
import { statements } from "./db.js";

export let discord = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

function setupMessageListener(client) {
  client.on("messageCreate", async (message) => {
    // Only handle DMs from real users (ignore bots and guild channels)
    if (message.author.bot || message.guild) return;

    const userId = message.author.id;
    const app = statements.activeByDiscord.get(userId);

    if (!app) {
      await message.reply({
        content: "👋 Hello! You do not currently have an active application with Pokémon Void recruitment.\nIf you would like to apply, please submit an application here: https://pokemonvoidrecruitment.github.io/apply"
      }).catch(() => {});
      return;
    }

    if (app.status !== "Interview") {
      await message.reply({
        content: `Your application (**${app.id}**) is currently in the **${app.status}** stage.\nWhen our directors invite you to an interview, you can chat with them directly right here in DMs!\nStatus Portal: https://pokemonvoidrecruitment.github.io/status`
      }).catch(() => {});
      return;
    }

    // Interview stage is active: save message to interview ticket
    let ticket = statements.interview.get(app.id);
    const now = new Date();
    if (!ticket) {
      statements.saveInterview.run(app.id, "Interview", "[]", now.toISOString());
      ticket = statements.interview.get(app.id);
    }

    let text = (message.content || "").trim();
    if (message.attachments && message.attachments.size > 0) {
      const urls = Array.from(message.attachments.values()).map(a => a.url).join("\n");
      text = text ? `${text}\n${urls}` : urls;
    }

    if (!text) return;

    let messages = [];
    try { messages = JSON.parse(ticket.messages_json || "[]"); } catch {}

    const entry = {
      senderLabel: message.author.globalName || message.author.username || app.display_name,
      senderType: "applicant",
      sentAt: now.toLocaleString(),
      timestamp: now.toISOString(),
      body: text
    };
    messages.push(entry);

    const updatedNow = now.toISOString();
    statements.saveInterview.run(app.id, ticket.status, JSON.stringify(messages), updatedNow);

    // React with a checkmark so applicant knows their message reached the Director Desk
    await message.react("✅").catch(() => {});

    console.log(`[discord] Received DM from ${message.author.tag} (${userId}) for ${app.id} -> Saved to interview ticket`);
  });
}

setupMessageListener(discord);

export async function startDiscord(){
  if(!config.discord.botToken) {
    console.log("[discord] No DISCORD_BOT_TOKEN provided; running in local/offline mode.");
    return;
  }
  try {
    await discord.login(config.discord.botToken);
    console.log(`[discord] Connected as ${discord.user?.tag} (with DirectMessages intent)`);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("disallowed intent")) {
      console.warn("[discord] Privileged intent not enabled. Retrying with basic Guilds & DirectMessages intent...");
      try {
        discord.destroy();
        discord = new Client({
          intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
          partials: [Partials.Channel, Partials.Message]
        });
        setupMessageListener(discord);
        await discord.login(config.discord.botToken);
        console.log(`[discord] Connected as ${discord.user?.tag} (DirectMessages active)`);
      } catch (err2) {
        console.warn(`[discord] Bot fallback login failed: ${err2.message}`);
      }
    } else {
      console.warn(`[discord] Bot login failed: ${err.message}. Running in fallback mode.`);
    }
  }
}

const directorCache = new Map(); // userId -> { isDirector: boolean, expiresAt: number }

export async function isDirector(userId){
  if(!userId) return false;
  if(config.discord.directorIds.has(userId)) return true;
  if(!discord.isReady() || !config.discord.guildId || !config.discord.directorRoleId) return false;
  
  const cached = directorCache.get(userId);
  if(cached && cached.expiresAt > Date.now()) return cached.isDirector;

  try {
    const guild = await discord.guilds.fetch(config.discord.guildId);
    const member = await guild.members.fetch(userId);
    const result = Boolean(member && member.roles.cache.has(config.discord.directorRoleId));
    console.log(`[discord] Role check for user ${userId} (${member.user.tag}): ${result ? "DIRECTOR" : "NOT A DIRECTOR"}`);
    directorCache.set(userId, { isDirector: result, expiresAt: Date.now() + 60000 });
    return result;
  } catch (err) {
    console.warn(`[discord] Failed to check director role for ${userId}: ${err.message}`);
    directorCache.set(userId, { isDirector: false, expiresAt: Date.now() + 30000 });
    return false;
  }
}

const statusColors = {
  "Submitted": 0x3b82f6,      // Blue: New submission
  "In review": 0x8b5cf6,      // Purple: Review in progress
  "Interview": 0x06b6d4,      // Cyan / Teal: Interview stage
  "Flagged": 0xf97316,        // Orange: Attention needed
  "On hold": 0x64748b,        // Slate Gray: Paused
  "Accepted": 0x22c55e,       // Emerald Green: Application accepted
  "Declined": 0xef4444,       // Red: Declined
  "Archived": 0x475569        // Dark Gray: Archived
};

const eventColors = {
  "NEW_APPLICATION": 0x3b82f6,      // Blue
  "NEW_INTERVIEW_MESSAGE": 0x0ea5e9, // Sky Blue
  "STATUS_CHANGED": 0x8b5cf6        // Purple
};

function getEmbedColor(status, event) {
  if (status && statusColors[status]) return statusColors[status];
  if (event && eventColors[event]) return eventColors[event];
  return 0x5865f2; // Default Discord Blurple
}

export async function notifyDirectors({event,applicationId,displayName,roles,status,preview}){
  if(!discord.isReady() || !config.discord.directorChannelId) return;

  // Suppress automated notifications for test runners and dev accounts
  const isTestUser = displayName && (
    displayName.toLowerCase().startsWith("dev-") ||
    displayName === "Red" ||
    displayName === "Ash Ketchum"
  );
  if (isTestUser) {
    console.log(`[discord] Skipping notification for automated test user: ${displayName}`);
    return;
  }

  try {
    const channel = await discord.channels.fetch(config.discord.directorChannelId).catch(()=>null);
    if(!channel?.isTextBased()) return;
    const color = getEmbedColor(status, event);
    const embed = new EmbedBuilder()
      .setTitle(`Recruitment: ${event.replaceAll("_"," ")}`)
      .setColor(color)
      .setTimestamp();

    embed.addFields(
      {name:"Application",value:applicationId || "—",inline:true},
      {name:"Applicant",value:displayName || "Applicant",inline:true},
      {name:"Roles",value:(roles||[]).join(", ") || "—",inline:true},
      ...(status ? [{name:"Status",value:status,inline:true}] : []),
      ...(preview ? [{name:"Message Preview",value:preview.length > 500 ? preview.slice(0, 497) + "..." : preview, inline: false}] : [])
    );

    const portalUrl = `${(config.frontendOrigin || "https://pokemonvoidrecruitment.github.io").replace(/\/$/, "")}/admin`;
    embed.setDescription(`[Open Director Desk](${portalUrl})`);

    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch(err) {
    console.warn("[discord] Notification dispatch failed:", err.message);
  }
}

export async function dmApplicant(userId, message){
  if(!config.discord.applicantDMs || !discord.isReady() || !userId) return;
  if(String(userId).startsWith("dev-") || String(userId) === "dev-applicant-red") return;
  try {
    const user = await discord.users.fetch(userId).catch(()=>null);
    if (!user) {
      console.warn(`[discord] Could not fetch user ${userId} to dispatch DM.`);
      return;
    }
    const payload = typeof message === "string" ? { content: message } : message;
    await user.send(payload);
    console.log(`[discord] Dispatched recruitment DM to ${user.tag} (${userId})`);
  } catch (err) {
    console.warn(`[discord] Failed to DM user ${userId}:`, err.message);
  }
}

