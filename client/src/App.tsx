import { useEffect, useState } from "react";
import { api, type Me } from "./api";
import { Login } from "./pages/Login";
import { AdminDashboard } from "./pages/AdminDashboard";
import { EmployeeDashboard } from "./pages/EmployeeDashboard";
import { Guide } from "./pages/Guide";

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [showGuide, setShowGuide] = useState(false);

  function refreshMe() {
    api
      .me()
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }

  useEffect(refreshMe, []);

  if (me === undefined) return <div className="center-message">불러오는 중...</div>;
  if (me === null) return <Login onLoggedIn={refreshMe} />;

  return (
    <div className="app-shell">
      <header className="top-bar">
        <span>사내 Claude 세션 대시보드</span>
        <span>
          {me.displayName} ({me.role === "master" ? "관리자" : "담당자"})
          <button className="link-btn" onClick={() => setShowGuide((v) => !v)}>
            {showGuide ? "대시보드" : "사용 안내"}
          </button>
          <button
            className="link-btn"
            onClick={() => api.logout().then(() => setMe(null))}
          >
            로그아웃
          </button>
        </span>
      </header>
      {showGuide ? (
        <Guide role={me.role} onBack={() => setShowGuide(false)} />
      ) : me.role === "master" ? (
        <AdminDashboard />
      ) : (
        <EmployeeDashboard me={me} />
      )}
    </div>
  );
}
