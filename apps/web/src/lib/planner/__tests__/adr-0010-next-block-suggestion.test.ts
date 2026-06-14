import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// next-block-suggestion-server.ts opens with `import "server-only"`, which the
// vitest node environment can't resolve — stub it to a no-op module.
vi.mock("server-only", () => ({}));

import {
  suggestNextProgram,
  suggestRealizationWeek,
  KNOWN_SUGGEST_PROGRAMS,
  type SuggestNextProgramInput,
} from "../next-block-suggestion";
import { getNextBlockNudge } from "../next-block-suggestion-server";

/**
 * Minimal Supabase query-builder fake. Every chain method returns the
 * builder; the builder resolves (await or .maybeSingle()) to a per-table
 * canned result. Covers the two queries getNextBlockNudge issues:
 *   - events   → ...eq().gte().order().limit().maybeSingle()
 *   - tm_history → ...eq().eq().gte()  (awaited directly)
 */
function makeSupabase(opts: {
  event?: { event_date: string; priority: string; modality: string | null } | null;
  deloadRows?: Array<{ id: string; session_id: string | null }>;
}): SupabaseClient {
  return {
    from(table: string) {
      const result =
        table === "events"
          ? { data: opts.event ?? null, error: null }
          : { data: opts.deloadRows ?? [], error: null };
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = chain;
      builder.eq = chain;
      builder.gte = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.maybeSingle = () => Promise.resolve(result);
      builder.then = (resolve: (r: typeof result) => unknown) => resolve(result);
      return builder;
    },
  } as unknown as SupabaseClient;
}

const TODAY = "2026-05-30";
const WINDOW_START = "2026-03-01";

const base: SuggestNextProgramInput = {
  recentPrograms: [],
  upcomingEventModality: null,
  recentReactiveDeloads: 0,
};

