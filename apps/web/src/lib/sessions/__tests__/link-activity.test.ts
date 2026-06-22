/**
 * linkActivityToPlanned — guard + happy-path coverage. The supabase surface is a
 * hand-rolled chainable (same spirit as link-external-cardio.test.ts) and
 * createClient/getAuthUser are mocked to inject it + a fixed user.
 */
import { describe, it, expect, vi } from "vitest";

const supaState: {
  planned: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  log: Record<string, unknown> | null;
  intake: Record<string, unknown> | null;
  plannedUpdate: Record<string, unknown> | null;
} = { planned: null, session: null, log: null, intake: null, plannedUpdate: null };

function terminal<T>(value: T) {
  // A chainable whose every method returns itself, and whose terminal awaiters
  // resolve to the configured value.
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "not", "gte", "in", "order", "limit"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = async () => ({ data: value, error: null });
  chain.then = undefined;
  return chain;
}

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({ data: { user: { id: "u1" } } }),
  createClient: async () => ({
    from(table: string) {
      if (table === "planned_sessions") {
        return {
          ...terminal(supaState.planned),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              eq: async () => {
                supaState.plannedUpdate = patch;
                return { data: null, error: null };
              },
            }),
          }),
        };
      }
      if (table === "sessions") return terminal(supaState.session);
      if (table === "cardio_logs") return terminal(supaState.log);
      if (table === "profiles") return terminal({ intake: supaState.intake });
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { linkActivityToPlanned } from "../link-activity";

function fd(plannedId: string, sessionId: string): FormData {
  const f = new FormData();
  f.set("plannedId", plannedId);
  f.set("sessionId", sessionId);
  return f;
}

const PID = "00000000-0000-0000-0000-0000000000a1";
const SID = "00000000-0000-0000-0000-0000000000b2";

describe("linkActivityToPlanned", () => {
  it("refuses to complete a session that also prescribes strength (hybrid guard)", async () => {
    supaState.planned = { id: PID, user_id: "u1", prescription: { items: [{ kind: "main" }] } };
    supaState.plannedUpdate = null;
    const res = await linkActivityToPlanned(fd(PID, SID));
    expect(res.error).toMatch(/strength/i);
    expect(supaState.plannedUpdate).toBeNull(); // never linked
  });

  it("links a pure cardio session and attributes modality + ESL from HR", async () => {
    supaState.planned = { id: PID, user_id: "u1", prescription: { items: [{ kind: "cardio" }] } };
    supaState.session = { id: SID };
    // ~152 bpm avg, max 175, 57 min, hrMax ~189 (z4Max 170 → /0.9) → threshold-ish.
    supaState.log = { avg_hr_bpm: 152, max_hr_bpm: 175, duration_sec: 3420 };
    supaState.intake = { hrZones: { z1Max: 120, z2Max: 142, z3Max: 161, z4Max: 170 } };
    supaState.plannedUpdate = null;

    const res = await linkActivityToPlanned(fd(PID, SID));
    expect(res.ok).toBe(true);
    const upd = supaState.plannedUpdate as Record<string, unknown> | null;
    expect(upd).toMatchObject({ completed_session_id: SID });
    expect(upd?.session_modality).toBeTruthy();
    expect(typeof upd?.effective_stress_load).toBe("number");
  });

  it("links even without HR data, leaving load attribution unset", async () => {
    supaState.planned = { id: PID, user_id: "u1", prescription: { items: [{ kind: "cardio" }] } };
    supaState.session = { id: SID };
    supaState.log = { avg_hr_bpm: null, max_hr_bpm: null, duration_sec: 3000 };
    supaState.intake = null;
    supaState.plannedUpdate = null;

    const res = await linkActivityToPlanned(fd(PID, SID));
    expect(res.ok).toBe(true);
    const upd = supaState.plannedUpdate as Record<string, unknown> | null;
    expect(upd).toMatchObject({ completed_session_id: SID });
    expect(upd?.session_modality).toBeUndefined();
  });
});
