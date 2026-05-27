import { describe, it, expect } from "vitest";
import {
  ENDURANCE_ANCHOR,
  buildPrescription,
  type DayTemplate,
} from "../archetypes";

/**
 * Coverage for the cardio path of `buildPrescription`. Pinned because
 * the session-page UI relies on these items existing — when the
 * prescription has no `cardio_*` items, the cardio section renders
 * empty and the user sees a planned-cardio day as a blank session
 * card. See `apps/web/src/app/app/sessions/[id]/page.tsx`.
 */
const FAKE_PRIMARY = { id: "p-id", slug: "p-slug", displayName: "Primary Cardio" };
const FAKE_FINISHER = { id: "f-id", slug: "f-slug", displayName: "Sprint Finisher" };

describe("buildPrescription — cardio days", () => {
  it("emits a single cardio_z2 item with non-zero duration for a simple Z2 day", () => {
    const longZ2 = ENDURANCE_ANCHOR.days.find(
      (d) => d.kind === "cardio" && d.role === "long_z2",
    );
    expect(longZ2).toBeTruthy();
    const items = buildPrescription(ENDURANCE_ANCHOR, 0, longZ2 as DayTemplate, FAKE_PRIMARY);
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("cardio_z2");
    expect(items[0]!.durationMin).toBeGreaterThan(0);
    expect(items[0]!.movementId).toBe("p-id");
  });

  it("emits a cardio_vo2 item with structure for a VO2-intervals day", () => {
    const vo2 = ENDURANCE_ANCHOR.days.find(
      (d) => d.kind === "cardio" && d.role === "vo2_intervals",
    );
    expect(vo2).toBeTruthy();
    const items = buildPrescription(ENDURANCE_ANCHOR, 0, vo2 as DayTemplate, FAKE_PRIMARY);
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("cardio_vo2");
    expect(items[0]!.durationMin).toBeGreaterThan(0);
    // VO2 days must carry the protocol structure so the user knows what
    // 4×4 / 3-min recovery to do — the UI surfaces this verbatim.
    expect(items[0]!.protocolNote ?? "").toMatch(/\d/);
  });

  it("emits BOTH a cardio_z2 base AND a cardio_alactic finisher on a z2_plus_alactic day", () => {
    const z2Plus = ENDURANCE_ANCHOR.days.find(
      (d) => d.kind === "cardio" && d.role === "z2_plus_alactic",
    );
    expect(z2Plus).toBeTruthy();
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      0,
      z2Plus as DayTemplate,
      FAKE_PRIMARY,
      FAKE_FINISHER,
    );
    expect(items.length).toBe(2);
    expect(items[0]!.kind).toBe("cardio_z2");
    expect(items[0]!.durationMin).toBeGreaterThan(0);
    expect(items[1]!.kind).toBe("cardio_alactic");
    expect(items[1]!.durationMin).toBeGreaterThan(0);
    expect(items[1]!.movementId).toBe("f-id");
    // The finisher description must carry the rep/effort structure so
    // the session page renders a real prescription, not an empty card.
    expect(items[1]!.protocolNote ?? "").toMatch(/\d/);
  });

  it("falls back to base-only when a z2_plus_alactic day has no finisher movement", () => {
    const z2Plus = ENDURANCE_ANCHOR.days.find(
      (d) => d.kind === "cardio" && d.role === "z2_plus_alactic",
    );
    const items = buildPrescription(
      ENDURANCE_ANCHOR,
      0,
      z2Plus as DayTemplate,
      FAKE_PRIMARY,
      undefined,
    );
    // No finisher movement resolved → emit the base Z2 item only.
    // The base item MUST still be there — silent drop would re-create
    // the original "empty cardio day" bug.
    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe("cardio_z2");
  });
});
