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
 * 대화 기록을 미리 불러올 최대 파일 크기.
 * 이보다 큰 세션은 전체를 파싱하면 서버가 수 초간 멈추므로 기록 복사를 건너뛴다.
 * (세션을 이어받는 것 자체는 크기와 무관하게 동작한다 — Claude는 맥락을 그대로 유지한다)
 */
const TRANSCRIPT_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/** 불러온 뒤 대시보드 채팅창에 표시할 최근 메시지 수 */
const TRANSCRIPT_PREVIEW_MESSAGES = 60;

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

/** SDK 메시지에서 사람이 읽을 수 있는 텍스트만 뽑아낸다. */
function extractText(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: "text"; text: string } =>
        !!b && (b as { type?: unknown }).type === "text" && typeof (b as { text?: unknown }).text === "string"
    )
    .map((b) => b.text)
    .join("\n")
    .trim();
}

export interface TranscriptPreview {
  messages: { role: "user" | "assistant"; content: string }[];
  /** 파일이 너무 커서 기록 복사를 건너뛴 경우 true */
  skipped: boolean;
}

/**
 * 세션의 최근 대화를 읽어 대시보드에 옮겨 담을 형태로 반환한다.
 *
 * 기록을 못 읽어도 세션 이어받기 자체는 가능하므로, 실패는 예외로 올리지 않고
 * 빈 결과로 처리한다.
 */
export async function readTranscriptPreview(session: DiscoveredSession): Promise<TranscriptPreview> {
  if (session.fileSize !== null && session.fileSize > TRANSCRIPT_PREVIEW_MAX_BYTES) {
    return { messages: [], skipped: true };
  }

  let raw;
  try {
    raw = await getSessionMessages(session.sessionId, session.cwd ? { dir: session.cwd } : undefined);
  } catch {
    return { messages: [], skipped: true };
  }

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of raw) {
    if (m.type !== "user" && m.type !== "assistant") continue;
    // 서브에이전트 대화는 메인 흐름과 섞이면 읽기 어려우므로 제외한다.
    if (m.parent_agent_id !== null) continue;
    const text = extractText(m.message);
    if (!text) continue;
    messages.push({ role: m.type, content: text });
  }

  // 오래된 대화는 잘라내고 최근 것만 보여준다.
  return { messages: messages.slice(-TRANSCRIPT_PREVIEW_MESSAGES), skipped: false };
}
