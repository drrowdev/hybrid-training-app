/**
 * A COMPLETED session must stay editable: correct a logged set, and add one the
 * app never gave you a slot for.
 *
 * Owner report: "The edit button in the drawer for a finished session doesn't
 * really do anything smart… I'd like it to open the 'full session view' which
 * allows me to also edit each of the individual sets. (e.g. I'd like to add
 * another set to a movement where the app didn't allow me to do it during the
 * session)".
 *
 * The web test env is Node (no JSDOM), so we assert static markup via
 * `renderToStaticMarkup` against the exported pure pieces. A read-only
 * `<MovementCard>` renders collapsed and the add disclosure starts closed, so
 * both `CompletedSetsPanel` and `PostHocSetForm` are exported to make their
 * contracts assertable; the expand interactions are Playwright's job.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

import { CompletedSetsPanel, defaultPostHocSetKind } from "../MovementCard";
import {
  AddSetAfterCompletion,
  PostHocSetForm,
  POST_HOC_SET_WARNING,
  buildPostHocSetPayload,
} from "../AddSetAfterCompletion";
import type { MovementGroup } from "@/lib/sessions/movement-grouping";
import type { FocusLoggedSet } from "../MovementFocusView";
import type { PrescriptionItem } from "@hta/db";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function groupWith(kinds: string[]): MovementGroup {
  return {
    movementId: "m1",
    movementName: "Front Squat",
    items: kinds.map((kind) => ({
      kind,
      movementId: "m1",
      movementName: "Front Squat",
    })) as unknown as PrescriptionItem[],
  } as MovementGroup;
}

const group = groupWith(["warmup", "main"]);

function set(over: Partial<FocusLoggedSet> = {}): FocusLoggedSet {
  return {
    id: "set-a",
    weightKg: 85,
    reps: 5,
    distanceM: null,
    durationSec: null,
    rpe: 8,
    skipped: false,
    skipReason: null,
    ...over,
  };
}

const addStrengthSet = async () => ({ ok: true as const });

describe("CompletedSetsPanel — the finished-session movement body", () => {
  it("renders the add-a-set affordance on a completed session", () => {
    const html = renderToStaticMarkup(
      <CompletedSetsPanel
        group={group}
        loggedSets={[set()]}
        sessionId={SESSION_ID}
        addStrengthSet={addStrengthSet}
      />,
    );
    expect(html).toContain('data-testid="add-set-after-completion-m1"');
    expect(html).toContain('data-testid="add-set-after-completion-open-m1"');
    expect(html).toContain("Add a set");
  });

  it("keeps a per-set Edit link so a logged set can be corrected", () => {
    const html = renderToStaticMarkup(
      <CompletedSetsPanel
        group={group}
        loggedSets={[set({ id: "set-a" }), set({ id: "set-b" })]}
        sessionId={SESSION_ID}
        addStrengthSet={addStrengthSet}
      />,
    );
    expect(html).toContain(`href="/app/sessions/${SESSION_ID}/sets/set-a/edit"`);
    expect(html).toContain(`href="/app/sessions/${SESSION_ID}/sets/set-b/edit"`);
  });

  it("offers add-a-set even when the movement logged nothing at all", () => {
    // The "the app wouldn't let me log it" case in its purest form.
    const html = renderToStaticMarkup(
      <CompletedSetsPanel
        group={group}
        loggedSets={[]}
        sessionId={SESSION_ID}
        addStrengthSet={addStrengthSet}
      />,
    );
    expect(html).toContain('data-testid="movement-card-readonly-empty-m1"');
    expect(html).toContain('data-testid="add-set-after-completion-open-m1"');
  });
});

describe("defaultPostHocSetKind", () => {
  // Set kind is not cosmetic: only `main`/`back_off` rows feed PR detection and
  // training-max recalibration (lib/stats/pr-recalibrate.ts), so a post-hoc set
  // must default to what the movement was actually programmed as.
  it("uses the last prescribed non-warm-up slot", () => {
    expect(defaultPostHocSetKind(groupWith(["warmup", "main", "back_off"]))).toBe(
      "back_off",
    );
    expect(defaultPostHocSetKind(groupWith(["warmup", "accessory"]))).toBe(
      "accessory",
    );
  });

  it("maps prescription-only kinds onto their logged kind", () => {
    expect(defaultPostHocSetKind(groupWith(["power_potentiation"]))).toBe("main");
  });

  it("falls back to main for a warm-up-only or empty group", () => {
    expect(defaultPostHocSetKind(groupWith(["warmup"]))).toBe("main");
    expect(defaultPostHocSetKind(groupWith([]))).toBe("main");
  });
});

describe("AddSetAfterCompletion — read-only stays the DEFAULT posture", () => {
  it("renders a closed disclosure, not an open form", () => {
    // Reviewing a finished session must not look like editing it.
    const html = renderToStaticMarkup(
      <AddSetAfterCompletion
        sessionId={SESSION_ID}
        movementId="m1"
        movementName="Front Squat"
        addStrengthSet={addStrengthSet}
      />,
    );
    expect(html).toContain('data-testid="add-set-after-completion-open-m1"');
    expect(html).not.toContain('data-testid="add-set-after-completion-form-m1"');
    expect(html).not.toContain('data-testid="add-set-after-completion-reps-m1"');
    expect(html).not.toContain('data-testid="add-set-after-completion-save-m1"');
  });
});

describe("PostHocSetForm — DC-K4 override-and-warn, never a hard block", () => {
  function renderForm(defaultSetKind?: "main" | "back_off" | "accessory") {
    return renderToStaticMarkup(
      <PostHocSetForm
        sessionId={SESSION_ID}
        movementId="m1"
        movementName="Front Squat"
        addStrengthSet={addStrengthSet}
        defaultSetKind={defaultSetKind}
        onClose={() => {}}
      />,
    );
  }

  it("warns that history is being amended instead of refusing the edit", () => {
    // DC-K4: hard blocks are reserved for safety gates (tendon refractory,
    // active-limitation, RLS). Amending your own log is not one of them.
    const html = renderForm();
    expect(html).toContain('data-testid="add-set-after-completion-warning-m1"');
    expect(html).toContain(POST_HOC_SET_WARNING);
    expect(html).toContain('data-testid="add-set-after-completion-save-m1"');
  });

  it("states that the session stays complete", () => {
    // Product call: a post-hoc set is a record correction, not a resumed
    // workout — `completed_at` is never cleared.
    expect(renderForm()).toContain("the session stays complete");
  });

  it("pre-selects the movement's programmed set kind", () => {
    expect(renderForm("back_off")).toContain('value="back_off" selected=""');
  });

  it("exposes weight, reps and RPE fields", () => {
    const html = renderForm();
    expect(html).toContain('data-testid="add-set-after-completion-weight-m1"');
    expect(html).toContain('data-testid="add-set-after-completion-reps-m1"');
    expect(html).toContain('data-testid="add-set-after-completion-rpe-m1"');
  });
});

describe("buildPostHocSetPayload — attribution contract", () => {
  const base = {
    sessionId: SESSION_ID,
    movementId: "m1",
    setKind: "main" as const,
    weight: "100",
    reps: "5",
    rpe: "",
    units: "metric" as const,
  };

  it("NEVER sends a prescriptionItemIndex", () => {
    // A post-hoc set has no prescribed slot. NULL is the one value that cannot
    // collide with, or shift, an existing `set_logs.prescription_item_index` —
    // re-indexing logged rows is a known mis-attribution hazard
    // (lib/sessions/movement-attribution.ts).
    const built = buildPostHocSetPayload(base);
    expect("fd" in built).toBe(true);
    if (!("fd" in built)) return;
    expect(built.fd.get("prescriptionItemIndex")).toBeNull();
    expect(built.fd.get("sessionId")).toBe(SESSION_ID);
    expect(built.fd.get("movementId")).toBe("m1");
    expect(built.fd.get("setKind")).toBe("main");
    expect(built.fd.get("reps")).toBe("5");
    expect(built.fd.get("weightKg")).toBe("100");
  });

  it("never marks the set skipped, so it counts as real work", () => {
    const built = buildPostHocSetPayload(base);
    if (!("fd" in built)) throw new Error("expected a payload");
    expect(built.fd.get("skipped")).toBeNull();
    expect(built.fd.get("skipReason")).toBeNull();
  });

  it("converts an imperial entry to kg for storage", () => {
    // `toKg` snaps to the nearest 0.5 kg — 225 lb ≈ 102.06 kg → 102.
    const built = buildPostHocSetPayload({
      ...base,
      weight: "225",
      units: "imperial",
    });
    if (!("fd" in built)) throw new Error("expected a payload");
    expect(Number(built.fd.get("weightKg"))).toBe(102);
  });

  it("treats a blank weight as bodyweight rather than rejecting it", () => {
    const built = buildPostHocSetPayload({ ...base, weight: "" });
    if (!("fd" in built)) throw new Error("expected a payload");
    expect(built.fd.get("weightKg")).toBe("0");
  });

  it("omits RPE when left blank and forwards it when given", () => {
    const blank = buildPostHocSetPayload(base);
    if (!("fd" in blank)) throw new Error("expected a payload");
    expect(blank.fd.get("rpe")).toBeNull();

    const withRpe = buildPostHocSetPayload({ ...base, rpe: "8.5" });
    if (!("fd" in withRpe)) throw new Error("expected a payload");
    expect(withRpe.fd.get("rpe")).toBe("8.5");
  });

  it("rejects a set with no reps", () => {
    expect(buildPostHocSetPayload({ ...base, reps: "" })).toEqual({
      error: "Enter the reps you did.",
    });
    expect(buildPostHocSetPayload({ ...base, reps: "0" })).toEqual({
      error: "Enter the reps you did.",
    });
  });

  it("rejects an out-of-range RPE", () => {
    expect(buildPostHocSetPayload({ ...base, rpe: "12" })).toEqual({
      error: "RPE must be between 0 and 10.",
    });
  });
});
