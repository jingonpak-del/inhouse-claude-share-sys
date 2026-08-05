import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db.js";
import type { User, Role } from "./types.js";

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

export function createUser(username: string, password: string, displayName: string, role: Role): User {
  const id = nanoid();
  const password_hash = bcrypt.hashSync(password, 12);
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)`
  ).run(id, username, password_hash, displayName, role);
  return getUserById(id)!;
}

export function getUserById(id: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username) as User | undefined;
}

export function verifyPassword(user: User, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export function issueAuthToken(userId: string): { token: string; expiresAt: Date } {
  const token = nanoid(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.prepare(
    `INSERT INTO auth_sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).run(token, userId, expiresAt.toISOString());
  return { token, expiresAt };
}

export function revokeAuthToken(token: string): void {
  db.prepare(`DELETE FROM auth_sessions WHERE token = ?`).run(token);
}

export function getUserByToken(token: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.* FROM auth_sessions a JOIN users u ON u.id = a.user_id
       WHERE a.token = ? AND a.expires_at > datetime('now')`
    )
    .get(token) as User | undefined;
  return row;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

export function getTokenFromCookieHeader(header: string | undefined): string | undefined {
  return parseCookies(header)[SESSION_COOKIE];
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  const secure = process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const token = getTokenFromCookieHeader(req.headers.cookie);
  if (token) {
    const user = getUserByToken(token);
    if (user) req.user = user;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "인증이 필요합니다." });
    return;
  }
  next();
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== role) {
      res.status(403).json({ error: "권한이 없습니다." });
      return;
    }
    next();
  };
}
