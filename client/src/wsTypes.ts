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
