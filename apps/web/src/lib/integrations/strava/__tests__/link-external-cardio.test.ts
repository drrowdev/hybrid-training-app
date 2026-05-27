/**
 * Phase 2 — integration coverage for the Strava sync → classifier →
 * planned_session link flow. Mirrors the existing `sync.test.ts`
 * pattern: mock `@/lib/stats/hr-zones` is not stubbed (the real one
 * is pure and safe to import in node), but the supabase surface is a
 * hand-rolled chainable that captures the writes we care about.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/planner/queries", () => ({
  // Date helper used by the link function — straight delegate to a
  // local copy so we don't import the whole queries module (which
  // pulls in Next.js server-only deps).
  dayDate: (startedOn: string, weekIndex: number, dayIndex: number) => {
    // startedOn is YYYY-MM-DD. The real helper snaps to the Monday of
    // the week first; for these tests we use a Monday start date so
    // the snap is a no-op and the result is startedOn + week*7 + day.
    const d = new Date(`${startedOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weekIndex * 7 + dayIndex);
    return d.toISOString().slice(0, 10);
  },
}));

import { classifyAndLinkExternalCardio } from "../link-external-cardio";

type Capture = {
  cardioUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  plannedUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
};

function makeSupa(opts: {
  intake: Record<string, unknown> | null;
  plannedRows: Array<Record<string, unknown>>;
}) {
  const capture: Capture = { cardioUpdates: [], plannedUpdates: [] };
  const supa = {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { intake: opts.intake }, error: null }),
            }),
          }),
        };
      }
      if (table === "cardio_logs") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              capture.cardioUpdates.push({ id, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "planned_sessions") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: async () => ({ data: opts.plannedRows, error: null }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              capture.plannedUpdates.push({ id, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return { supa, capture };
}

const PERFORMED_AT = "2026-05-21T07:00:00Z";

describe("classifyAndLinkExternalCardio — integration", () => {
  it("classifies, stamps cardio_logs, and links to the matching cardio_external planned session", async () => {
    const { supa, capture } = makeSupa({
      intake: { hrMax: 190 },
      plannedRows: [
        {
          id: "planned-1",
          week_index: 0,
          day_index: 3, // 2026-05-18 (Mon) + 3 = 2026-05-21 (Thu)
          prescription: { items: [{ kind: "cardio_external" }] },
          completed_session_id: null,
          training_blocks: { started_on: "2026-05-18" },
        },
      ],
    });

    const out = await classifyAndLinkExternalCardio({
      supabase: supa as never,
      userId: "u1",
      sessionId: "sess-1",
      cardioLog: { id: "cardio-1", avg_hr_bpm: 158, max_hr_bpm: 178, duration_sec: 2400 },
      performedAt: PERFORMED_AT,
      userTimezone: "UTC",
    });

    expect(out).not.toBeNull();
    expect(out?.kind).toBe("cardio_vo2");
    expect(capture.cardioUpdates).toHaveLength(1);
    expect(capture.cardioUpdates[0]?.patch.inferred_kind).toBe("cardio_vo2");
    expect(capture.plannedUpdates).toHaveLength(1);
    expect(capture.plannedUpdates[0]?.id).toBe("planned-1");
    expect(capture.plannedUpdates[0]?.patch.session_modality).toBe("cardio_vo2");
    expect(capture.plannedUpdates[0]?.patch.completed_session_id).toBe("sess-1");
    expect(Number(capture.plannedUpdates[0]?.patch.effective_stress_load)).toBeGreaterThan(0);
  });

  it("stamps cardio_logs but does NOT link when no matching planned session exists", async () => {
    const { supa, capture } = makeSupa({
      intake: { hrMax: 190 },
      plannedRows: [], // no external blocks
    });

    const out = await classifyAndLinkExternalCardio({
      supabase: supa as never,
      userId: "u1",
      sessionId: "sess-1",
      cardioLog: { id: "cardio-1", avg_hr_bpm: 130, max_hr_bpm: 150, duration_sec: 2700 },
      performedAt: PERFORMED_AT,
      userTimezone: "UTC",
    });

    expect(out?.kind).toBe("cardio_z2");
    expect(capture.cardioUpdates).toHaveLength(1);
    expect(capture.plannedUpdates).toHaveLength(0);
  });

  it("returns null and writes nothing when there's no HR data and no age fallback", async () => {
    const { supa, capture } = makeSupa({
      intake: { hrMax: 190 },
      plannedRows: [],
    });

    const out = await classifyAndLinkExternalCardio({
      supabase: supa as never,
      userId: "u1",
      sessionId: "sess-1",
      cardioLog: { id: "cardio-1", avg_hr_bpm: null, max_hr_bpm: null, duration_sec: 1800 },
      performedAt: PERFORMED_AT,
      userTimezone: "UTC",
    });

    expect(out).toBeNull();
    expect(capture.cardioUpdates).toHaveLength(0);
    expect(capture.plannedUpdates).toHaveLength(0);
  });

  it("skips the planned-session link when classifier confidence < 0.5 (220-age fallback only)", async () => {
    const { supa, capture } = makeSupa({
      intake: null, // forces 220-age fallback
      plannedRows: [
        {
          id: "planned-1",
          week_index: 0,
          day_index: 3,
          prescription: { items: [{ kind: "cardio_external" }] },
          completed_session_id: null,
          training_blocks: { started_on: "2026-05-18" },
        },
      ],
    });

    const out = await classifyAndLinkExternalCardio({
      supabase: supa as never,
      userId: "u1",
      sessionId: "sess-1",
      // Only one HR field + age fallback → 0.6 × 0.7 = 0.42, below the 0.5 link gate.
      cardioLog: { id: "cardio-1", avg_hr_bpm: 140, max_hr_bpm: null, duration_sec: 1800 },
      performedAt: PERFORMED_AT,
      userTimezone: "UTC",
    });

    // The classifier returns null because we don't pass userAge here.
    expect(out).toBeNull();
    expect(capture.plannedUpdates).toHaveLength(0);
  });
});
