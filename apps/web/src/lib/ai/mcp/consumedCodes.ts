/**
 * Helpers for the single-use authorization-code table
 * `mcp_consumed_codes`. ADR 0003 + PR #194 Fix #2.
 *
 * `markCodeConsumed(code)` is the gate the /mcp/token route holds:
 *   1. hash the code (SHA-256, base64url),
 *   2. atomically INSERT the hash with ON CONFLICT DO NOTHING RETURNING,
 *   3. return true iff the insert produced a row (i.e. first-redemption).
 *
 * Backed by the Supabase service-role client because the table is
 * intentionally RLS-default-deny (no authenticated reads/writes).
 */
import { createHash } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function hashAuthCode(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

export type ConsumedCodeStore = {
  /** Returns true iff this code's hash was newly inserted (i.e. not a replay). */
  markCodeConsumed(codeHash: string): Promise<boolean>;
};

function buildAdminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export const defaultConsumedCodeStore: ConsumedCodeStore = {
  async markCodeConsumed(codeHash: string): Promise<boolean> {
    const admin = buildAdminClient();
    if (!admin) {
      // Fail closed — without a service-role client we can't enforce
      // single-use, so refuse the redemption rather than silently
      // permit replay.
      throw new Error(
        "mcp_consumed_codes: Supabase service-role credentials missing",
      );
    }
    const { data, error } = await admin
      .from("mcp_consumed_codes")
      .insert({ code_hash: codeHash })
      .select("code_hash");
    if (error) {
      // Postgres unique_violation = '23505'. Anything else is a real
      // failure and we fail closed (treat as already-consumed).
      if (error.code === "23505") return false;
      throw new Error(
        `mcp_consumed_codes: insert failed (${error.code ?? "unknown"})`,
      );
    }
    return Array.isArray(data) && data.length > 0;
  },
};
