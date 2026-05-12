import crypto from "node:crypto";
import type express from "express";
import { db } from "./db.js";

export type AuthUser = {
  id: number;
  username: string;
  display_name: string;
};

export type AuthenticatedRequest = express.Request & {
  user: AuthUser;
};

const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30);

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function expiresAt() {
  return new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function publicUser(row: Record<string, unknown>): AuthUser {
  return {
    id: Number(row.id),
    username: String(row.username),
    display_name: String(row.display_name)
  };
}

export function createUser(username: string, password: string, displayName?: string) {
  const normalized = normalizeUsername(username);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);

  const result = db
    .prepare(
      `
      INSERT INTO users (username, display_name, password_hash, password_salt)
      VALUES (?, ?, ?, ?)
    `
    )
    .run(normalized, displayName?.trim() || normalized, passwordHash, salt);

  return getUserById(Number(result.lastInsertRowid));
}

export function getUserById(id: number) {
  const row = db.prepare("SELECT id, username, display_name FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? publicUser(row) : null;
}

export function verifyUser(username: string, password: string) {
  const row = db
    .prepare("SELECT * FROM users WHERE username = ?")
    .get(normalizeUsername(username)) as Record<string, unknown> | undefined;
  if (!row) return null;

  const expected = Buffer.from(String(row.password_hash), "hex");
  const actual = Buffer.from(hashPassword(password, String(row.password_salt)), "hex");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }
  return publicUser(row);
}

export function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString("base64url");
  db.prepare(
    `
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `
  ).run(userId, hashToken(token), expiresAt());
  return token;
}

export function revokeSession(token: string) {
  db.prepare(
    `
    UPDATE auth_sessions
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE token_hash = ? AND revoked_at IS NULL
  `
  ).run(hashToken(token));
}

export function userFromToken(token: string) {
  const row = db
    .prepare(
      `
      SELECT u.id, u.username, u.display_name
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `
    )
    .get(hashToken(token)) as Record<string, unknown> | undefined;

  if (!row) return null;
  db.prepare("UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token_hash = ?").run(hashToken(token));
  return publicUser(row);
}

export function bearerToken(req: express.Request) {
  const value = req.header("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

export function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const token = bearerToken(req);
  const user = token ? userFromToken(token) : null;
  if (!user) {
    res.status(401).json({ error: "请先登录" });
    return;
  }
  (req as AuthenticatedRequest).user = user;
  next();
}
