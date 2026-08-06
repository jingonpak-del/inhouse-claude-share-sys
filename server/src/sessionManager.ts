import { nanoid } from "nanoid";
import { db } from "./db.js";
import { ClaudeSessionRuntime } from "./claudeSessionRuntime.js";
import type { ClaudeSessionRow, PermissionMode } from "./types.js";

const runtimes = new Map<string, ClaudeSessionRuntime>();

export interface CreateSessionInput {
  label: string;
  model: string;
  cwd: string;
  permissionMode: PermissionMode;
  allowedTools?: string[];
  createdBy: string;
  assignedUserIds: string[];
  /**
   * 서버에 이미 있는 Claude Code 세션의 UUID.
   * 지정하면 새 대화를 시작하지 않고 그 세션을 이어받는다.
   */
  claudeSessionId?: string;
}

export function createSession(input: CreateSessionInput): ClaudeSessionRow {
  const id = nanoid();
  db.prepare(
    `INSERT INTO claude_sessions (id, label, model, cwd, permission_mode, allowed_tools, claude_session_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.label,
    input.model,
    input.cwd,
    input.permissionMode,
    input.allowedTools ? JSON.stringify(input.allowedTools) : null,
    input.claudeSessionId ?? null,
    input.createdBy
  );
  const assign = db.prepare(
    `INSERT INTO session_assignments (session_id, user_id) VALUES (?, ?)`
  );
  for (const userId of input.assignedUserIds) assign.run(id, userId);
  return getSessionRow(id)!;
}

/** 이어받은 세션의 지난 대화를 대시보드 기록으로 옮겨 담는다. */
export function seedMessages(
  sessionId: string,
  messages: { role: "user" | "assistant" | "system"; content: string }[]
): void {
  const insert = db.prepare(
    `INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)`
  );
  for (const m of messages) insert.run(nanoid(), sessionId, m.role, m.content);
}

/** 이미 대시보드로 불러온 Claude Code 세션의 UUID 목록. */
export function getImportedClaudeSessionIds(): string[] {
  const rows = db
    .prepare(`SELECT claude_session_id FROM claude_sessions WHERE claude_session_id IS NOT NULL`)
    .all() as { claude_session_id: string }[];
  return rows.map((r) => r.claude_session_id);
}

export function getSessionRow(id: string): ClaudeSessionRow | undefined {
  return db.prepare(`SELECT * FROM claude_sessions WHERE id = ?`).get(id) as
    | ClaudeSessionRow
    | undefined;
}

export function listAllSessions(): ClaudeSessionRow[] {
  return db
    .prepare(`SELECT * FROM claude_sessions ORDER BY created_at DESC`)
    .all() as unknown as ClaudeSessionRow[];
}

export function listSessionsForUser(userId: string): ClaudeSessionRow[] {
  return db
    .prepare(
      `SELECT s.* FROM claude_sessions s
       JOIN session_assignments a ON a.session_id = s.id
       WHERE a.user_id = ? AND s.status = 'active'
       ORDER BY s.created_at DESC`
    )
    .all(userId) as unknown as ClaudeSessionRow[];
}

export function getAssignedUserIds(sessionId: string): string[] {
  const rows = db
    .prepare(`SELECT user_id FROM session_assignments WHERE session_id = ?`)
    .all(sessionId) as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export function isUserAssigned(sessionId: string, userId: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM session_assignments WHERE session_id = ? AND user_id = ?`)
    .get(sessionId, userId);
  return !!row;
}

export function archiveSession(id: string): void {
  db.prepare(`UPDATE claude_sessions SET status = 'archived' WHERE id = ?`).run(id);
  const runtime = runtimes.get(id);
  if (runtime) {
    runtime.stop();
    runtimes.delete(id);
  }
}

export function getRuntime(id: string): ClaudeSessionRuntime | undefined {
  if (runtimes.has(id)) return runtimes.get(id);
  const row = getSessionRow(id);
  if (!row || row.status !== "active") return undefined;
  const runtime = new ClaudeSessionRuntime(row);
  runtimes.set(id, runtime);
  return runtime;
}
