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
import multer from "multer";
import fs from "node:fs";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

// HTTP Security Headers
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self' https:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; media-src 'self' https: blob:; connect-src 'self' https: http://localhost:3000; frame-ancestors 'self'; base-uri 'self'; object-src 'none';");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Sliding-window rate limiter
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits.entries()) {
      if (record.resetTime <= now) hits.delete(key);
    }
  }, 300000);

  return (req, res, next) => {
    const key = req.ip || req.headers["x-forwarded-for"] || "global";
    const now = Date.now();
    let record = hits.get(key);
    if (!record || record.resetTime <= now) {
      record = { count: 1, resetTime: now + windowMs };
      hits.set(key, record);
      return next();
    }
    record.count++;
    if (record.count > max) {
      return res.status(429).json({
        message: message || "Too many requests. Please slow down and try again later."
      });
    }
    next();
  };
}

const authLimiter = createRateLimiter({ windowMs: 60000, max: 20, message: "Too many sign-in attempts. Please try again in a minute." });
const applicationLimiter = createRateLimiter({ windowMs: 900000, max: 5, message: "Too many application submissions. Please wait before submitting again." });
const messageLimiter = createRateLimiter({ windowMs: 60000, max: 30, message: "You are sending messages too quickly. Please wait a moment." });

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
      cleanOrigin === "https://pokemonvoidrecruitment.github.io" ||
      (cleanOrigin.endsWith(".railway.app") && cleanOrigin.includes("pokemonvoidrecruitment")) ||
      (config.isDev && (cleanOrigin.includes("localhost") || cleanOrigin.includes("127.0.0.1")))
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
    p.startsWith("/.github") ||
    p.includes(".sqlite") ||
    p.includes(".db") ||
    p.includes(".env") ||
    p.includes("package") ||
    p.includes(".bak") ||
    p.includes(".yaml") ||
    p.includes(".yml") ||
    p.includes(".md") ||
    p.includes(".lock") ||
    p.endsWith(".sql") ||
    p.includes("test-e2e")
  ) {
    return res.status(403).json({ message: "Access forbidden." });
  }
  next();
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticOpts = { extensions: ["html"], dotfiles: "deny" };
app.use(express.static(path.join(__dirname, "../public"), staticOpts));
app.use(express.static(path.join(__dirname, ".."), staticOpts));

// File uploads directory for interview attachments (.aseprite, audio, .rxdata, .dat, etc.)
const uploadsDir = path.resolve(
  process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "uploads")
    : path.join(__dirname, "../data/uploads")
);
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_\-\.]/g, "_").slice(0, 50) || "file";
    const unique = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    cb(null, `${base}-${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    // Note: SVG excluded to prevent Stored XSS
    const allowed = /\.(aseprite|ase|mp3|wav|ogg|flac|m4a|aac|opus|mid|midi|rxdata|dat|png|jpe?g|gif|webp|bmp|mp4|webm|mov|zip|rar|7z|tar|gz|rb|txt|json|pdf)$/i;
    if (allowed.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported (${path.extname(file.originalname)}). Supported: Aseprite (.aseprite/.ase), Audio (.mp3/.wav/.ogg/.flac), .rxdata, .dat, images (.png/.gif/.webp), video, zip.`));
    }
  }
});

// Protected interview uploads: strictly restricted to Recruitment Directors or the specific applicant who owns the ticket
app.get("/uploads/:filename", async (req, res) => {
  const user = currentUser(req);
  if (!user) {
    return res.status(401).send("Discord sign-in required to view recruitment attachments.");
  }
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);

  // Permission check: Directors have full access; Applicants can only view files in their own tickets
  const director = await isDirector(user.discord_user_id);
  if (!director) {
    const app = statements.byDiscord.get(user.discord_user_id);
    if (!app) {
      return res.status(403).send("Access denied. You do not have permission to view this attachment.");
    }
    const ticket = statements.interview.get(app.id);
    const inTicket = ticket && ticket.messages_json && ticket.messages_json.includes(filename);
    const inApp = app.payload_json && app.payload_json.includes(filename);
    if (!inTicket && !inApp) {
      return res.status(403).send("Access denied. You do not have permission to view this attachment.");
    }
  }

  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
    return res.status(404).send("File not found.");
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("X-Frame-Options", "DENY");

  res.sendFile(filePath);
});

