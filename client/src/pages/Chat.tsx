import { useEffect, useRef, useState } from "react";
import type { OutboundEvent } from "../wsTypes";
import { api, type SessionSummary } from "../api";

interface FeedItem {
  key: string;
  kind: "user" | "assistant" | "tool_use" | "tool_result" | "permission_request" | "status" | "error" | "result";
  text?: string;
  toolName?: string;
  input?: unknown;
  requestId?: string;
  resolved?: "allow" | "deny";
  statusValue?: string;
}

let keyCounter = 0;
const nextKey = () => `k${++keyCounter}`;

export function Chat({ session, onBack }: { session: SessionSummary; onBack: () => void }) {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: "join", sessionId: session.id }));
    };
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const event = JSON.parse(ev.data) as OutboundEvent;
      handleEvent(event);
    };

    return () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  function handleEvent(event: OutboundEvent) {
    if (event.type === "history") {
      setFeed(
        event.messages.map((m) => ({
          key: nextKey(),
          // 이어받은 세션의 기록에는 도구 호출 요약('tool')도 섞여 있다.
          kind: m.role === "user" ? "user" : m.role === "tool" ? "tool_result" : "assistant",
          text: m.content,
        }))
      );
      return;
    }
    if (event.type === "user_message") {
      setFeed((f) => [...f, { key: nextKey(), kind: "user", text: event.text }]);
      return;
    }
    if (event.type === "assistant_text") {
      setFeed((f) => [...f, { key: nextKey(), kind: "assistant", text: event.text }]);
      return;
    }
    if (event.type === "tool_use") {
      setFeed((f) => [...f, { key: nextKey(), kind: "tool_use", toolName: event.name, input: event.input }]);
      return;
    }
    if (event.type === "tool_result") {
      setFeed((f) => [
        ...f,
        { key: nextKey(), kind: "tool_result", text: typeof event.content === "string" ? event.content : JSON.stringify(event.content) },
      ]);
      return;
    }
    if (event.type === "permission_request") {
      setFeed((f) => [
        ...f,
        { key: nextKey(), kind: "permission_request", toolName: event.toolName, input: event.input, requestId: event.requestId },
      ]);
      return;
    }
    if (event.type === "result") {
      setFeed((f) => [...f, { key: nextKey(), kind: "result", text: event.subtype }]);
      return;
    }
    if (event.type === "status") {
      setFeed((f) => [...f, { key: nextKey(), kind: "status", statusValue: event.status }]);
      return;
    }
    if (event.type === "error") {
      setFeed((f) => [...f, { key: nextKey(), kind: "error", text: event.message }]);
    }
  }

  /** PC에서 이어서 작업한 내용을 다시 가져온다. 서버가 갱신된 기록을 push해준다. */
  async function sync() {
    setSyncing(true);
    setSyncError(null);
    try {
      await api.syncSession(session.id);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "동기화 실패");
    } finally {
      setSyncing(false);
    }
  }

  function send() {
    if (!input.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "user_message", text: input }));
    setInput("");
  }

  function respondPermission(requestId: string, decision: "allow" | "deny") {
    wsRef.current?.send(JSON.stringify({ type: "permission_response", requestId, decision }));
    setFeed((f) => f.map((item) => (item.requestId === requestId ? { ...item, resolved: decision } : item)));
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <button className="link-btn" onClick={onBack}>
          ← 목록으로
        </button>
        <div>
          <strong>{session.label}</strong>
          <span className="muted"> · {session.model} · {session.cwd}</span>
        </div>
        {session.claude_session_id && (
          <button className="secondary" onClick={sync} disabled={syncing}>
            {syncing ? "가져오는 중…" : "대화 새로고침"}
          </button>
        )}
        <span className={`badge ${connected ? "ok" : "off"}`}>{connected ? "연결됨" : "연결 끊김"}</span>
      </div>
      {syncError && <div className="error-text">{syncError}</div>}

      <div className="chat-feed">
        {feed.map((item) => (
          <FeedRow key={item.key} item={item} onRespond={respondPermission} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="메시지를 입력하세요 (Shift+Enter 줄바꿈)"
          rows={3}
        />
        <button onClick={send} disabled={!connected || !input.trim()}>
          보내기
        </button>
      </div>
    </div>
  );
}

function FeedRow({ item, onRespond }: { item: FeedItem; onRespond: (requestId: string, decision: "allow" | "deny") => void }) {
  if (item.kind === "user") return <div className="msg msg-user">{item.text}</div>;
  if (item.kind === "assistant") return <div className="msg msg-assistant">{item.text}</div>;
  if (item.kind === "tool_use")
    return (
      <div className="msg msg-tool">
        🔧 <strong>{item.toolName}</strong>
        <pre>{JSON.stringify(item.input, null, 2)}</pre>
      </div>
    );
  if (item.kind === "tool_result") return <div className="msg msg-tool-result">{item.text}</div>;
  if (item.kind === "permission_request")
    return (
      <div className="msg msg-permission">
        <div>
          🔒 <strong>{item.toolName}</strong> 실행 승인 요청
        </div>
        <pre>{JSON.stringify(item.input, null, 2)}</pre>
        {item.resolved ? (
          <span className={`badge ${item.resolved === "allow" ? "ok" : "off"}`}>
            {item.resolved === "allow" ? "승인됨" : "거부됨"}
          </span>
        ) : (
          <div className="perm-actions">
            <button className="allow" onClick={() => onRespond(item.requestId!, "allow")}>
              승인
            </button>
            <button className="deny" onClick={() => onRespond(item.requestId!, "deny")}>
              거부
            </button>
          </div>
        )}
      </div>
    );
  if (item.kind === "status") return <div className="msg msg-status">상태: {item.statusValue}</div>;
  if (item.kind === "result") return <div className="msg msg-status">응답 완료 ({item.text})</div>;
  if (item.kind === "error") return <div className="msg msg-error">오류: {item.text}</div>;
  return null;
}
