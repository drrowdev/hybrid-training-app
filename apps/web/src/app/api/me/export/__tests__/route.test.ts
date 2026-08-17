/**
 * Contract tests for GET /api/me/export.
 *
 * These pin the export-v2 portability format so that silent drift fails CI
 * (golden-master discipline):
 *
 *  - 401 when unauthenticated.
 *  - 200 + the stable schema/format_version identifiers.
 *  - Every user-owned table is queried (coverage pin — dropping a table from
 *    the export breaks this test).
 *  - Secrets and derived tables are NEVER queried and NEVER appear as payload
 *    sections; they are instead declared under `excluded`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const fromCalls: string[] = [];
let currentUser: { id: string; email: string; created_at: string } | null = null;

function makeBuilder(table: string) {
  const result =
    table === "profiles"
      ? {
          data: {
            id: "u1",
            ai_notes: "Train consistently",
            byoai_provider: "openai",
            byoai_key_vault_id: "vault-1",
            byoai_model: "retired-model",
            byoai_unlocked_at: "2026-01-01T00:00:00Z",
          },
          error: null,
        }
      : { data: [], error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select() {
      return builder;
    },
    eq() {
      return builder;
    },
    order() {
      return builder;
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
    // Thenable so `await supabase.from(t).select(...).order(...)` resolves.
    then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
      return Promise.resolve(result).then(onFulfilled);
    },
  };
  return builder;
}

const fakeClient = {
  from(table: string) {
    fromCalls.push(table);
    return makeBuilder(table);
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fakeClient),
  getAuthUser: vi.fn(async () => ({ data: { user: currentUser } })),
}));

import { GET } from "../route";

beforeEach(() => {
  fromCalls.length = 0;
  currentUser = { id: "u1", email: "u1@example.test", created_at: "2026-01-01T00:00:00Z" };
});

/** Every user-owned table the export must cover. `custom_movements` is sourced
 *  from the `movements` table filtered to the user, hence "movements" here. */
const REQUIRED_TABLES = [
  "profiles",
  "training_maxes",
  "tm_history",
  "training_blocks",
  "planned_sessions",
  "sessions",
  "session_movements",
  "set_logs",
  "cardio_logs",
  "wellness",
  "limitations",
  "limitation_events",
  "priority_events",
  "bw_progress",
  "bw_progression_events",
  "prescription_modifications",
  "engine_override_events",
  "region_state",
  "movements",
];

/** Payload section keys (note: `movements` surfaces as `custom_movements`). */
const REQUIRED_SECTIONS = [
  "profile",
  "training_maxes",
  "tm_history",
  "training_blocks",
  "planned_sessions",
  "sessions",
  "session_movements",
  "set_logs",
  "cardio_logs",
  "wellness",
  "limitations",
  "limitation_events",
  "priority_events",
  "bw_progress",
  "bw_progression_events",
  "prescription_modifications",
  "engine_override_events",
  "region_state",
  "custom_movements",
];

/** These must NEVER be queried or appear as a payload section. */
const FORBIDDEN_TABLES = [
  "ai_call_logs",
  "byoai_key_events",
  "byoai_key_secrets",
  "chat_messages",
  "chat_threads",
  "memories",
  "mcp_authorizations",
  "mcp_consumed_codes",
  "mcp_tool_calls",
  "strava_connections",
  "tm_suggestions",
  "region_state_history",
  "muscle_state_history",
  "bw_diagnostics_snapshots",
];

describe("GET /api/me/export", () => {
  it("returns 401 when unauthenticated", async () => {
    currentUser = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
  });

  it("returns 200 with the stable schema + format_version", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe("hybrid-training-app/export-v2");
    expect(body.format_version).toBe(2);
    expect(body.user.id).toBe("u1");
    expect(body.profile).toHaveProperty("training_notes");
    expect(body.profile).not.toHaveProperty("ai_notes");
    expect(body.profile).not.toHaveProperty("byoai_provider");
    expect(body.profile).not.toHaveProperty("byoai_key_vault_id");
    expect(body.profile).not.toHaveProperty("byoai_model");
    expect(body.profile).not.toHaveProperty("byoai_unlocked_at");
  });

  it("queries every user-owned table (coverage pin)", async () => {
    await GET();
    for (const t of REQUIRED_TABLES) {
      expect(fromCalls, `export must query ${t}`).toContain(t);
    }
  });

  it("emits every required payload section", async () => {
    const body = await (await GET()).json();
    for (const key of REQUIRED_SECTIONS) {
      expect(body, `payload must include ${key}`).toHaveProperty(key);
    }
  });

  it("never queries secrets or derived tables", async () => {
    await GET();
    for (const t of FORBIDDEN_TABLES) {
      expect(fromCalls, `export must NOT query ${t}`).not.toContain(t);
    }
  });

  it("never emits secrets or derived tables as payload sections", async () => {
    const body = await (await GET()).json();
    for (const t of FORBIDDEN_TABLES) {
      expect(body, `payload must NOT include ${t}`).not.toHaveProperty(t);
    }
  });

  it("declares the remaining excluded secret + derived tables", async () => {
    const body = await (await GET()).json();
    // No secret tables remain to exclude: `strava_connections` was the only
    // entry and it was dropped in migration 0130 with the Strava removal.
    expect(body.excluded.secrets).toEqual([]);
    expect(body.excluded.derived).toEqual(
      expect.arrayContaining([
        "tm_suggestions",
        "region_state_history",
        "muscle_state_history",
        "bw_diagnostics_snapshots",
      ]),
    );
  });

  it("sets a JSON download disposition", async () => {
    const res = await GET();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain(".json");
  });
});
