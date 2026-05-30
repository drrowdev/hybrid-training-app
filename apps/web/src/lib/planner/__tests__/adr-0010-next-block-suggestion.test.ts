import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// next-block-suggestion-server.ts opens with `import "server-only"`, which the
// vitest node environment can't resolve — stub it to a no-op module.
vi.mock("server-only", () => ({}));

import {
  suggestNextArchetype,
  suggestRealizationWeek,
  type SuggestNextArchetypeInput,
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

const base: SuggestNextArchetypeInput = {
  recentArchetypes: [],
  upcomingEventModality: null,
  recentReactiveDeloads: 0,
};

describe("suggestNextArchetype — null when no rule fires", () => {
  it("returns null with no history, no event, no deloads", () => {
    expect(suggestNextArchetype(base)).toBeNull();
  });

  it("returns null for a single block of any archetype", () => {
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["strength_anchor"] }),
    ).toBeNull();
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["maintenance"] }),
    ).toBeNull();
  });

  it("returns null for two strength blocks (below staleness, not accumulation)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "strength_anchor"],
      }),
    ).toBeNull();
  });

  it("returns null for a mixed, non-repeating history", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "endurance_anchor", "hypertrophy_anchor"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — rule 1: recovery-aware (highest priority)", () => {
  it("suggests rebuild when reactive deloads hit the threshold", () => {
    const out = suggestNextArchetype({ ...base, recentReactiveDeloads: 2 });
    expect(out?.archetypeId).toBe("rebuild");
    expect(out?.reason).toMatch(/reactive deload/i);
  });

  it("recovery overrides an upcoming event", () => {
    const out = suggestNextArchetype({
      ...base,
      recentReactiveDeloads: 3,
      upcomingEventModality: "strength",
    });
    expect(out?.archetypeId).toBe("rebuild");
  });

  it("recovery overrides a hypertrophy accumulation run", () => {
    const out = suggestNextArchetype({
      ...base,
      recentReactiveDeloads: 2,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("rebuild");
  });

  it("does not fire below threshold", () => {
    expect(suggestNextArchetype({ ...base, recentReactiveDeloads: 1 })).toBeNull();
  });
});

describe("suggestNextArchetype — rule 2: event-aware", () => {
  it("strength event ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "strength" });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("endurance event ⇒ endurance_anchor", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "endurance" });
    expect(out?.archetypeId).toBe("endurance_anchor");
  });

  it("mixed event ⇒ concurrent_hybrid", () => {
    const out = suggestNextArchetype({ ...base, upcomingEventModality: "mixed" });
    expect(out?.archetypeId).toBe("concurrent_hybrid");
  });

  it("event overrides a hypertrophy accumulation run", () => {
    const out = suggestNextArchetype({
      ...base,
      upcomingEventModality: "endurance",
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("endurance_anchor");
  });
});

describe("suggestNextArchetype — rule 3: phase sequence (accumulation → strength)", () => {
  it("two hypertrophy blocks ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
    expect(out?.reason).toMatch(/consolidate/i);
  });

  it("three hypertrophy blocks still ⇒ strength_anchor (consolidation wins over staleness)", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor", "hypertrophy_anchor"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("a single hypertrophy block does not fire consolidation", () => {
    expect(
      suggestNextArchetype({ ...base, recentArchetypes: ["hypertrophy_anchor"] }),
    ).toBeNull();
  });

  it("hypertrophy run broken by a recent different block does not fire", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["strength_anchor", "hypertrophy_anchor", "hypertrophy_anchor"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — rule 4: anti-staleness", () => {
  it("three strength blocks ⇒ hypertrophy_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["strength_anchor", "strength_anchor", "strength_anchor"],
    });
    expect(out?.archetypeId).toBe("hypertrophy_anchor");
  });

  it("three endurance blocks ⇒ concurrent_hybrid", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["endurance_anchor", "endurance_anchor", "endurance_anchor"],
    });
    expect(out?.archetypeId).toBe("concurrent_hybrid");
  });

  it("three hybrid blocks ⇒ strength_anchor", () => {
    const out = suggestNextArchetype({
      ...base,
      recentArchetypes: ["concurrent_hybrid", "concurrent_hybrid", "concurrent_hybrid"],
    });
    expect(out?.archetypeId).toBe("strength_anchor");
  });

  it("three maintenance blocks do NOT nudge (repeatable by design)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["maintenance", "maintenance", "maintenance"],
      }),
    ).toBeNull();
  });

  it("three rebuild blocks do NOT nudge (repeatable by design)", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["rebuild", "rebuild", "rebuild"],
      }),
    ).toBeNull();
  });

  it("a run of custom blocks does NOT nudge", () => {
    expect(
      suggestNextArchetype({
        ...base,
        recentArchetypes: ["custom", "custom", "custom"],
      }),
    ).toBeNull();
  });
});

