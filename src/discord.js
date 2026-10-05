import { Client, GatewayIntentBits, EmbedBuilder } from "discord.js";
import { config } from "./config.js";

export let discord = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

export async function startDiscord(){
  if(!config.discord.botToken) {
    console.log("[discord] No DISCORD_BOT_TOKEN provided; running in local/offline mode.");
    return;
  }
  try {
    await discord.login(config.discord.botToken);
    console.log(`[discord] Connected as ${discord.user?.tag} (with GuildMembers intent)`);
  } catch (err) {
    if (err.message && err.message.toLowerCase().includes("disallowed intent")) {
      console.warn("[discord] GuildMembers privileged intent is not enabled in Developer Portal. Retrying with basic Guilds intent...");
      try {
        discord.destroy();
        discord = new Client({ intents: [GatewayIntentBits.Guilds] });
        await discord.login(config.discord.botToken);
        console.log(`[discord] Connected as ${discord.user?.tag} (Guilds intent active)`);
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

export async function notifyDirectors({event,applicationId,displayName,roles,status}){
  if(!discord.isReady() || !config.discord.directorChannelId) return;
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
      ...(status ? [{name:"Status",value:status,inline:true}] : [])
    );
    if (config.publicBaseUrl) {
      embed.setDescription(`[Open Director Portal](${config.publicBaseUrl}/admin.html)`);
    }
    await channel.send({embeds:[embed]});
  } catch(err) {
    console.warn("[discord] Notification dispatch failed:", err.message);
  }
}

export async function dmApplicant(userId, message){
  if(!config.discord.applicantDMs || !discord.isReady() || !userId) return;
  try {
    const user = await discord.users.fetch(userId).catch(()=>null);
    if(user) await user.send(message).catch(()=>{});
  } catch {}
}

