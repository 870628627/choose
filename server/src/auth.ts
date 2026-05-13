import crypto from "node:crypto";
import type express from "express";
import { db } from "./db.js";

export type AuthUser = {
  id: number;
  email: string;
  display_name: string;
  account_level: "regular" | "vip";
  is_super_admin: boolean;
};

export type AuthenticatedRequest = express.Request & {
  user: AuthUser;
};

const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30);
const SUPER_ADMIN_EMAIL = normalizeEmail(process.env.SUPER_ADMIN_EMAIL || "870628627@qq.com");

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isSuperAdminEmail(email: string) {
  return normalizeEmail(email) === SUPER_ADMIN_EMAIL;
}

function usernameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "trader";
  const slug = localPart.replace(/[^a-z0-9_]/gi, "_").replace(/^_+|_+$/g, "").slice(0, 18) || "trader";
  const suffix = crypto.createHash("sha1").update(email).digest("hex").slice(0, 10);
  return `${slug}_${suffix}`.toLowerCase();
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
  const email = normalizeEmail(String(row.email || row.username));
  const isSuperAdmin = isSuperAdminEmail(email) || String(row.admin_role || "") === "super_admin";
  const accountLevel = String(row.account_level || "") === "vip" || isSuperAdmin ? "vip" : "regular";
  return {
    id: Number(row.id),
    email,
    display_name: String(row.display_name || email.split("@")[0] || "Trader"),
    account_level: accountLevel,
    is_super_admin: isSuperAdmin
  };
}

export function createUser(email: string, password: string) {
  const normalized = normalizeEmail(email);
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const username = usernameFromEmail(normalized);
  const displayName = normalized.split("@")[0] || "Trader";
  const isSuperAdmin = isSuperAdminEmail(normalized);

  const result = db
    .prepare(
      `
      INSERT INTO users (username, email, display_name, password_hash, password_salt, account_level, admin_role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(username, normalized, displayName, passwordHash, salt, isSuperAdmin ? "vip" : "regular", isSuperAdmin ? "super_admin" : "none");

  return getUserById(Number(result.lastInsertRowid));
}

export function getUserById(id: number) {
  const row = db.prepare("SELECT id, username, email, display_name, account_level, admin_role FROM users WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row ? publicUser(row) : null;
}

export function verifyUser(email: string, password: string) {
  const normalized = normalizeEmail(email);
  const row = db
    .prepare("SELECT * FROM users WHERE email = ? OR username = ?")
    .get(normalized, normalized) as Record<string, unknown> | undefined;
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
      , u.email, u.account_level, u.admin_role
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

export function requireSuperAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = (req as AuthenticatedRequest).user;
  if (!user?.is_super_admin) {
    res.status(403).json({ error: "只有超级管理员可以访问后台管理" });
    return;
  }
  next();
}
