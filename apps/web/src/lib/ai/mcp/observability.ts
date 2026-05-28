/**
 * Best-effort observability writer for `mcp_tool_calls`.
 *
 * Privacy contract (ADR 0003 §"Observability split"): this function
 * MUST NEVER receive raw tool input args, raw tool output bytes, or
 * any other content field. The TypeScript input type below lists the
 * only allowed keys; any object containing a forbidden key fails to
 * compile with a TS2353 "Object literal may only specify known
 * properties" error — same `RejectIfContainsContent<T>` guard as the
 * `ai_call_logs` writer.
 *
 * Writes are best-effort: if the insert fails (eg. service-role key
 * misconfigured during local dev) we console.warn and return — the
 * tool call has already completed, and dropping a metadata row should
 * never fail the user-facing operation.
 */
import { createClient } from "@supabase/supabase-js";

export type LogMcpToolCallInput = {
  userId: string;
  toolName: string;
  latencyMs: number;
  resultSizeBytes: number;
  errorCode: string | null;
};

type ForbiddenContentKey =
  | "content"
  | "args"
  | "input"
  | "output"
  | "result"
  | "messages"
  | "text"
  | "response"
  | "response_text"
  | "prompt";

type RejectIfContainsContent<T> = Extract<
  keyof T,
  ForbiddenContentKey
> extends never
  ? T
  : "ERROR: raw content fields are forbidden in mcp_tool_calls";

export async function logMcpToolCall<T extends LogMcpToolCallInput>(
  input: T & RejectIfContainsContent<T>,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("logMcpToolCall: supabase env missing — skipping insert");
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from("mcp_tool_calls").insert({
    user_id: input.userId,
    tool_name: input.toolName,
    latency_ms: input.latencyMs,
    result_size_bytes: input.resultSizeBytes,
    error_code: input.errorCode,
  });
  if (error) {
    console.warn("logMcpToolCall: insert failed", { code: error.code });
  }
}

export async function logMcpAuthorization(input: {
  userId: string;
  clientId: string;
  event: "authorize" | "revoke";
  scope: string | null;
}): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.warn("logMcpAuthorization: supabase env missing — skipping insert");
    return;
  }
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.from("mcp_authorizations").insert({
    user_id: input.userId,
    client_id: input.clientId,
    event: input.event,
    scope: input.scope,
  });
  if (error) {
    console.warn("logMcpAuthorization: insert failed", { code: error.code });
  }
}
