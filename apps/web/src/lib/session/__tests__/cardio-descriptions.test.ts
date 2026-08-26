import { describe, it, expect } from "vitest";
import {
  CARDIO_DESCRIPTIONS,
  EXTERNAL_CARDIO_DISPLAY_NOTE,
  GENERIC_CARDIO_DESCRIPTION,
  cardioDisplayName,
  cardioProtocolNote,
  describeCardioKind,
} from "../cardio-descriptions";

describe("CARDIO_DESCRIPTIONS lookup", () => {
  it("covers each engine cardio_ kind the planner can emit", () => {
    const expected = [
      "cardio_vo2",
      "cardio_z2",
      "cardio_threshold",
      "cardio_alactic",
    ] as const;
    for (const k of expected) {
      const text = CARDIO_DESCRIPTIONS[k];
      expect(text, `missing description for ${k}`).toBeTypeOf("string");
      expect(text.length, `description for ${k} is too short`).toBeGreaterThan(
        40,
      );
    }
  });

  it("says nothing about external cardio, which the app does not prescribe", () => {
    // This kind used to be in the map above, so the length floor forced a
    // sentence to exist — and the one that grew there described what the app
    // did with the result rather than what the lifter should do.
    expect(describeCardioKind("cardio_external")).toBeNull();
    expect(CARDIO_DESCRIPTIONS).not.toHaveProperty("cardio_external");
  });

  it("descriptions never start with the bare engine kind code", () => {
    for (const [kind, text] of Object.entries(CARDIO_DESCRIPTIONS)) {
      expect(text.startsWith(kind)).toBe(false);
    }
  });

  describe("describeCardioKind", () => {
    it("resolves each known kind to its mapped description", () => {
      expect(describeCardioKind("cardio_vo2")).toMatch(/90.95%/);
      expect(describeCardioKind("cardio_z2")).toMatch(/conversation/i);
      expect(describeCardioKind("cardio_alactic")).toMatch(/sprint|sharp/i);
    });

    it("falls back to a generic description for unknown / nullish kinds", () => {
      expect(describeCardioKind(undefined)).toBe(GENERIC_CARDIO_DESCRIPTION);
      expect(describeCardioKind(null)).toBe(GENERIC_CARDIO_DESCRIPTION);
      expect(describeCardioKind("warmup")).toBe(GENERIC_CARDIO_DESCRIPTION);
    });
  });
});

describe("cardioProtocolNote", () => {
  const note = (protocolNote?: string) => cardioProtocolNote({ protocolNote });

  it("drops the placeholder prose earlier builds stored", () => {
    // Three surfaces used to each hand-roll this check and each knew about a
    // different subset, so one of these always leaked somewhere.
    expect(note(EXTERNAL_CARDIO_DISPLAY_NOTE)).toBeNull();
    expect(
      note(
        "Open conditioning — log any run, row, ride or other cardio. Log it here, or link an activity you already recorded externally.",
      ),
    ).toBeNull();
    expect(
      note("Open cardio — log any run, row, ride or other cardio. Log it here."),
    ).toBeNull();
    expect(note("Logged via Runna.")).toBeNull();
    expect(note("Logged via your external program.")).toBeNull();
  });

  it("keeps a real protocol", () => {
    expect(note("4 × 4 min @ 90–95% HRmax, 3 min easy recovery")).toBe(
      "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
    );
  });

  it("treats empty and whitespace as no note", () => {
    expect(note(undefined)).toBeNull();
    expect(note("   ")).toBeNull();
  });
});

describe("cardioDisplayName", () => {
  it("prefers the movement name", () => {
    expect(
      cardioDisplayName({
        kind: "cardio_vo2",
        movementName: "VO2 intervals",
        intensityLabel: "hard",
      }),
    ).toBe("VO2 intervals");
  });

  it("names an unnamed external day by its label", () => {
    // An open TB conditioning day carries no movement, so the card used to
    // fall back to the literal "Cardio" under a "Conditioning" title.
    expect(
      cardioDisplayName({ kind: "cardio_external", intensityLabel: "Conditioning" }),
    ).toBe("Conditioning");
    expect(cardioDisplayName({ kind: "cardio_external", intensityLabel: "Runna" })).toBe(
      "Runna",
    );
  });

  it("never promotes an intensity label to a name on prescribed cardio", () => {
    // intensityLabel holds an intensity there, not a title.
    expect(cardioDisplayName({ kind: "cardio_z2", intensityLabel: "≤ 70% HRR" })).toBe(
      "Cardio",
    );
  });
});
