import { Router } from "express";
import {
  clearSessionCookie,
  getUserByUsername,
  issueAuthToken,
  revokeAuthToken,
  setSessionCookie,
  verifyPassword,
  getTokenFromCookieHeader,
} from "../auth.js";

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "아이디와 비밀번호를 입력하세요." });
    return;
  }
  const user = getUserByUsername(username);
  if (!user || !verifyPassword(user, password)) {
    res.status(401).json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." });
    return;
  }
  const { token, expiresAt } = issueAuthToken(user.id);
  setSessionCookie(res, token, expiresAt);
  res.json({
    user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
  });
});

authRouter.post("/logout", (req, res) => {
  const token = getTokenFromCookieHeader(req.headers.cookie);
  if (token) revokeAuthToken(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "인증이 필요합니다." });
    return;
  }
  const { id, username, display_name, role } = req.user;
  res.json({ user: { id, username, displayName: display_name, role } });
});
