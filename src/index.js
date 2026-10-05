import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { config } from "./config.js";
import { db, statements, appView } from "./db.js";
import { randomToken, sha256, sign, safeEqual } from "./security.js";
import { EmbedBuilder } from "discord.js";
import { startDiscord, isDirector, notifyDirectors, dmApplicant } from "./discord.js";

const app = express();
app.set("trust proxy", 1);

// CORS configuration
const allowedOrigins = new Set([
  config.frontendOrigin,
  config.frontendOrigin ? config.frontendOrigin.replace(/\/$/, "") : null,
  "https://pokemonvoidrecruitment.github.io",
  "http://localhost:3000"
].filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin) || allowedOrigins.has(origin.replace(/\/$/, "")) || config.isDev) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true
}));

// Store rawBody for webhook HMAC verification
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(cookieParser());

const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "../public"), { extensions: ["html"] }));
app.use(express.static(path.join(__dirname, ".."), { extensions: ["html"] }));

async function discordToken(code) {
  const credentials = Buffer.from(`${config.discord.clientId}:${config.discord.clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.discord.redirectUri
  });
  const r = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${credentials}`,
      "User-Agent": "DiscordBot (https://pokemonvoidrecruitment.github.io, 1.0.0)"
    },
    body: params
  });
  if (!r.ok) {
    const errorBody = await r.text();
    console.error(`[discord] Token exchange failed with HTTP ${r.status}:`, errorBody);
    console.error(`[discord] Debug params: client_id=${config.discord.clientId}, redirect_uri=${config.discord.redirectUri}`);
    throw new Error(`Discord OAuth token exchange failed (${r.status}): ${errorBody}`);
  }
  return r.json();
}

async function discordUser(accessToken) {
  const r = await fetch("https://discord.com/api/v10/users/@me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "DiscordBot (https://pokemonvoidrecruitment.github.io, 1.0.0)"
    }
  });
  if (!r.ok) throw new Error("Discord user lookup failed");
  return r.json();
}

function setSession(res, user) {
  const token = randomToken();
  statements.saveSession.run(
    sha256(token),
    user.id,
    user.username || "user",
    user.global_name || user.username || "User",
    new Date(Date.now() + config.sessionTtlMs).toISOString()
  );
  const isCrossSite = Boolean(config.frontendOrigin && !config.frontendOrigin.includes("localhost"));
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || isCrossSite,
    sameSite: isCrossSite ? "none" : "lax",
    maxAge: config.sessionTtlMs,
    path: "/"
  });
}

function currentUser(req) {
  const token = req.cookies[config.cookieName];
  if (!token) return null;
  const row = statements.session.get(sha256(token));
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  return row;
}

async function requireUser(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ message: "Discord sign-in required." });
  req.user = u;
  next();
}

async function requireDirector(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ message: "Discord sign-in required." });
  const director = await isDirector(u.discord_user_id);
  if (!director) return res.status(403).json({ message: "Director access required." });
  req.user = u;
  next();
}

function publicApp(row) {
  const a = appView(row);
  return {
    id: a.id,
    displayName: a.displayName,
    discordUsername: a.discordUsername,
    roles: a.roles,
    status: a.status,
    submittedAt: a.submittedAt,
    updatedAt: a.updatedAt,
    claimedBy: a.claimedBy,
    archived: a.archived
  };
}

function timeline(status) {
  const states = ["Submitted", "In review", "Interview", "On hold", "Accepted", "Declined"];
  const idx = states.indexOf(status);
  return states.map((s, i) => ({
    title: s,
    detail: i === 0
      ? "Application received."
      : s === status
        ? status === "Interview"
          ? "The team has invited you to an interview ticket."
          : `Application is currently ${s.toLowerCase()}.`
        : i < idx
          ? "Completed."
          : "Not reached yet.",
    complete: i <= idx
  }));
}

// Routes
app.get("/health", (_, res) => res.json({ ok: true, devMode: config.isDev }));

// Dev / Testing login (available in non-production environments)
app.get("/auth/dev/login", (req, res) => {
  if (!config.isDev && process.env.ENABLE_DEV_LOGIN !== "true") {
    return res.status(403).send("Dev login is disabled in production.");
  }
  const role = String(req.query.role || "applicant").toLowerCase();
  const name = String(req.query.name || (role === "director" ? "Director Oak" : "Ash Ketchum")).trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "user";
  const user = {
    id: role === "director" ? "dev-director" : `dev-applicant-${slug}`,
    username: slug,
    global_name: name
  };
  setSession(res, user);
  let returnTo = req.query.returnTo || (role === "director" ? "/admin.html" : "/status.html");
  if (!returnTo.startsWith("/") && !returnTo.startsWith("http")) returnTo = "/" + returnTo;
  res.redirect(returnTo);
});

