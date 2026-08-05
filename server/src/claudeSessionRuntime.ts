import { query } from "@anthropic-ai/claude-agent-sdk";
import type { Options, PermissionResult, Query, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { AsyncQueue } from "./asyncQueue.js";
import { db } from "./db.js";
import type { ClaudeSessionRow } from "./types.js";

export type OutboundEvent =
  | { type: "history"; messages: { role: string; content: string; created_at: string }[] }
  | { type: "user_message"; text: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: "permission_request"; requestId: string; toolName: string; input: unknown; title?: string; description?: string }
  | { type: "result"; subtype: string; isError: boolean; costUsd?: number }
  | { type: "status"; status: "starting" | "running" | "idle" | "error" }
  | { type: "error"; message: string };

export interface WSClient {
  send(data: string): void;
}

export class ClaudeSessionRuntime {
  readonly id: string;
  private row: ClaudeSessionRow;
  private queue = new AsyncQueue<SDKUserMessage>();
  private clients = new Set<WSClient>();
  private pendingPermissions = new Map<string, (r: PermissionResult) => void>();
  private started = false;
  private queryHandle: Query | null = null;

  constructor(row: ClaudeSessionRow) {
    this.id = row.id;
    this.row = row;
  }

  subscribe(client: WSClient): void {
    this.clients.add(client);
    this.sendHistoryTo(client);
    this.start();
  }

  unsubscribe(client: WSClient): void {
    this.clients.delete(client);
  }

  private sendHistoryTo(client: WSClient): void {
    const rows = db
      .prepare(
        `SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC`
      )
      .all(this.id) as { role: string; content: string; created_at: string }[];
    client.send(JSON.stringify({ type: "history", messages: rows } satisfies OutboundEvent));
  }

  private broadcast(event: OutboundEvent): void {
    const data = JSON.stringify(event);
    for (const c of this.clients) c.send(data);
  }

  private persist(role: string, content: string): void {
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)`
    ).run(nanoid(), this.id, role, content);
  }

  sendUserMessage(text: string): void {
    this.persist("user", text);
    this.broadcast({ type: "user_message", text });
    this.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
    this.start();
  }

  resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
    updatedInput?: Record<string, unknown>,
    message?: string
  ): void {
    const resolver = this.pendingPermissions.get(requestId);
    if (!resolver) return;
    this.pendingPermissions.delete(requestId);
    if (decision === "allow") {
      resolver({ behavior: "allow", updatedInput });
    } else {
      resolver({ behavior: "deny", message: message ?? "담당자가 거부했습니다." });
    }
  }

  private canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      signal: AbortSignal;
      requestId: string;
      title?: string;
      description?: string;
      displayName?: string;
    }
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      this.pendingPermissions.set(opts.requestId, resolve);
      this.broadcast({
        type: "permission_request",
        requestId: opts.requestId,
        toolName,
        input,
        title: opts.title,
        description: opts.description,
      });

      const timeout = setTimeout(() => {
        if (this.pendingPermissions.delete(opts.requestId)) {
          resolve({ behavior: "deny", message: "승인 대기 시간 초과로 자동 거부되었습니다." });
        }
      }, 10 * 60 * 1000);

      opts.signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        if (this.pendingPermissions.delete(opts.requestId)) {
          resolve({ behavior: "deny", message: "작업이 취소되었습니다." });
        }
      });
    });
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    this.broadcast({ type: "status", status: "starting" });
    this.runLoop().catch((err: unknown) => {
      this.started = false;
      this.broadcast({ type: "error", message: err instanceof Error ? err.message : String(err) });
    });
  }

  private async runLoop(): Promise<void> {
    const options: Options = {
      model: this.row.model,
      cwd: this.row.cwd,
      permissionMode: this.row.permission_mode,
      allowedTools: this.row.allowed_tools ? (JSON.parse(this.row.allowed_tools) as string[]) : undefined,
      canUseTool: (toolName, input, opts) => this.canUseTool(toolName, input, opts),
      resume: this.row.claude_session_id ?? undefined,
    };

    this.queryHandle = query({ prompt: this.queue, options });
    this.broadcast({ type: "status", status: "running" });

    for await (const message of this.queryHandle) {
      this.handleMessage(message);
    }
  }

  private handleMessage(message: SDKMessage): void {
    switch (message.type) {
      case "system": {
        if (message.subtype === "init" && message.session_id !== this.row.claude_session_id) {
          db.prepare(`UPDATE claude_sessions SET claude_session_id = ? WHERE id = ?`).run(
            message.session_id,
            this.id
          );
          this.row.claude_session_id = message.session_id;
        }
        break;
      }
      case "assistant": {
        const content = message.message.content;
        for (const block of content) {
          if (block.type === "text" && block.text) {
            this.persist("assistant", block.text);
            this.broadcast({ type: "assistant_text", text: block.text });
          } else if (block.type === "tool_use") {
            this.broadcast({ type: "tool_use", id: block.id, name: block.name, input: block.input });
          }
        }
        break;
      }
      case "user": {
        const content = message.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              this.broadcast({
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                content: block.content,
                is_error: block.is_error,
              });
            }
          }
        }
        break;
      }
      case "result": {
        this.broadcast({
          type: "result",
          subtype: message.subtype,
          isError: message.is_error,
          costUsd: message.total_cost_usd,
        });
        this.broadcast({ type: "status", status: "idle" });
        break;
      }
      default:
        break;
    }
  }

  stop(): void {
    this.queue.close();
    void this.queryHandle?.return?.(undefined);
  }
}
