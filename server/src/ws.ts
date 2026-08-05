import type { Server as HttpServer, IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { getTokenFromCookieHeader, getUserByToken } from "./auth.js";
import { getRuntime } from "./sessionManager.js";
import { isUserAssigned } from "./sessionManager.js";
import type { User } from "./types.js";

interface JoinMessage {
  type: "join";
  sessionId: string;
}
interface UserMessage {
  type: "user_message";
  text: string;
}
interface PermissionResponseMessage {
  type: "permission_response";
  requestId: string;
  decision: "allow" | "deny";
  updatedInput?: Record<string, unknown>;
  message?: string;
}
type InboundMessage = JoinMessage | UserMessage | PermissionResponseMessage;

export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    const token = getTokenFromCookieHeader(req.headers.cookie);
    const user = token ? getUserByToken(token) : undefined;
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, user);
    });
  });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage, user: User) => {
    let joinedSessionId: string | null = null;
    const client = { send: (data: string) => ws.readyState === WebSocket.OPEN && ws.send(data) };

    ws.on("message", (raw) => {
      let parsed: InboundMessage;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (parsed.type === "join") {
        if (joinedSessionId) return;
        const canAccess = user.role === "master" || isUserAssigned(parsed.sessionId, user.id);
        if (!canAccess) {
          client.send(JSON.stringify({ type: "error", message: "접근 권한이 없습니다." }));
          ws.close();
          return;
        }
        const runtime = getRuntime(parsed.sessionId);
        if (!runtime) {
          client.send(JSON.stringify({ type: "error", message: "세션을 찾을 수 없습니다." }));
          ws.close();
          return;
        }
        joinedSessionId = parsed.sessionId;
        runtime.subscribe(client);
        return;
      }

      if (!joinedSessionId) return;
      const runtime = getRuntime(joinedSessionId);
      if (!runtime) return;

      if (parsed.type === "user_message") {
        if (typeof parsed.text === "string" && parsed.text.trim()) {
          runtime.sendUserMessage(parsed.text);
        }
        return;
      }

      if (parsed.type === "permission_response") {
        runtime.resolvePermission(parsed.requestId, parsed.decision, parsed.updatedInput, parsed.message);
      }
    });

    ws.on("close", () => {
      if (joinedSessionId) {
        const runtime = getRuntime(joinedSessionId);
        runtime?.unsubscribe(client);
      }
    });
  });
}
