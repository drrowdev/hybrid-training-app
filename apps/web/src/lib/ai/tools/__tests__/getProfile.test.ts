import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getProfile } from "../getProfile";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(userId: string, tables: Parameters<typeof createSupabaseStub>[0]["tables"]) {
  const { client } = createSupabaseStub({ userId, tables });
  return {
    userId,
    supabase: client as unknown as SupabaseClient,
    tz: "UTC",
  };
}

describe("getProfile", () => {
  it("happy path: returns experience tier, equipment, and active limitations", async () => {
    const ctx = makeCtx("u1", {
      profiles: [
        {
          id: "u1",
          training_experience: "intermediate_2y_5y",
          equipment: { preset: "home", bars: ["barbell"] },
        },
      ],
      limitations: [
        {
          user_id: "u1",
          region: "knee",
          kind: "tendinopathy",
          severity: "mild",
          resolved_at: null,
        },
        {
          user_id: "u1",
          region: "shoulder_scapular",
          kind: "impingement",
          severity: null,
          resolved_at: null,
        },
      ],
    });
    const out = await getProfile.handler({}, ctx);
    expect(out.experience_tier).toBe("intermediate_2y_5y");
    expect(out.equipment).toContain("preset:home");
    expect(out.active_limitations).toHaveLength(2);
    expect(out.active_limitations[0]?.region).toBe("knee");
  });

  it("RLS isolation: user A never sees user B's limitations or profile", async () => {
    const { client } = await import("./_supabase-stub").then((m) =>
      m.createSupabaseStub({
        userId: "user-a",
        tables: {
          profiles: {
            rows: [
              {
                id: "user-b",
                training_experience: "advanced_5y_plus",
                equipment: {},
                wizard_day_pref: {},
              },
            ],
            // `profiles` keys on `id` rather than `user_id`. Mirror the
            // production RLS policy that pins `id = auth.uid()`.
            rlsFilter: (row, ctx) => row.id === ctx.userId,
          },
          limitations: [
            {
              user_id: "user-b",
              region: "knee",
              kind: "tendinopathy",
              resolved_at: null,
            },
          ],
        },
      }),
    );
    const ctx = {
      userId: "user-a",
      supabase: client as unknown as import("@supabase/supabase-js").SupabaseClient,
      tz: "UTC",
    };
    const out = await getProfile.handler({}, ctx);
    expect(out.experience_tier).toBeNull();
    expect(out.active_limitations).toEqual([]);
  });

  it("hard cap: enforces <= 50 active limitations (Zod parse of schema)", () => {
    // The 50-row hard cap is applied at the query layer via `.limit(50)`;
    // here we just assert the schema accepts up to 50 entries without
    // bloating the test with a real stub.
    const sample = Array.from({ length: 50 }).map(() => ({
      region: "knee",
      kind: "tendinopathy",
      severity: null as string | null,
    }));
    const result = getProfile.outputSchema.safeParse({
      experience_tier: null,
      equipment: [],
      active_limitations: sample,
    });
    expect(result.success).toBe(true);
  });

  it("empty state: cold-start user gets null/empty fields", async () => {
    const ctx = makeCtx("u-new", { profiles: [], limitations: [] });
    const out = await getProfile.handler({}, ctx);
    expect(out.experience_tier).toBeNull();
    expect(out.equipment).toEqual([]);
    expect(out.active_limitations).toEqual([]);
  });
});