describe("suggestNextProgram — null when no rule fires", () => {
  it("returns null with no history, no event, no deloads", () => {
    expect(suggestNextProgram(base)).toBeNull();
  });

  it("returns null for a single block of any program", () => {
    expect(suggestNextProgram({ ...base, recentPrograms: ["wendler-531"] })).toBeNull();
    expect(suggestNextProgram({ ...base, recentPrograms: ["hybrid"] })).toBeNull();
  });

  it("returns null for two same-program blocks (below staleness)", () => {
    expect(
      suggestNextProgram({ ...base, recentPrograms: ["wendler-531", "wendler-531"] }),
    ).toBeNull();
  });

  it("returns null for a mixed, non-repeating history", () => {
    expect(
      suggestNextProgram({
        ...base,
        recentPrograms: ["wendler-531", "green-protocol", "hybrid"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextProgram — rule 1: recovery-aware (highest priority)", () => {
  it("suggests Hybrid (dial-back) when reactive deloads hit the threshold", () => {
    const out = suggestNextProgram({ ...base, recentReactiveDeloads: 2 });
    expect(out?.programId).toBe("hybrid");
    expect(out?.reason).toMatch(/reactive deload/i);
  });

  it("recovery overrides an upcoming event", () => {
    const out = suggestNextProgram({
      ...base,
      recentReactiveDeloads: 3,
      upcomingEventModality: "strength",
    });
    expect(out?.programId).toBe("hybrid");
  });

  it("does not fire below threshold", () => {
    expect(suggestNextProgram({ ...base, recentReactiveDeloads: 1 })).toBeNull();
  });
});

describe("suggestNextProgram — rule 2: event-aware", () => {
  it("strength event ⇒ 5/3/1", () => {
    const out = suggestNextProgram({ ...base, upcomingEventModality: "strength" });
    expect(out?.programId).toBe("wendler-531");
  });

  it("endurance event ⇒ Green Protocol", () => {
    const out = suggestNextProgram({ ...base, upcomingEventModality: "endurance" });
    expect(out?.programId).toBe("green-protocol");
  });

  it("mixed event ⇒ Hybrid", () => {
    const out = suggestNextProgram({ ...base, upcomingEventModality: "mixed" });
    expect(out?.programId).toBe("hybrid");
  });

  it("event overrides a same-program run", () => {
    const out = suggestNextProgram({
      ...base,
      upcomingEventModality: "endurance",
      recentPrograms: ["wendler-531", "wendler-531", "wendler-531"],
    });
    expect(out?.programId).toBe("green-protocol");
  });
});

describe("suggestNextProgram — rule 3: anti-staleness (complementary emphasis)", () => {
  it("three 5/3/1 cycles ⇒ Hybrid (add conditioning)", () => {
    const out = suggestNextProgram({
      ...base,
      recentPrograms: ["wendler-531", "wendler-531", "wendler-531"],
    });
    expect(out?.programId).toBe("hybrid");
  });

  it("three Hybrid blocks ⇒ 5/3/1 (let one quality lead)", () => {
    const out = suggestNextProgram({
      ...base,
      recentPrograms: ["hybrid", "hybrid", "hybrid"],
    });
    expect(out?.programId).toBe("wendler-531");
  });

  it("three Green Protocol blocks ⇒ 5/3/1 (rebuild strength)", () => {
    const out = suggestNextProgram({
      ...base,
      recentPrograms: ["green-protocol", "green-protocol", "green-protocol"],
    });
    expect(out?.programId).toBe("wendler-531");
  });

  it("three Tactical Barbell blocks ⇒ Hybrid (change stimulus)", () => {
    const out = suggestNextProgram({
      ...base,
      recentPrograms: ["tactical-barbell", "tactical-barbell", "tactical-barbell"],
    });
    expect(out?.programId).toBe("hybrid");
  });

  it("a run broken by a different recent program does not fire", () => {
    expect(
      suggestNextProgram({
        ...base,
        recentPrograms: ["hybrid", "wendler-531", "wendler-531"],
      }),
    ).toBeNull();
  });

  it("two of the same program (below staleness) does not fire", () => {
    expect(
      suggestNextProgram({ ...base, recentPrograms: ["hybrid", "hybrid"] }),
    ).toBeNull();
  });
});

describe("suggestNextProgram — every suggestion carries a registry display name", () => {
  it("resolves a non-empty programName for each rule output", () => {
    const strength = suggestNextProgram({ ...base, upcomingEventModality: "strength" });
    expect(strength?.programName).toBeTruthy();
    const recovery = suggestNextProgram({ ...base, recentReactiveDeloads: 2 });
    expect(recovery?.programName).toBeTruthy();
  });
});

describe("suggestNextProgram — purity", () => {
  it("does not mutate its input array", () => {
    const recentPrograms: SuggestNextProgramInput["recentPrograms"] = [
      "wendler-531",
      "wendler-531",
    ];
    const snapshot = [...recentPrograms];
    suggestNextProgram({ ...base, recentPrograms });
    expect(recentPrograms).toEqual(snapshot);
  });
});

describe("KNOWN_SUGGEST_PROGRAMS", () => {
  it("contains exactly the four selectable programs", () => {
    expect([...KNOWN_SUGGEST_PROGRAMS].sort()).toEqual(
      ["green-protocol", "hybrid", "tactical-barbell", "wendler-531"].sort(),
    );
  });
});

describe("suggestRealizationWeek — Decision 6 (opt-in, accumulation-gated)", () => {
  it("two consecutive 5/3/1 cycles, no event ⇒ realization suggested", () => {
    const out = suggestRealizationWeek({
      recentPrograms: ["wendler-531", "wendler-531"],
      upcomingEventModality: null,
    });
    expect(out).not.toBeNull();
    expect(out?.reason).toMatch(/heavy singles/i);
  });

  it("a single 5/3/1 cycle does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentPrograms: ["wendler-531"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("an upcoming event suppresses the realization nudge (real taper handles it)", () => {
    expect(
      suggestRealizationWeek({
        recentPrograms: ["wendler-531", "wendler-531"],
        upcomingEventModality: "strength",
      }),
    ).toBeNull();
  });

  it("a broken strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentPrograms: ["wendler-531", "hybrid", "wendler-531"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("a non-strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentPrograms: ["hybrid", "hybrid"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });
});

describe("getNextBlockNudge (server glue)", () => {
  it("counts distinct deload SESSIONS in the window and trips the recovery rule at the threshold", async () => {
    const supabase = makeSupabase({
      event: null,
      deloadRows: [
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-A" },
        { id: "h3", session_id: "sess-B" },
      ],
    });
    const nudge = await getNextBlockNudge(supabase, "user-1", ["hybrid"], TODAY, WINDOW_START);
    expect(nudge.suggestion?.programId).toBe("hybrid");
    expect(nudge.suggestion?.reason).toMatch(/reactive deload/i);
  });

  it("a single deload episode (rows sharing one session) does NOT trip recovery", async () => {
    const supabase = makeSupabase({
      event: null,
      deloadRows: [
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-A" },
      ],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["green-protocol"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion).toBeNull();
  });

  it("falls back to row id when session_id is null (still counts as an episode)", async () => {
    const supabase = makeSupabase({
      event: null,
      deloadRows: [
        { id: "h1", session_id: null },
        { id: "h2", session_id: null },
      ],
    });
    const nudge = await getNextBlockNudge(supabase, "user-1", ["hybrid"], TODAY, WINDOW_START);
    expect(nudge.suggestion?.programId).toBe("hybrid");
  });

  it("skips the deload query entirely when windowStartYmd is null", async () => {
    const supabase = makeSupabase({
      event: null,
      deloadRows: [
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-B" },
      ],
    });
    const nudge = await getNextBlockNudge(supabase, "user-1", ["hybrid"], TODAY, null);
    expect(nudge.suggestion).toBeNull();
  });

  it("maps an upcoming A-event modality to the matching program when no deload backoff", async () => {
    const supabase = makeSupabase({
      event: { event_date: "2026-07-01", priority: "A", modality: "running" },
      deloadRows: [],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["wendler-531"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.programId).toBe("green-protocol");
  });

  it("recovery backoff outranks an upcoming event (safety first)", async () => {
    const supabase = makeSupabase({
      event: { event_date: "2026-07-01", priority: "A", modality: "running" },
      deloadRows: [
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-B" },
      ],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["wendler-531"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.programId).toBe("hybrid");
  });
});
