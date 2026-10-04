import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });
export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS applications (
 id TEXT PRIMARY KEY,
 discord_user_id TEXT NOT NULL,
 display_name TEXT NOT NULL,
 roles_json TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Submitted',
 submitted_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 claimed_by TEXT,
 archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_app_discord ON applications(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 discord_user_id TEXT NOT NULL,
 username TEXT,
 global_name TEXT,
 expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(discord_user_id);
CREATE TABLE IF NOT EXISTS interviews (
 application_id TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'Interview',
 messages_json TEXT NOT NULL DEFAULT '[]',
 updated_at TEXT NOT NULL
);
`);

export const statements = {
  insertApp: db.prepare(`INSERT INTO applications(id,discord_user_id,display_name,roles_json,payload_json,status,submitted_at,updated_at,archived) VALUES(?,?,?,?,?,?,?,?,?)`),
  byId: db.prepare(`SELECT * FROM applications WHERE id=?`),
  byDiscord: db.prepare(`SELECT * FROM applications WHERE discord_user_id=? ORDER BY submitted_at DESC LIMIT 1`),
  activeByDiscord: db.prepare(`SELECT * FROM applications WHERE discord_user_id=? AND status NOT IN ('Accepted','Declined','Archived') ORDER BY submitted_at DESC LIMIT 1`),
  list: db.prepare(`SELECT id,discord_user_id,display_name,roles_json,status,submitted_at,updated_at,claimed_by,archived FROM applications ORDER BY submitted_at DESC`),
  claim: db.prepare(`UPDATE applications SET claimed_by=?,updated_at=? WHERE id=?`),
  status: db.prepare(`UPDATE applications SET status=?,archived=?,updated_at=? WHERE id=?`),
  session: db.prepare(`SELECT * FROM sessions WHERE token_hash=?`),
  saveSession: db.prepare(`INSERT OR REPLACE INTO sessions(token_hash,discord_user_id,username,global_name,expires_at) VALUES(?,?,?,?,?)`),
  deleteSession: db.prepare(`DELETE FROM sessions WHERE token_hash=?`),
  cleanExpiredSessions: db.prepare(`DELETE FROM sessions WHERE datetime(expires_at) < datetime('now')`),
  interview: db.prepare(`SELECT * FROM interviews WHERE application_id=?`),
  saveInterview: db.prepare(`INSERT OR REPLACE INTO interviews(application_id,status,messages_json,updated_at) VALUES(?,?,?,?)`)
};

export function appView(row) {
  if (!row) return null;
  let p = {};
  try { p = JSON.parse(row.payload_json); } catch {}
  let r = [];
  try { r = JSON.parse(row.roles_json); } catch {}
  return {
    id: row.id,
    displayName: row.display_name,
    discordUsername: row.discord_user_id,
    roles: r,
    status: row.status,
    submittedAt: row.submitted_at,
    updatedAt: row.updated_at,
    claimedBy: row.claimed_by,
    archived: Boolean(row.archived),
    payload: p
  };
}

