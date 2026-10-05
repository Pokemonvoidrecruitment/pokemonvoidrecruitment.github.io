import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { config } from "./config.js";
import { db, statements, appView, deleteApplications } from "./db.js";
import { randomToken, sha256, sign, safeEqual } from "./security.js";
import { EmbedBuilder } from "discord.js";
import { startDiscord, isDirector, notifyDirectors, dmApplicant } from "./discord.js";

const app = express();
app.set("trust proxy", 1);

// CORS configuration
const allowedOrigins = new Set([
  config.frontendOrigin,
  config.frontendOrigin ? config.frontendOrigin.replace(/\/$/, "") : null,
  config.publicBaseUrl,
  config.publicBaseUrl ? config.publicBaseUrl.replace(/\/$/, "") : null,
  "https://pokemonvoidrecruitment.github.io",
  "https://pokemonvoidrecruitmentgithubio-production.up.railway.app",
  "http://localhost:3000"
].filter(Boolean));

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.replace(/\/$/, "");
    if (
      allowedOrigins.has(cleanOrigin) ||
      cleanOrigin.endsWith("github.io") ||
      cleanOrigin.endsWith("railway.app") ||
      cleanOrigin.includes("localhost") ||
      cleanOrigin.includes("127.0.0.1") ||
      config.isDev
    ) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "X-Requested-With"]
}));

// Store rawBody for webhook HMAC verification
app.use(express.json({
  limit: "256kb",
  verify: (req, _res, buf) => {
    req.rawBody = buf.toString("utf8");
  }
}));
app.use(cookieParser());

// Security: Block all attempts to request sensitive files, databases, source code, or configs
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p.startsWith("/data") ||
    p.startsWith("/src") ||
    p.startsWith("/node_modules") ||
    p.startsWith("/.git") ||
    p.includes(".sqlite") ||
    p.includes(".db") ||
    p.includes(".env") ||
    p.includes("package") ||
    p.includes(".bak")
  ) {
    return res.status(403).json({ message: "Access forbidden." });
  }
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticOpts = { extensions: ["html"], dotfiles: "deny" };
app.use(express.static(path.join(__dirname, "../public"), staticOpts));
app.use(express.static(path.join(__dirname, ".."), staticOpts));

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
    secure: true,
    sameSite: isCrossSite ? "none" : "lax",
    maxAge: config.sessionTtlMs,
    path: "/"
  });
  return token;
}

