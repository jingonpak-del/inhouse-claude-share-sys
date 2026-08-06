// set-admin-password.ps1 이 호출한다. 직접 실행하지 말 것.
// 비밀번호는 __ADMIN_PW 환경변수로만 받는다 (명령줄 인자는 프로세스 목록에 노출됨).
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const { nanoid } = await import("nanoid");

const password = process.env.__ADMIN_PW;
const username = process.env.__ADMIN_USER || "admin";
const displayName = process.env.__ADMIN_NAME || "관리자";

if (!password) {
  console.error("__ADMIN_PW 가 설정되지 않았습니다. set-admin-password.ps1 을 통해 실행하세요.");
  process.exit(1);
}

// server/ 를 작업 디렉터리로 두고 호출된다.
const dataDir = path.resolve(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "app.db");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// 서버가 한 번도 뜨지 않았다면 users 테이블이 없다. db.ts 와 동일한 스키마로 만든다.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('master', 'employee')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const hash = bcrypt.hashSync(password, 12);
const existing = db.prepare(`SELECT id, role FROM users WHERE username = ?`).get(username);

if (existing) {
  db.prepare(`UPDATE users SET password_hash = ?, role = 'master' WHERE id = ?`).run(hash, existing.id);
  console.log(`'${username}' 계정의 비밀번호를 변경했습니다.`);
} else {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, 'master')`
  ).run(nanoid(), username, hash, displayName);
  console.log(`'${username}' master 계정을 생성했습니다.`);
}

// 비밀번호가 바뀌었으므로 기존 로그인 세션은 모두 무효화한다.
const hasAuthSessions = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'`)
  .get();
if (hasAuthSessions) {
  db.prepare(`DELETE FROM auth_sessions`).run();
  console.log("기존 로그인 세션을 모두 만료시켰습니다.");
}

db.close();
