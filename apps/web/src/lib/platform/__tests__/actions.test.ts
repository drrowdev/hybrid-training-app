/**
 * Server-validation tests for `createProgramInstance`'s superset-link
 * orphan check — the gap this PR closes.
 *
 * Before this change, the orphan-strength-link check only ran when a
 * `customization` blob was present AND was the weekly V1 shape. That meant:
 *   - a canonical (uncustomized) weekly template's links were never checked;
 *   - Activation's links were never checked at all, customized or not.
 * A stale link (e.g. left over from a template swap) would deploy silently
 * and the engine would just drop the orphaned member — see
 * `strengthSeriesMembership()`, the one canonical membership source this
 * check now always uses.
 *
 * These tests call the real `createProgramInstance` action directly. Its
 * Zod validation and business-rule checks (including the one under test) all
 * run BEFORE any Supabase call, so a rejection is observable with no mocking
 * at all. To prove a *valid* link is NOT rejected, `@/lib/supabase/server` is
 * mocked to report no signed-in user — reaching that check is only possible
 * once every earlier validation, including ours, has passed.
 */
import { describe, it, expect, vi } from "vitest";
import {
  getTbTemplate,
  tbTemplateSeries,
  activationCustomizationKey,
  activationPhaseForSession,
} from "@hta/tacticalbarbell";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// `activateSeasonBlock` imports the `server-only` marker package, which is a
// Next.js build-time shim not resolvable under plain Vitest. It is only
// reached deep in the deploy path (past every check under test), so a stub
// is enough.
vi.mock("@/lib/seasons/activation", () => ({
  activateSeasonBlock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: vi.fn(async () => ({ data: { user: null }, error: null })),
  createClient: vi.fn(async () => {
    throw new Error("createClient should not be reached in these tests");
  }),
}));

import { createProgramInstance } from "../actions";

const zulu = getTbTemplate("zulu")!;
const zuluSlot1 = tbTemplateSeries(zulu).find((s) => s.key === "slot-1")!;
const zuluSlot1Members = zuluSlot1.slots.map((slot) => slot.sourceMovement);

const activation = getTbTemplate("activation")!;
// The same session/key projection `strengthSeriesMembership()` uses for
// Activation: a strength-bearing session with a resolvable phase + key.
const activationSession = activation.weeklySessions.find(
  (session) =>
    (session.fixedMovements?.length ?? 0) > 0 &&
    activationPhaseForSession(session) &&
    activationCustomizationKey(session),
)!;
const activationSeriesKey = activationCustomizationKey(activationSession)!;

const baseInput = {
  programId: "tactical-barbell",
  weekdays: [0, 1, 3, 4],
  startedOn: "2026-01-05",
};

describe("createProgramInstance — strength superset link validation", () => {
  it("rejects an orphaned link on a canonical (uncustomized) weekly template", async () => {
    // "squat" fills slot-1 on canonical Zulu; "not-a-real-movement" never does.
    const result = await createProgramInstance({
      ...baseInput,
      setupValues: { templateId: "zulu" },
      sessionLinks: {
        version: 1,
        bySeries: {
          "slot-1": [
            {
              id: "s1",
              name: "Superset",
              members: [zuluSlot1Members[0]!, "not-a-real-movement"],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("aren't in that session anymore");
    }
  });

  it("does not reject a link whose members are all in the canonical session", async () => {
    // No customization at all — this is the exact gap: canonical templates
    // support links today (the wizard's session preview is not gated on
    // "Customize template"), so this must be validated even uncustomized.
    const result = await createProgramInstance({
      ...baseInput,
      setupValues: { templateId: "zulu" },
      sessionLinks: {
        version: 1,
        bySeries: {
          "slot-1": [
            {
              id: "s1",
              name: "Superset",
              members: [zuluSlot1Members[0]!, zuluSlot1Members[1]!],
            },
          ],
        },
      },
    });
    // Reaching the mocked "no signed-in user" is only possible once every
    // earlier check — including the orphan-link check — has passed.
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("rejects an orphaned link once a customization removes the slot's movement", async () => {
    // Regression guard for the OTHER half of the fix: the check must still
    // fail closed when a customization blob IS present, dropping a movement
    // a link still references.
    const withoutFirstMovement = zuluSlot1.slots
      .filter((slot) => slot.sourceMovement !== zuluSlot1Members[0])
      .map((slot) => ({
        movement: slot.sourceMovement,
        sourceMovement: slot.sourceMovement,
        ...(slot.kind ? { kind: slot.kind } : {}),
      }));
    const result = await createProgramInstance({
      ...baseInput,
      setupValues: { templateId: "zulu" },
      customization: {
        version: 1,
        dayTypes: [
          "strength",
          "strength",
          "rest",
          "strength",
          "strength",
          "rest",
          "rest",
        ],
        sessionMovements: { "slot-1": withoutFirstMovement },
      },
      sessionLinks: {
        version: 1,
        bySeries: {
          "slot-1": [
            {
              id: "s1",
              name: "Superset",
              members: [zuluSlot1Members[0]!, zuluSlot1Members[1]!],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("aren't in that session anymore");
    }
  });

  it("rejects an orphaned link on canonical (uncustomized) Activation", async () => {
    // Activation's canonical links were never checked at all before this
    // fix — its session-link editor is UI-gated behind "Customize", but a
    // crafted/replayed payload could still carry a canonical Activation link.
    const movements = activationSession.fixedMovements!.map((m) => m.movement);
    const result = await createProgramInstance({
      ...baseInput,
      setupValues: { templateId: "activation" },
      sessionLinks: {
        version: 1,
        bySeries: {
          [activationSeriesKey]: [
            {
              id: "s1",
              name: "Superset",
              members: [movements[0]!, "not-a-real-movement"],
            },
          ],
        },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("aren't in that session anymore");
    }
  });

  it("does not reject a canonical Activation link whose members are all real", async () => {
    const movements = activationSession.fixedMovements!.map((m) => m.movement);
    // Need at least two real members for a link the schema will accept.
    expect(movements.length).toBeGreaterThanOrEqual(2);
    const result = await createProgramInstance({
      ...baseInput,
      setupValues: { templateId: "activation" },
      sessionLinks: {
        version: 1,
        bySeries: {
          [activationSeriesKey]: [
            {
              id: "s1",
              name: "Superset",
              members: [movements[0]!, movements[1]!],
            },
          ],
        },
      },
    });
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });
});
