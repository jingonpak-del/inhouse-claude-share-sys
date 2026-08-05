import express from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "./db.js";
import { authMiddleware, createUser } from "./auth.js";
import { authRouter } from "./routes/auth.js";
import { sessionsRouter, usersRouter } from "./routes/sessions.js";
import { attachWebSocketServer } from "./ws.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function bootstrapMasterAccount(): void {
  const count = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  if (count > 0) return;
  const username = process.env.ADMIN_USERNAME ?? "admin";
  const password = process.env.ADMIN_PASSWORD ?? "changeme123";
  createUser(username, password, "관리자", "master");
  console.log(`[bootstrap] 최초 master 계정 생성: ${username} / ${password} (반드시 로그인 후 비밀번호를 변경하세요)`);
}

bootstrapMasterAccount();

const app = express();
app.set("trust proxy", 1);
app.use(express.json());
app.use(authMiddleware);

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/users", usersRouter);

const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

const server = http.createServer(app);
attachWebSocketServer(server);

const port = Number(process.env.PORT ?? 4000);
// Caddy(리버스 프록시)만 이 포트에 접근하면 되므로 기본값은 루프백으로 제한한다.
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`서버 실행 중: http://${host}:${port}`);
});
