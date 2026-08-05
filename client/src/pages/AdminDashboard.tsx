import { useEffect, useState } from "react";
import { api, type PermissionMode, type SessionSummary, type UserSummary } from "../api";
import { Chat } from "./Chat";

const MODEL_OPTIONS = ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"];
const PERMISSION_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "기본 (도구 실행 시 담당자 승인 요청)" },
  { value: "acceptEdits", label: "파일 편집 자동 승인" },
  { value: "plan", label: "계획 모드 (읽기 전용, 실행 안 함)" },
  { value: "bypassPermissions", label: "모든 권한 우회 (주의)" },
];

export function AdminDashboard() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [openSession, setOpenSession] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const [s, u] = await Promise.all([api.listSessions(), api.listUsers()]);
    setSessions(s.sessions);
    setUsers(u.users);
  }

  useEffect(() => {
    reload().catch((e) => setError(String(e)));
  }, []);

  if (openSession) return <Chat session={openSession} onBack={() => setOpenSession(null)} />;

  return (
    <div className="dashboard">
      <h1>관리자 대시보드</h1>
      {error && <div className="error-text">{error}</div>}

      <div className="dashboard-columns">
        <SessionListPanel sessions={sessions} users={users} onOpen={setOpenSession} onChanged={reload} />
        <div className="side-panels">
          <CreateSessionPanel users={users} onCreated={reload} />
          <CreateUserPanel onCreated={reload} />
        </div>
      </div>
    </div>
  );
}

function SessionListPanel({
  sessions,
  users,
  onOpen,
  onChanged,
}: {
  sessions: SessionSummary[];
  users: UserSummary[];
  onOpen: (s: SessionSummary) => void;
  onChanged: () => void;
}) {
  const userName = (id: string) => users.find((u) => u.id === id)?.display_name ?? id;

  return (
    <section className="panel">
      <h2>세션 목록</h2>
      <table className="table">
        <thead>
          <tr>
            <th>이름</th>
            <th>모델</th>
            <th>폴더</th>
            <th>권한 모드</th>
            <th>담당자</th>
            <th>상태</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>{s.label}</td>
              <td>{s.model}</td>
              <td className="mono">{s.cwd}</td>
              <td>{s.permission_mode}</td>
              <td>{(s.assignedUserIds ?? []).map(userName).join(", ") || "-"}</td>
              <td>{s.status === "active" ? "활성" : "보관됨"}</td>
              <td>
                <button onClick={() => onOpen(s)}>열기</button>
                {s.status === "active" && (
                  <button
                    className="danger"
                    onClick={() => api.archiveSession(s.id).then(onChanged)}
                  >
                    보관
                  </button>
                )}
              </td>
            </tr>
          ))}
          {sessions.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                생성된 세션이 없습니다.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function CreateSessionPanel({ users, onCreated }: { users: UserSummary[]; onCreated: () => void }) {
  const [label, setLabel] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS[0]);
  const [cwd, setCwd] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default");
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const employees = users.filter((u) => u.role === "employee");

  function toggleUser(id: string) {
    setAssignedUserIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createSession({ label, model, cwd, permissionMode, assignedUserIds });
      setLabel("");
      setCwd("");
      setAssignedUserIds([]);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    }
  }

  return (
    <section className="panel">
      <h2>새 세션 만들기</h2>
      <form onSubmit={submit} className="form">
        <label>
          세션 이름
          <input value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>
        <label>
          모델
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          작업 폴더 (서버 컴퓨터 경로)
          <input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="C:\work\project-a" required />
        </label>
        <label>
          권한 모드
          <select value={permissionMode} onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}>
            {PERMISSION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>담당자 배정</legend>
          {employees.map((u) => (
            <label key={u.id} className="checkbox-row">
              <input type="checkbox" checked={assignedUserIds.includes(u.id)} onChange={() => toggleUser(u.id)} />
              {u.display_name} ({u.username})
            </label>
          ))}
          {employees.length === 0 && <div className="muted">직원 계정을 먼저 생성하세요.</div>}
        </fieldset>
        {error && <div className="error-text">{error}</div>}
        <button type="submit">세션 생성</button>
      </form>
    </section>
  );
}

function CreateUserPanel({ onCreated }: { onCreated: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"employee" | "master">("employee");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({ username, password, displayName, role });
      setUsername("");
      setPassword("");
      setDisplayName("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "생성 실패");
    }
  }

  return (
    <section className="panel">
      <h2>새 계정 만들기</h2>
      <form onSubmit={submit} className="form">
        <label>
          아이디
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          이름
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          초기 비밀번호 (8자 이상)
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label>
          역할
          <select value={role} onChange={(e) => setRole(e.target.value as "employee" | "master")}>
            <option value="employee">담당자</option>
            <option value="master">관리자</option>
          </select>
        </label>
        {error && <div className="error-text">{error}</div>}
        <button type="submit">계정 생성</button>
      </form>
    </section>
  );
}
