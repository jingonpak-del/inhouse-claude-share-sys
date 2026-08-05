export type Role = "master" | "employee";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface Me {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

export interface SessionSummary {
  id: string;
  label: string;
  model: string;
  cwd: string;
  permission_mode: PermissionMode;
  allowed_tools: string | null;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
  assignedUserIds?: string[];
}

export interface UserSummary {
  id: string;
  username: string;
  display_name: string;
  role: Role;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error ?? `요청 실패 (${res.status})`);
  }
  return body as T;
}

export const api = {
  me: () => request<{ user: Me }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ user: Me }>("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  listSessions: () => request<{ sessions: SessionSummary[] }>("/api/sessions"),
  createSession: (input: {
    label: string;
    model: string;
    cwd: string;
    permissionMode: PermissionMode;
    allowedTools?: string[];
    assignedUserIds: string[];
  }) => request<{ session: SessionSummary }>("/api/sessions", { method: "POST", body: JSON.stringify(input) }),
  archiveSession: (id: string) => request<{ ok: true }>(`/api/sessions/${id}/archive`, { method: "POST" }),
  listUsers: () => request<{ users: UserSummary[] }>("/api/users"),
  createUser: (input: { username: string; password: string; displayName: string; role: Role }) =>
    request<{ user: UserSummary }>("/api/users", { method: "POST", body: JSON.stringify(input) }),
};
