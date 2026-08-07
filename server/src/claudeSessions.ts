// 서버 컴퓨터에 이미 저장되어 있는 Claude Code 세션(~/.claude/projects)을 조회한다.
// 파일을 직접 파싱하지 않고 Agent SDK가 제공하는 조회 API를 그대로 사용한다.
import { listSessions, getSessionInfo, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";

export interface DiscoveredSession {
  sessionId: string;
  /** 세션 제목 (/rename으로 지정한 이름 → 자동 요약 → 첫 프롬프트 순) */
  summary: string;
  cwd: string | null;
  gitBranch: string | null;
  /** epoch ms */
  lastModified: number;
  createdAt: number | null;
  fileSize: number | null;
}

/**
 * 대시보드 채팅창에 표시할 최근 항목 수.
 * 도구 호출까지 포함하므로 텍스트만 담던 때보다 넉넉히 잡는다.
 */
const TRANSCRIPT_PREVIEW_ITEMS = 200;

function toDiscovered(s: {
  sessionId: string;
  summary: string;
  cwd?: string;
  gitBranch?: string;
  lastModified: number;
  createdAt?: number;
  fileSize?: number;
}): DiscoveredSession {
  return {
    sessionId: s.sessionId,
    summary: s.summary,
    cwd: s.cwd ?? null,
    gitBranch: s.gitBranch ?? null,
    lastModified: s.lastModified,
    createdAt: s.createdAt ?? null,
    fileSize: s.fileSize ?? null,
  };
}

/**
 * 이 컴퓨터에 저장된 Claude Code 세션 목록을 최근 사용 순으로 반환한다.
 *
 * includeProgrammatic: false 로 두면 SDK가 만든 세션(= 이 대시보드가 실행 중인
 * 세션들)은 제외된다. 대시보드 세션을 다시 대시보드로 불러오는 것을 막기 위함이다.
 */
export async function listDiscoverableSessions(limit = 50): Promise<DiscoveredSession[]> {
  const sessions = await listSessions({ limit, includeProgrammatic: false });
  return sessions.map(toDiscovered).sort((a, b) => b.lastModified - a.lastModified);
}

export async function findDiscoverableSession(sessionId: string): Promise<DiscoveredSession | undefined> {
  const info = await getSessionInfo(sessionId);
  return info ? toDiscovered(info) : undefined;
}

/** 도구 호출에서 무엇을 대상으로 했는지 뽑아낸다. */
const TOOL_ARG_KEYS = ["file_path", "path", "notebook_path", "command", "pattern", "url", "query", "prompt", "description"];

function toolTarget(input: unknown): string | null {
  const obj = (input ?? {}) as Record<string, unknown>;
  for (const key of TOOL_ARG_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      const oneLine = v.replace(/\s+/g, " ").trim();
      return oneLine.length > 120 ? `${oneLine.slice(0, 120)}…` : oneLine;
    }
  }
  return null;
}

interface ToolCall {
  name: string;
  target: string | null;
}

/**
 * 연달아 실행된 도구 호출을 한 줄로 묶는다.
 *
 * 실제 세션은 도구 호출이 대화 텍스트의 열 배가 넘어서, 하나씩 늘어놓으면
 * 정작 읽어야 할 대화가 묻힌다.
 */
function summarizeToolRun(run: ToolCall[]): string {
  if (run.length === 1) {
    const only = run[0];
    return only.target ? `🔧 ${only.name} — ${only.target}` : `🔧 ${only.name}`;
  }

  const counts = new Map<string, number>();
  for (const c of run) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join(", ");

  const targets: string[] = [];
  for (const c of run) {
    if (c.target && !targets.includes(c.target)) targets.push(c.target);
    if (targets.length === 3) break;
  }
  const tail = targets.length ? `\n${targets.map((t) => `· ${t}`).join("\n")}` : "";
  return `🔧 도구 ${run.length}회 — ${names}${tail}`;
}

export interface TranscriptEntry {
  role: "user" | "assistant" | "tool";
  content: string;
}

/**
 * 세션 기록을 대시보드에 옮겨 담을 형태로 변환한다.
 *
 * 실제 작업 세션은 대부분이 도구 호출이고 대화 텍스트는 몇 건뿐이다.
 * 텍스트만 남기면 "무슨 작업을 했는지"가 통째로 사라지므로 도구 호출도
 * 한 줄 요약으로 함께 담는다. (thinking과 tool_result는 양이 많고 그 자체로는
 * 읽을 거리가 아니라서 제외한다)
 *
 * 기록을 못 읽어도 이어받기 자체는 가능하므로 실패는 빈 결과로 처리한다.
 */
export async function readTranscript(session: DiscoveredSession): Promise<TranscriptEntry[]> {
  let raw;
  try {
    raw = await getSessionMessages(session.sessionId, session.cwd ? { dir: session.cwd } : undefined);
  } catch {
    return [];
  }

  const entries: TranscriptEntry[] = [];
  let pendingTools: ToolCall[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    entries.push({ role: "tool", content: summarizeToolRun(pendingTools) });
    pendingTools = [];
  };

  for (const m of raw) {
    if (m.type !== "user" && m.type !== "assistant") continue;
    // 서브에이전트 대화는 메인 흐름과 섞이면 읽기 어려우므로 제외한다.
    if (m.parent_agent_id !== null) continue;

    const content = (m.message as { content?: unknown } | null)?.content;

    if (typeof content === "string") {
      const t = content.trim();
      if (t) {
        flushTools();
        entries.push({ role: m.type, content: t });
      }
      continue;
    }
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      const type = (block as { type?: unknown } | null)?.type;
      if (type === "text") {
        const t = (block as { text?: unknown }).text;
        if (typeof t === "string" && t.trim()) {
          flushTools();
          entries.push({ role: m.type, content: t.trim() });
        }
      } else if (type === "tool_use") {
        const b = block as { name?: unknown; input?: unknown };
        if (typeof b.name === "string") {
          pendingTools.push({ name: b.name, target: toolTarget(b.input) });
        }
      }
    }
  }
  flushTools();

  // 오래된 기록은 잘라내고 최근 것만 보여준다.
  return entries.slice(-TRANSCRIPT_PREVIEW_ITEMS);
}