function safeRedirectUrl(returnTo) {
  const trustedOrigins = new Set([
    config.frontendOrigin,
    config.frontendOrigin ? config.frontendOrigin.replace(/\/$/, "") : null,
    config.publicBaseUrl,
    config.publicBaseUrl ? config.publicBaseUrl.replace(/\/$/, "") : null,
    "https://pokemonvoidrecruitment.github.io",
    "https://pokemonvoidrecruitmentgithubio-production.up.railway.app",
    "http://localhost:3000"
  ].filter(Boolean));

  let targetUrl;
  try {
    targetUrl = new URL(returnTo, config.frontendOrigin || "https://pokemonvoidrecruitment.github.io");
  } catch {
    targetUrl = new URL(config.frontendOrigin || "https://pokemonvoidrecruitment.github.io");
  }

  const cleanTargetOrigin = targetUrl.origin.replace(/\/$/, "");
  const isTrusted = (
    trustedOrigins.has(cleanTargetOrigin) ||
    targetUrl.hostname === "pokemonvoidrecruitment.github.io" ||
    (targetUrl.hostname.endsWith(".railway.app") && targetUrl.hostname.includes("pokemonvoidrecruitment")) ||
    (config.isDev && (cleanTargetOrigin.includes("localhost") || cleanTargetOrigin.includes("127.0.0.1")))
  );

  if (!isTrusted) {
    targetUrl = new URL(config.frontendOrigin || "https://pokemonvoidrecruitment.github.io");
  }

  if (targetUrl.hostname.includes("github.io") && !targetUrl.pathname.endsWith(".html") && !targetUrl.pathname.endsWith("/")) {
    targetUrl.pathname = targetUrl.pathname + ".html";
  }

  return targetUrl;
}

