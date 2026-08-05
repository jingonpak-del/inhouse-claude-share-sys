import { useEffect, useState } from "react";
import { api, type Me, type SessionSummary } from "../api";
import { Chat } from "./Chat";

export function EmployeeDashboard({ me }: { me: Me }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listSessions()
      .then((r) => setSessions(r.sessions))
      .catch((e) => setError(String(e)));
  }, []);

  if (openSession) return <Chat session={openSession} onBack={() => setOpenSession(null)} />;

  return (
    <div className="dashboard">
      <h1>{me.displayName}님의 세션</h1>
      {error && <div className="error-text">{error}</div>}
      <div className="session-cards">
        {sessions.map((s) => (
          <button key={s.id} className="session-card" onClick={() => setOpenSession(s)}>
            <div className="session-card-title">{s.label}</div>
            <div className="muted">{s.model}</div>
            <div className="mono muted">{s.cwd}</div>
          </button>
        ))}
        {sessions.length === 0 && <div className="muted">배정된 세션이 없습니다. 관리자에게 문의하세요.</div>}
      </div>
    </div>
  );
}
