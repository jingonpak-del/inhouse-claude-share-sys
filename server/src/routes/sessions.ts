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
  seedMessages,
  replaceMessages,
  getImportedClaudeSessionIds,
  peekRuntime,
} from "../sessionManager.js";
import { listDiscoverableSessions, findDiscoverableSession, readTranscript } from "../claudeSessions.js";
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

// 서버에 저장돼 있는 Claude Code 세션 목록.
// 주의: "/:id" 보다 먼저 등록해야 id로 잡히지 않는다.
sessionsRouter.get("/claude-code", requireRole("master"), async (_req, res) => {
  try {
    const [sessions, importedIds] = await Promise.all([
      listDiscoverableSessions(50),
      Promise.resolve(getImportedClaudeSessionIds()),
    ]);
    const imported = new Set(importedIds);
    res.json({
      sessions: sessions.map((s) => ({ ...s, alreadyImported: imported.has(s.sessionId) })),
    });
  } catch (err) {
    res.status(500).json({
      error: `세션 목록을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// 기존 Claude Code 세션을 대시보드로 가져와 이어서 작업한다.
sessionsRouter.post("/import", requireRole("master"), async (req, res) => {
  const { claudeSessionId, label, model, permissionMode, allowedTools, assignedUserIds } = req.body ?? {};
  if (
    typeof claudeSessionId !== "string" ||
    !claudeSessionId.trim() ||
    typeof model !== "string" ||
    !model.trim() ||
    !PERMISSION_MODES.includes(permissionMode) ||
    !Array.isArray(assignedUserIds) ||
    assignedUserIds.some((id: unknown) => typeof id !== "string")
  ) {
    res.status(400).json({ error: "입력값이 올바르지 않습니다." });
    return;
  }

  try {
    const discovered = await findDiscoverableSession(claudeSessionId);
    if (!discovered) {
      res.status(404).json({ error: "해당 Claude Code 세션을 찾을 수 없습니다." });
      return;
    }
    if (!discovered.cwd) {
      res.status(400).json({ error: "세션의 작업 폴더를 알 수 없어 불러올 수 없습니다." });
      return;
    }
    if (getImportedClaudeSessionIds().includes(claudeSessionId)) {
      res.status(409).json({ error: "이미 불러온 세션입니다." });
      return;
    }

    const session = createSession({
      label: typeof label === "string" && label.trim() ? label.trim() : discovered.summary,
      model,
      cwd: discovered.cwd,
      permissionMode,
      allowedTools: Array.isArray(allowedTools) ? allowedTools : undefined,
      createdBy: req.user!.id,
      assignedUserIds,
      claudeSessionId,
    });

    // 지난 작업 내역을 옮겨 담아 담당자가 맥락을 보고 이어갈 수 있게 한다.
    const entries = await readTranscript(discovered);
    if (entries.length > 0) seedMessages(session.id, entries);

    res.status(201).json({ session, importedMessages: entries.length });
  } catch (err) {
    res.status(500).json({
      error: `세션을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

// PC에서 이어서 작업한 내용을 대시보드 기록에 다시 맞춘다.
sessionsRouter.post("/:id/sync", async (req, res) => {
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
  if (!session.claude_session_id) {
    res.status(400).json({ error: "이 세션은 대시보드에서 새로 만든 세션이라 동기화할 원본이 없습니다." });
    return;
  }

  try {
    const discovered = await findDiscoverableSession(session.claude_session_id);
    if (!discovered) {
      res.status(404).json({ error: "원본 Claude Code 세션을 찾을 수 없습니다." });
      return;
    }
    const entries = await readTranscript(discovered);
    replaceMessages(session.id, entries);
    // 지금 이 세션을 보고 있는 사람들의 화면도 함께 갱신한다.
    peekRuntime(session.id)?.broadcastHistory();
    res.json({ ok: true, messages: entries.length, lastModified: discovered.lastModified });
  } catch (err) {
    res.status(500).json({
      error: `동기화하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
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