async function discordToken(code) {
  const credentials = Buffer.from(`${config.discord.clientId}:${config.discord.clientSecret}`).toString("base64");
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.discord.redirectUri
  });
  let r = await fetch("https://discord.com/api/v10/oauth2/token", {
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
    
    // Fallback: try passing client_id and client_secret in request body if not invalid_grant
    if (!errorBody.includes("invalid_grant")) {
      const bodyParams = new URLSearchParams({
        client_id: config.discord.clientId,
        client_secret: config.discord.clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: config.discord.redirectUri
      });
      const r2 = await fetch("https://discord.com/api/v10/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "DiscordBot (https://pokemonvoidrecruitment.github.io, 1.0.0)"
        },
        body: bodyParams
      });
      if (r2.ok) return r2.json();
      const errorBody2 = await r2.text();
      console.error(`[discord] Secondary body exchange failed with HTTP ${r2.status}:`, errorBody2);
    }
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

app.get("/auth/discord", authLimiter, (req, res) => {
  if (!config.discord.clientId || !config.discord.clientSecret) {
    if (config.isDev) {
      const returnTo = req.query.returnTo || "/status.html";
      return res.redirect(`/auth/dev/login?role=applicant&returnTo=${encodeURIComponent(returnTo)}`);
    }
    return res.status(503).send("Discord OAuth is not configured on this server.");
  }

  const validatedReturnTo = safeRedirectUrl(req.query.returnTo || config.frontendOrigin || "/").toString();
  const stateObj = {
    nonce: randomToken(16),
    returnTo: validatedReturnTo,
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
  let returnTo = config.frontendOrigin || "/";
  try {
    const stateParam = String(req.query.state || "");
    const [payload, sig] = stateParam.split(".");
    let isValidSig = Boolean(payload && sig && safeEqual(sig, sign(payload, config.internalEventSecret)));
    if (payload) {
      try {
        const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        if (parsed.returnTo) {
          const candidate = safeRedirectUrl(parsed.returnTo).toString();
          if (isValidSig && Date.now() - parsed.time < 900000) {
            returnTo = candidate;
          } else if (candidate.includes("pokemonvoidrecruitment.github.io") || candidate.startsWith(config.frontendOrigin)) {
            // Safe fallback to our own domain even if state signature expired
            returnTo = candidate;
          }
        }
      } catch {}
    }

    if (!req.query.code) {
      return res.status(400).send("Missing authorization code from Discord.");
    }

    const token = await discordToken(req.query.code);
    const user = await discordUser(token.access_token);
    const sessionToken = setSession(res, user);

    const targetUrl = safeRedirectUrl(returnTo);
    targetUrl.searchParams.set("token", sessionToken);
    res.redirect(targetUrl.toString());
  } catch (e) {
    console.error("[discord-oauth]", e);
    const isInvalidGrant = String(e.message || "").includes("invalid_grant");
    const retryTarget = safeRedirectUrl(returnTo).toString();
    const retryUrl = `/auth/discord?returnTo=${encodeURIComponent(retryTarget)}`;
    res.status(502).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Discord Sign-in · Pokémon Void</title>
  <style>
    body {
      margin: 0; padding: 24px; background: #0b0f19; color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center; min-height: 100vh; box-sizing: border-box;
    }
    .box {
      max-width: 500px; width: 100%; background: #1e293b; border: 1px solid #334155;
      border-radius: 16px; padding: 32px 28px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .icon { font-size: 38px; margin-bottom: 12px; }
    h1 { font-size: 20px; font-weight: 700; margin: 0 0 10px; color: #f8fafc; }
    p { color: #cbd5e1; font-size: 14px; line-height: 1.6; margin: 0 0 16px; }
    .error-box {
      background: #0f172a; border: 1px solid #334155; padding: 12px 14px; border-radius: 8px;
      font-family: monospace; font-size: 12px; color: #fb7185; text-align: left; margin-bottom: 20px; word-break: break-all;
    }
    .btn-group { display: flex; flex-direction: column; gap: 10px; }
    .btn {
      display: inline-flex; align-items: center; justify-content: center; padding: 12px 20px;
      border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none;
    }
    .btn-primary { background: #5865F2; color: #fff; }
    .btn-secondary { background: rgba(255,255,255,0.08); color: #cbd5e1; border: 1px solid #334155; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">🔑</div>
    <h1>Discord Authorization ${isInvalidGrant ? "Expired" : "Issue"}</h1>
    <p>${isInvalidGrant ? "This Discord authorization code has expired or was already redeemed (typically happens when using browser Back or reloading)." : "We encountered an issue communicating with Discord's authorization server."}</p>
    <div class="error-box">${String(e.message || e).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    <div class="btn-group">
      <a class="btn btn-primary" href="${retryUrl}">Try Connecting Discord Again</a>
      <a class="btn btn-secondary" href="${retryTarget.replace(/"/g, "&quot;")}">Return to Recruitment Form</a>
    </div>
  </div>
</body>
</html>`);
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

app.post("/api/application", applicationLimiter, requireUser, (req, res) => {
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

// Applicant posts a message or file to their interview ticket
app.post("/api/interview/message", messageLimiter, requireUser, (req, res, next) => {
  upload.array("files", 5)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
}, (req, res) => {
  const row = statements.byDiscord.get(req.user.discord_user_id);
  if (!row) return res.status(404).json({ message: "No application found." });
  const ticket = statements.interview.get(row.id);
  if (!ticket) return res.status(404).json({ message: "No active interview ticket found." });

  let text = (req.body?.message || "").trim();
  if (req.files && req.files.length > 0) {
    const cleanOrigin = (config.publicBaseUrl || "https://pokemonvoidrecruitmentgithubio-production.up.railway.app").replace(/\/$/, "");
    const fileUrls = req.files.map(f => `${cleanOrigin}/uploads/${f.filename}`).join("\n");
    text = text ? `${text}\n${fileUrls}` : fileUrls;
  }

  if (!text) return res.status(400).json({ message: "Message or file attachment is required." });
  if (text.length > 4000) return res.status(400).json({ message: "Message is too long (maximum 4000 characters)." });

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
app.post("/api/admin/applications/:id/interview/message", messageLimiter, requireDirector, (req, res, next) => {
  upload.array("files", 5)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    next();
  });
}, (req, res) => {
  const row = statements.byId.get(req.params.id);
  if (!row) return res.status(404).json({ message: "Application not found." });

  let ticket = statements.interview.get(row.id);
  const now = new Date();
  if (!ticket) {
    statements.saveInterview.run(row.id, "Interview", "[]", now.toISOString());
    ticket = statements.interview.get(row.id);
  }

  let text = (req.body?.message || "").trim();
  let discordFiles = [];
  if (req.files && req.files.length > 0) {
    const cleanOrigin = (config.publicBaseUrl || "https://pokemonvoidrecruitmentgithubio-production.up.railway.app").replace(/\/$/, "");
    const fileUrls = req.files.map(f => `${cleanOrigin}/uploads/${f.filename}`).join("\n");
    text = text ? `${text}\n${fileUrls}` : fileUrls;
    discordFiles = req.files.map(f => ({
      attachment: f.path,
      name: f.originalname
    }));
  }

  if (!text) return res.status(400).json({ message: "Message or file attachment is required." });
  if (text.length > 4000) return res.status(400).json({ message: "Message is too long (maximum 4000 characters)." });

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
    content: `💬 **[Director]**\n${text}`,
    ...(discordFiles.length ? { files: discordFiles } : {})
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
