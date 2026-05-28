import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getMemories } from "../getMemories";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(userId: string, tables: Parameters<typeof createSupabaseStub>[0]["tables"]) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

describe("getMemories", () => {
  it("happy path: returns the user's memories", async () => {
    const ctx = makeCtx("u1", {
      memories: [
        {
          user_id: "u1",
          category: "goal",
          text: "marathon under 4h",
          created_at: "2026-05-01",
        },
        {
          user_id: "u1",
          category: "preference",
          text: "prefer mornings",
          created_at: "2026-04-15",
        },
      ],
    });
    const out = await getMemories.handler({}, ctx);
    expect(out.memories).toHaveLength(2);
    expect(out.memories[0]?.text).toBe("marathon under 4h");
  });

  it("RLS isolation: user A never sees user B's memories", async () => {
    const ctx = makeCtx("user-a", {
      memories: [
        {
          user_id: "user-b",
          category: "goal",
          text: "secret goal",
          created_at: "2026-05-01",
        },
      ],
    });
    const out = await getMemories.handler({}, ctx);
    expect(out.memories).toEqual([]);
  });

  it("hard cap: schema accepts 100 memories", () => {
    const r = getMemories.outputSchema.safeParse({
      memories: Array.from({ length: 100 }).map((_, i) => ({
        category: "context",
        text: `m-${i}`,
        created_at: "2026-01-01",
      })),
    });
    expect(r.success).toBe(true);
  });

  it("empty state: no memories returns empty", async () => {
    const ctx = makeCtx("u1", { memories: [] });
    const out = await getMemories.handler({}, ctx);
    expect(out.memories).toEqual([]);
  });
});
