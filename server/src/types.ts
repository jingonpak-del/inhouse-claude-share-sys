export type Role = "master" | "employee";

export interface User {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  role: Role;
  created_at: string;
}

export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan";

export interface ClaudeSessionRow {
  id: string;
  label: string;
  model: string;
  cwd: string;
  permission_mode: PermissionMode;
  allowed_tools: string | null;
  claude_session_id: string | null;
  status: "active" | "archived";
  created_by: string;
  created_at: string;
}

export interface MessageRow {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: User;
  }
}