app.get("/auth/dev/admin.html", (req, res) => res.redirect("/admin.html"));
app.get("/auth/dev/status.html", (req, res) => res.redirect("/status.html"));
app.get("/auth/dev/apply.html", (req, res) => res.redirect("/apply.html"));

app.get("/auth/discord", (req, res) => {
  // If Discord credentials are not yet configured, automatically fall back to dev login in dev mode
  if (!config.discord.clientId || !config.discord.clientSecret) {
    if (config.isDev) {
      const returnTo = req.query.returnTo || "/status.html";
      return res.redirect(`/auth/dev/login?role=applicant&returnTo=${encodeURIComponent(returnTo)}`);
    }
    return res.status(503).send("Discord OAuth is not configured on this server.");
  }

  const returnTo = req.query.returnTo || config.frontendOrigin || "/";
  const state = randomToken(24);
  res.cookie("pv_oauth_state", JSON.stringify({ state, returnTo }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600000,
    path: "/"
  });
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", config.discord.clientId);
  url.searchParams.set("redirect_uri", config.discord.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.get("/auth/discord/callback", async (req, res) => {
  try {
    const saved = JSON.parse(req.cookies.pv_oauth_state || "{}");
    if (!saved.state || !safeEqual(saved.state, String(req.query.state || ""))) {
      return res.status(400).send("Invalid OAuth state.");
    }
    res.clearCookie("pv_oauth_state", { path: "/" });
    const token = await discordToken(req.query.code);
    const user = await discordUser(token.access_token);
    setSession(res, user);
    res.redirect(saved.returnTo || config.frontendOrigin || "/");
  } catch (e) {
    console.error(e);
    res.status(502).send("Discord sign-in failed. Please return to the recruitment page and try again.");
  }
});

app.post("/auth/logout", (req, res) => {
  const token = req.cookies[config.cookieName];
  if (token) statements.deleteSession.run(sha256(token));
  res.clearCookie(config.cookieName, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/session", async (req, res) => {
  const u = currentUser(req);
  if (!u) {
    return res.json({
      user: null,
      devMode: config.isDev,
      discordConfigured: Boolean(config.discord.clientId && config.discord.clientSecret)
    });
  }
  const director = await isDirector(u.discord_user_id);
  res.json({
    user: {
      id: u.discord_user_id,
      username: u.username,
      globalName: u.global_name,
      isDirector: director
    },
    devMode: config.isDev,
    discordConfigured: Boolean(config.discord.clientId && config.discord.clientSecret)
  });
});

app.post("/api/application", requireUser, (req, res) => {
  const body = req.body || {};
  const validRoles = ["programmer", "move-animator", "spriter", "music"];
  const roles = (Array.isArray(body.roles) ? body.roles : []).filter(r => validRoles.includes(r));

  if (!body.profile?.name?.trim()) {
    return res.status(400).json({ message: "Preferred name is required." });
  }
  if (!roles.length) {
    return res.status(400).json({ message: "Please select at least one role." });
  }
  if (!body.general?.experience?.trim() || !body.general?.interest?.trim() || !body.general?.critique?.trim() || !body.general?.timeCommitment?.trim()) {
    return res.status(400).json({ message: "Please answer all required background questions." });
  }

  // Prevent multiple pending applications
  const existingActive = statements.activeByDiscord.get(req.user.discord_user_id);
  if (existingActive) {
    return res.status(409).json({
      message: `You already have an active application (${existingActive.id}) currently '${existingActive.status}'. Please check My Application.`
    });
  }

  const id = `PV-${new Date().getUTCFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const now = new Date().toISOString();

  statements.insertApp.run(
    id,
    req.user.discord_user_id,
    body.profile.name.trim(),
    JSON.stringify(roles),
    JSON.stringify(body),
    "Submitted",
    now,
    now,
    0
  );

  if (!String(req.user.discord_user_id || "").startsWith("dev-")) {
    notifyDirectors({
      event: "NEW_APPLICATION",
      applicationId: id,
      displayName: body.profile.name.trim(),
      roles
    }).catch(console.error);
  }

  res.status(201).json({ id, status: "Submitted", submittedAt: now });
});

app.get("/api/application/status", requireUser, (req, res) => {
  const row = statements.byDiscord.get(req.user.discord_user_id);
  if (!row) return res.json({ application: null });
  const a = appView(row);
  const interviewTicket = statements.interview.get(row.id);
  res.json({
    application: {
      id: a.id,
      displayName: a.displayName,
      roles: a.roles,
      status: a.status,
      submittedAt: a.submittedAt,
      updatedAt: a.updatedAt,
      timeline: timeline(a.status),
      hasInterview: Boolean(interviewTicket)
    }
  });
});

app.get("/api/interview", requireUser, (req, res) => {
  const row = statements.byDiscord.get(req.user.discord_user_id);
  if (!row) return res.json({ ticket: null });
  const ticket = statements.interview.get(row.id);
  if (!ticket) return res.json({ ticket: null });
  let messages = [];
  try { messages = JSON.parse(ticket.messages_json); } catch {}
  res.json({
    ticket: {
      id: `${row.id}-INTERVIEW`,
      applicationId: row.id,
      status: ticket.status,
      messages
    }
  });
});

// Applicant posts a message to their interview ticket
app.post("/api/interview/message", requireUser, (req, res) => {
  const row = statements.byDiscord.get(req.user.discord_user_id);
  if (!row) return res.status(404).json({ message: "No application found." });
  const ticket = statements.interview.get(row.id);
  if (!ticket) return res.status(404).json({ message: "No active interview ticket found." });

  const text = (req.body?.message || "").trim();
  if (!text) return res.status(400).json({ message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ message: "Message is too long (maximum 2000 characters)." });

  let messages = [];
  try { messages = JSON.parse(ticket.messages_json); } catch {}

  const now = new Date();
  const entry = {
    senderLabel: req.user.global_name || req.user.username || "Applicant",
    senderType: "applicant",
    sentAt: now.toLocaleString(),
    timestamp: now.toISOString(),
    body: text
  };
  messages.push(entry);

  const updatedNow = now.toISOString();
  statements.saveInterview.run(row.id, ticket.status, JSON.stringify(messages), updatedNow);

  if (!String(req.user.discord_user_id || "").startsWith("dev-")) {
    notifyDirectors({
      event: "NEW_INTERVIEW_MESSAGE",
      applicationId: row.id,
      displayName: req.user.global_name || row.display_name,
      status: ticket.status
    }).catch(console.error);
  }

  res.json({
    ok: true,
    ticket: {
      id: `${row.id}-INTERVIEW`,
      applicationId: row.id,
      status: ticket.status,
      messages
    }
  });
});

// Director routes
app.get("/api/admin/applications", requireDirector, (req, res) => {
  const rows = statements.list.all();
  res.json({ authorized: true, applications: rows.map(publicApp) });
});

app.get("/api/admin/applications/:id", requireDirector, (req, res) => {
  const row = statements.byId.get(req.params.id);
  if (!row) return res.status(404).json({ message: "Application not found." });
  const a = appView(row);
  const interviewTicket = statements.interview.get(row.id);
  let interviewMessages = [];
  if (interviewTicket) {
    try { interviewMessages = JSON.parse(interviewTicket.messages_json); } catch {}
  }
  res.json({
    application: {
      ...publicApp(row),
      answers: a.payload,
      interview: interviewTicket ? {
        id: `${row.id}-INTERVIEW`,
        status: interviewTicket.status,
        messages: interviewMessages
      } : null
    }
  });
});

app.post("/api/admin/applications/:id/claim", requireDirector, (req, res) => {
  const row = statements.byId.get(req.params.id);
  if (!row) return res.status(404).json({ message: "Application not found." });
  const next = row.claimed_by ? null : (req.user.global_name || req.user.username || req.user.discord_user_id);
  statements.claim.run(next, new Date().toISOString(), row.id);
  res.json({ claimedBy: next });
});

app.post("/api/admin/applications/:id/status", requireDirector, (req, res) => {
  const row = statements.byId.get(req.params.id);
  const allowed = ["Submitted", "Flagged", "In review", "Interview", "On hold", "Accepted", "Declined", "Archived"];
  if (!row) return res.status(404).json({ message: "Application not found." });
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ message: "Invalid status." });

  const status = req.body.status;
  const isArchived = status === "Archived" ? 1 : 0;
  const now = new Date().toISOString();

  statements.status.run(status, isArchived, now, row.id);

  if (status === "Interview" && !statements.interview.get(row.id)) {
    statements.saveInterview.run(row.id, "Interview", "[]", now);
  }

  const a = appView(statements.byId.get(row.id));
  notifyDirectors({
    event: "STATUS_CHANGED",
    applicationId: a.id,
    displayName: a.displayName,
    roles: a.roles,
    status
  }).catch(console.error);

  const cleanOrigin = (config.frontendOrigin || "https://pokemonvoidrecruitment.github.io").replace(/\/$/, "");
  if (status === "Interview") {
    dmApplicant(row.discord_user_id, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Pokémon Void — Interview Stage")
          .setColor(0x06b6d4)
          .setDescription(`Hello **${row.display_name}**! 👋\n\nYour recruitment application (**${row.id}**) for **${(a.roles || []).join(", ") || "the team"}** has advanced to the **Interview** stage!\n\nThe Pokémon Void leadership team would love to ask you a few follow-up questions.`)
          .addFields(
            { name: "Application ID", value: row.id, inline: true },
            { name: "Interview Portal", value: `[Open Interview & Status Desk](${cleanOrigin}/status)`, inline: true }
          )
          .setFooter({ text: "Pokémon Void Recruitment Team" })
          .setTimestamp()
      ]
    });
  } else if (status === "Accepted") {
    dmApplicant(row.discord_user_id, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Pokémon Void — Application Accepted! 🎉")
          .setColor(0x22c55e)
          .setDescription(`Congratulations **${row.display_name}**!\n\nYour application (**${row.id}**) to join Pokémon Void has been **Accepted**! The leadership team will reach out with onboarding details soon.`)
          .addFields({ name: "Application Status", value: `[View Status Portal](${cleanOrigin}/status)` })
          .setFooter({ text: "Pokémon Void Recruitment Team" })
          .setTimestamp()
      ]
    });
  } else if (status === "Declined") {
    dmApplicant(row.discord_user_id, {
      embeds: [
        new EmbedBuilder()
          .setTitle("Pokémon Void — Recruitment Update")
          .setColor(0xef4444)
          .setDescription(`Hello **${row.display_name}**,\n\nThank you for your interest in joining Pokémon Void. After careful review, we will not be moving forward with your application (**${row.id}**) at this time.\n\nWe appreciate the time you took to share your work with us and wish you the best!`)
          .setFooter({ text: "Pokémon Void Recruitment Team" })
          .setTimestamp()
      ]
    });
  }

  res.json({ ok: true, status, archived: Boolean(isArchived), updatedAt: now });
});

// Director posts a message to an applicant's interview ticket
app.post("/api/admin/applications/:id/interview/message", requireDirector, (req, res) => {
  const row = statements.byId.get(req.params.id);
  if (!row) return res.status(404).json({ message: "Application not found." });

  let ticket = statements.interview.get(row.id);
  const now = new Date();
  if (!ticket) {
    statements.saveInterview.run(row.id, "Interview", "[]", now.toISOString());
    ticket = statements.interview.get(row.id);
  }

  const text = (req.body?.message || "").trim();
  if (!text) return res.status(400).json({ message: "Message cannot be empty." });
  if (text.length > 2000) return res.status(400).json({ message: "Message is too long (maximum 2000 characters)." });

  let messages = [];
  try { messages = JSON.parse(ticket.messages_json); } catch {}

  const entry = {
    senderLabel: req.user.global_name || req.user.username || "Director",
    senderType: "director",
    sentAt: now.toLocaleString(),
    timestamp: now.toISOString(),
    body: text
  };
  messages.push(entry);

  const updatedNow = now.toISOString();
  statements.saveInterview.run(row.id, ticket.status, JSON.stringify(messages), updatedNow);

  dmApplicant(row.discord_user_id, {
    content: `💬 **[Pokémon Void Director Desk — ${req.user.global_name || req.user.username || "Director"}]**\n${text}\n\n*(💡 You can reply directly to this DM to send your message to the website!)*`
  });

  res.json({
    ok: true,
    ticket: {
      id: `${row.id}-INTERVIEW`,
      applicationId: row.id,
      status: ticket.status,
      messages
    }
  });
});

app.post("/internal/events", (req, res) => {
  const signature = req.get("x-pv-signature") || "";
  const raw = req.rawBody || JSON.stringify(req.body || {});
  const expected = sign(raw, config.internalEventSecret || "");
  if (!safeEqual(signature, expected)) {
    return res.status(401).json({ message: "Invalid event signature." });
  }
  console.log("[events] Received verified internal event:", req.body?.event);
  res.status(202).json({ accepted: true });
});

// Periodic session cleanup (every hour)
setInterval(() => {
  try {
    const info = statements.cleanExpiredSessions.run();
    if (info.changes > 0) console.log(`[session] Cleaned up ${info.changes} expired session(s).`);
  } catch (err) {
    console.warn("[session] Failed to clean expired sessions:", err.message);
  }
}, 3600000);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error." });
});

// Start Express server immediately on 0.0.0.0 (required by Render port scanner)
app.listen(config.port, "0.0.0.0", () => {
  console.log(`Recruitment backend listening on port ${config.port} (0.0.0.0)`);
  console.log(`Open in browser: ${config.publicBaseUrl || `http://localhost:${config.port}`}`);
});

// Connect Discord bot in background
startDiscord().catch((err) => {
  console.warn("[discord] Background start warning:", err.message);
});