function currentUser(req) {
  const authHeader = req.get("authorization") || "";
  const rawBearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const bearerToken = (rawBearer && rawBearer !== "null" && rawBearer !== "undefined") ? rawBearer : null;
  const rawQuery = typeof req.query?.token === "string" ? req.query.token.trim() : null;
  const queryToken = (rawQuery && rawQuery !== "null" && rawQuery !== "undefined") ? rawQuery : null;
  const rawBody = typeof req.body?.token === "string" ? req.body.token.trim() : null;
  const bodyToken = (rawBody && rawBody !== "null" && rawBody !== "undefined") ? rawBody : null;
  const cookieToken = req.cookies?.[config.cookieName];

  const token = bearerToken || queryToken || bodyToken || cookieToken;
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

// Dev / Testing login (strictly disabled in production and cloud deployments)
if (config.isProduction || !config.isDev || process.env.ENABLE_DEV_LOGIN !== "true") {
  app.use("/auth/dev", (req, res) => {
    res.status(403).send("Dev endpoints are disabled.");
  });
} else {
  app.get("/auth/dev/login", (req, res) => {
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
  app.use("/auth/dev", (req, res) => res.redirect("/"));
}

app.get("/auth/discord", (req, res) => {
  if (!config.discord.clientId || !config.discord.clientSecret) {
    if (config.isDev) {
      const returnTo = req.query.returnTo || "/status.html";
      return res.redirect(`/auth/dev/login?role=applicant&returnTo=${encodeURIComponent(returnTo)}`);
    }
    return res.status(503).send("Discord OAuth is not configured on this server.");
  }

  const returnTo = req.query.returnTo || config.frontendOrigin || "/";
  const stateObj = {
    nonce: randomToken(16),
    returnTo,
    time: Date.now()
  };
  const payload = Buffer.from(JSON.stringify(stateObj)).toString("base64url");
  const signature = sign(payload, config.internalEventSecret);
  const state = `${payload}.${signature}`;

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
    const stateParam = String(req.query.state || "");
    const [payload, sig] = stateParam.split(".");
    let returnTo = config.frontendOrigin || "/";
    if (payload && sig && safeEqual(sig, sign(payload, config.internalEventSecret))) {
      try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (Date.now() - parsed.time < 900000 && parsed.returnTo) {
          returnTo = parsed.returnTo;
        }
      } catch {}
    }

    if (!req.query.code) {
      return res.status(400).send("Missing authorization code from Discord.");
    }

    const token = await discordToken(req.query.code);
    const user = await discordUser(token.access_token);
    const sessionToken = setSession(res, user);

    let targetUrl;
    try {
      targetUrl = new URL(returnTo, config.frontendOrigin || "https://pokemonvoidrecruitment.github.io");
    } catch {
      targetUrl = new URL(config.frontendOrigin || "https://pokemonvoidrecruitment.github.io");
    }
    // If targetUrl points to a github.io page without an extension (e.g. /status, /apply, /admin), ensure .html is preserved so GitHub Pages doesn't 404
    if (targetUrl.hostname.includes("github.io") && !targetUrl.pathname.endsWith(".html") && !targetUrl.pathname.endsWith("/")) {
      targetUrl.pathname = targetUrl.pathname + ".html";
    }
    targetUrl.searchParams.set("token", sessionToken);
    res.redirect(targetUrl.toString());
  } catch (e) {
    console.error("[discord-oauth]", e);
    res.status(502).send("Discord sign-in failed. Please return to the recruitment page and try again.");
  }
});

app.post("/auth/logout", (req, res) => {
  const authHeader = req.get("authorization") || "";
  const rawBearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const bearerToken = (rawBearer && rawBearer !== "null" && rawBearer !== "undefined") ? rawBearer : null;
  const rawQuery = typeof req.query?.token === "string" ? req.query.token.trim() : null;
  const queryToken = (rawQuery && rawQuery !== "null" && rawQuery !== "undefined") ? rawQuery : null;
  const rawBody = typeof req.body?.token === "string" ? req.body.token.trim() : null;
  const bodyToken = (rawBody && rawBody !== "null" && rawBody !== "undefined") ? rawBody : null;
  const token = bearerToken || queryToken || bodyToken || req.cookies?.[config.cookieName];
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
            { name: "Interview Portal", value: `[Open Interview & Status Desk](${cleanOrigin}/status)`, inline: true },
            { name: "💬 Direct Chat", value: "You can reply directly to this DM to chat with our directors, or use the website portal linked above!", inline: false }
          )
          .setFooter({ text: "💡 You can reply directly to this DM to send your message to the website!" })
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

// Director deletes an application (e.g. spam, test, or invalid)
app.delete("/api/admin/applications/:id", requireDirector, (req, res) => {
  const row = statements.byId.get(req.params.id);
  if (!row) return res.status(404).json({ message: "Application not found." });

  statements.deleteInterview.run(row.id);
  statements.deleteApp.run(row.id);

  console.log(`[admin] Application ${row.id} (${row.display_name}) deleted by ${req.user.global_name || req.user.username}`);
  res.json({ ok: true, deleted: row.id });
});

// Director bulk-deletes multiple applications
app.post("/api/admin/applications/bulk-delete", requireDirector, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ message: "No application IDs provided." });

  const deletedCount = deleteApplications(ids);
  console.log(`[admin] Bulk deleted ${deletedCount} application(s) by ${req.user.global_name || req.user.username}`);
  res.json({ ok: true, deletedCount, deletedIds: ids });
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
    senderLabel: "Director",
    senderType: "director",
    sentAt: now.toLocaleString(),
    timestamp: now.toISOString(),
    body: text
  };
  messages.push(entry);

  const updatedNow = now.toISOString();
  statements.saveInterview.run(row.id, ticket.status, JSON.stringify(messages), updatedNow);

  dmApplicant(row.discord_user_id, {
    content: `💬 **[Director]**\n${text}`
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
