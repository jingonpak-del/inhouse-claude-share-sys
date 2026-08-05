import { Router } from "express";
import { requireAuth, requireRole, createUser, getUserById } from "../auth.js";
import { db } from "../db.js";
import {
  createSession,
  listAllSessions,
  listSessionsForUser,
  getAssignedUserIds,
  isUserAssigned,
  archiveSession,
  getSessionRow,
} from "../sessionManager.js";
import type { PermissionMode, User } from "../types.js";

export const sessionsRouter = Router();

const PERMISSION_MODES: PermissionMode[] = ["default", "acceptEdits", "bypassPermissions", "plan"];

sessionsRouter.use(requireAuth);

sessionsRouter.get("/", (req, res) => {
  const user = req.user!;
  if (user.role === "master") {
    const sessions = listAllSessions().map((s) => ({
      ...s,
      assignedUserIds: getAssignedUserIds(s.id),
    }));
    res.json({ sessions });
    return;
  }
  res.json({ sessions: listSessionsForUser(user.id) });
});

sessionsRouter.post("/", requireRole("master"), (req, res) => {
  const { label, model, cwd, permissionMode, allowedTools, assignedUserIds } = req.body ?? {};
  if (
    typeof label !== "string" ||
    !label.trim() ||
    typeof model !== "string" ||
    !model.trim() ||
    typeof cwd !== "string" ||
    !cwd.trim() ||
    !PERMISSION_MODES.includes(permissionMode) ||
    !Array.isArray(assignedUserIds) ||
    assignedUserIds.some((id: unknown) => typeof id !== "string")
  ) {
    res.status(400).json({ error: "입력값이 올바르지 않습니다." });
    return;
  }
  const session = createSession({
    label,
    model,
    cwd,
    permissionMode,
    allowedTools: Array.isArray(allowedTools) ? allowedTools : undefined,
    createdBy: req.user!.id,
    assignedUserIds,
  });
  res.status(201).json({ session });
});

sessionsRouter.post("/:id/archive", requireRole("master"), (req, res) => {
  const session = getSessionRow(req.params.id);
  if (!session) {
    res.status(404).json({ error: "세션을 찾을 수 없습니다." });
    return;
  }
  archiveSession(session.id);
  res.json({ ok: true });
});

sessionsRouter.get("/:id", (req, res) => {
  const session = getSessionRow(req.params.id);
  if (!session) {
    res.status(404).json({ error: "세션을 찾을 수 없습니다." });
    return;
  }
  const user = req.user!;
  if (user.role !== "master" && !isUserAssigned(session.id, user.id)) {
    res.status(403).json({ error: "접근 권한이 없습니다." });
    return;
  }
  res.json({ session });
});

export const usersRouter = Router();
usersRouter.use(requireAuth, requireRole("master"));

usersRouter.get("/", (_req, res) => {
  const users = db
    .prepare(`SELECT id, username, display_name, role FROM users ORDER BY created_at ASC`)
    .all() as Pick<User, "id" | "username" | "display_name" | "role">[];
  res.json({ users });
});

usersRouter.post("/", (req, res) => {
  const { username, password, displayName, role } = req.body ?? {};
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    password.length < 8 ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    (role !== "master" && role !== "employee")
  ) {
    res.status(400).json({ error: "입력값이 올바르지 않습니다 (비밀번호는 8자 이상)." });
    return;
  }
  try {
    const user = createUser(username, password, displayName, role);
    res.status(201).json({
      user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    });
  } catch {
    res.status(409).json({ error: "이미 존재하는 아이디입니다." });
  }
});
