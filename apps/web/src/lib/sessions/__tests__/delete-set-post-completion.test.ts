/**
 * deleteSet / updateStrengthSetInline must go through the shared
 * post-completion helper so TM banners follow later edits.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const SET_ID = "00000000-0000-4000-8000-000000000020";

const recomputeCalls: Array<Record<string, unknown>> = [];
const revalidated: string[] = [];
let recomputed = false;
let deletedIds: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        delete: () => {
          if (table === "set_logs") deletedIds.push(SET_ID);
          return builder;
        },
        update: () => builder,
        maybeSingle: async () => {
          if (table === "set_logs") {
            return {
              data: {
                id: SET_ID,
                set_kind: "main",
                skipped: false,
                skip_reason: null,
                prescription_item_index: 0,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async (
    args: Record<string, unknown>,
  ) => {
    recomputeCalls.push(args);
    return { recomputed };
  },
}));

beforeAll(async () => {
  await import("../actions");
}, 20_000);

describe("deleteSet — post-completion recompute", () => {
  beforeEach(() => {
    recomputeCalls.length = 0;
    revalidated.length = 0;
    deletedIds = [];
    recomputed = false;
  });

  it("routes the delete through the shared helper", async () => {
    const { deleteSet } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SET_ID);
    fd.set("sessionId", SESSION_ID);
    await deleteSet(fd);
    expect(deletedIds).toEqual([SET_ID]);
    expect(recomputeCalls).toEqual([
      {
        supabase: expect.anything(),
        sessionId: SESSION_ID,
        userId: USER_ID,
        emptyLogBehavior: "zero-actual",
      },
    ]);
  });

  it("revalidates Today when the session was already complete", async () => {
    recomputed = true;
    const { deleteSet } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SET_ID);
    fd.set("sessionId", SESSION_ID);
    await deleteSet(fd);
    expect(revalidated).toEqual(
      expect.arrayContaining(["/app", "/app/plan", `/app/sessions/${SESSION_ID}`]),
    );
  });
});

describe("updateStrengthSetInline — post-completion recompute", () => {
  beforeEach(() => {
    recomputeCalls.length = 0;
    revalidated.length = 0;
    recomputed = false;
  });

  it("routes an inline edit through the shared helper", async () => {
    const { updateStrengthSetInline } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SET_ID);
    fd.set("sessionId", SESSION_ID);
    fd.set("setKind", "main");
    fd.set("weightKg", "100");
    fd.set("reps", "3");
    const res = await updateStrengthSetInline(fd);
    expect(res).toEqual({ ok: true });
    expect(recomputeCalls).toEqual([
      { supabase: expect.anything(), sessionId: SESSION_ID, userId: USER_ID },
    ]);
  });
});