describe("suggestNextArchetype — purity", () => {
  it("does not mutate its input array", () => {
    const recentArchetypes: SuggestNextArchetypeInput["recentArchetypes"] = [
      "hypertrophy_anchor",
      "hypertrophy_anchor",
    ];
    const snapshot = [...recentArchetypes];
    suggestNextArchetype({ ...base, recentArchetypes });
    expect(recentArchetypes).toEqual(snapshot);
  });
});

describe("suggestRealizationWeek — Decision 6 (opt-in, accumulation-gated)", () => {
  it("two consecutive strength blocks, no event ⇒ realization suggested", () => {
    const out = suggestRealizationWeek({
      recentArchetypes: ["strength_anchor", "strength_anchor"],
      upcomingEventModality: null,
    });
    expect(out).not.toBeNull();
    expect(out?.reason).toMatch(/heavy singles/i);
  });

  it("a single strength block does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("an upcoming event suppresses the realization nudge (real taper handles it)", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor", "strength_anchor"],
        upcomingEventModality: "strength",
      }),
    ).toBeNull();
  });

  it("a broken strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["strength_anchor", "hypertrophy_anchor", "strength_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });

  it("a non-strength run does NOT earn a realization week", () => {
    expect(
      suggestRealizationWeek({
        recentArchetypes: ["hypertrophy_anchor", "hypertrophy_anchor"],
        upcomingEventModality: null,
      }),
    ).toBeNull();
  });
});

describe("getNextBlockNudge (server glue)", () => {
  it("counts distinct deload SESSIONS in the window and trips the rebuild rule at the threshold", async () => {
    const supabase = makeSupabase({
      event: null,
      deloadRows: [
        // Two lifts deloaded in one episode (session A) + one in episode B
        // ⇒ 2 distinct sessions ⇒ at the REACTIVE_DELOAD_BACKOFF threshold.
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-A" },
        { id: "h3", session_id: "sess-B" },
      ],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["hypertrophy_anchor"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.archetypeId).toBe("rebuild");
  });

  it("a single deload episode (rows sharing one session) does NOT trip rebuild", async () => {
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
      ["endurance_anchor"],
      TODAY,
      WINDOW_START,
    );
    // One episode < threshold, no other rule fires for a lone endurance block.
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
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["hypertrophy_anchor"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.archetypeId).toBe("rebuild");
  });

  it("skips the deload query entirely when windowStartYmd is null", async () => {
    const supabase = makeSupabase({
      event: null,
      // These rows would trip rebuild IF queried — but a null window must skip them.
      deloadRows: [
        { id: "h1", session_id: "sess-A" },
        { id: "h2", session_id: "sess-B" },
      ],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["hypertrophy_anchor"],
      TODAY,
      null,
    );
    expect(nudge.suggestion).toBeNull();
  });

  it("maps an upcoming A-event modality to the matching archetype when no deload backoff", async () => {
    const supabase = makeSupabase({
      event: { event_date: "2026-07-01", priority: "A", modality: "running" },
      deloadRows: [],
    });
    const nudge = await getNextBlockNudge(
      supabase,
      "user-1",
      ["strength_anchor"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.archetypeId).toBe("endurance_anchor");
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
      ["strength_anchor"],
      TODAY,
      WINDOW_START,
    );
    expect(nudge.suggestion?.archetypeId).toBe("rebuild");
  });
});
