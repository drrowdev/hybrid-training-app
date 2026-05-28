import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getKnowledge } from "../getKnowledge";

describe("getKnowledge", () => {
  it("happy path: returns archetypes, calibration policy, and constants", async () => {
    const out = await getKnowledge.handler(
      {},
      { userId: "u1", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    expect(out.archetypes.length).toBeGreaterThan(0);
    expect(out.calibration_policy).toContain("CP-1");
    expect(out.constants_table.length).toBeGreaterThan(0);
  });

  it("RLS isolation: payload is identical for any user (knowledge is static)", async () => {
    const a = await getKnowledge.handler(
      {},
      { userId: "user-a", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    const b = await getKnowledge.handler(
      {},
      { userId: "user-b", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    expect(a).toEqual(b);
  });

  it("hard cap: knowledge payload remains within bounded source-file size", async () => {
    const out = await getKnowledge.handler(
      {},
      { userId: "u1", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    const bytes = Buffer.byteLength(JSON.stringify(out), "utf-8");
    // 5k tokens ~ 20k chars; keep a safe headroom-margin so a future
    // knowledge expansion can't silently blow the budget.
    expect(bytes).toBeLessThan(40_000);
  });

  it("empty state: not applicable — knowledge is always populated", async () => {
    const out = await getKnowledge.handler(
      {},
      { userId: "u1", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    expect(out.archetypes.length).toBeGreaterThan(0);
  });
});
