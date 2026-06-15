/**
 * HYROX engine — skeleton tests (ADR 0050 step 3): meta + describeSetup + setup.
 * Pure, no DB. timeline/prescribe are stubbed until steps 4–5.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import {
  hyroxEngine,
  WEEKS_BY_EXPERIENCE,
  DEFAULT_SESSIONS_BY_EXPERIENCE,
} from "./program";

const ctx: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };

function setup(values: Record<string, unknown> = {}) {
  return hyroxEngine.setup({ values }, ctx);
}

describe("HYROX engine — meta", () => {
  it("identifies as the HYROX family", () => {
    expect(hyroxEngine.meta.id).toBe("hyrox");
    expect(hyroxEngine.meta.family).toBe("hyrox");
    expect(hyroxEngine.meta.name).toBe("HYROX");
  });
});

describe("HYROX engine — describeSetup", () => {
  it("collects experience, division, and sessions/week", () => {
    const keys = hyroxEngine.describeSetup().fields.map((f) => f.key);
    expect(keys).toEqual(["experience", "division", "sessionsPerWeek"]);
  });

  it("offers the three divisions", () => {
    const division = hyroxEngine
      .describeSetup()
      .fields.find((f) => f.key === "division");
    expect(division?.options?.map((o) => o.value)).toEqual(["open", "pro", "doubles"]);
  });
});

describe("HYROX engine — setup", () => {
  it("derives block length from experience (10 / 12 / 16)", () => {
    expect(setup({ experience: "beginner" }).weeks).toBe(WEEKS_BY_EXPERIENCE.beginner);
    expect(setup({ experience: "intermediate" }).weeks).toBe(WEEKS_BY_EXPERIENCE.intermediate);
    expect(setup({ experience: "advanced" }).weeks).toBe(WEEKS_BY_EXPERIENCE.advanced);
  });

  it("defaults sessions/week by experience when unspecified", () => {
    expect(setup({ experience: "beginner" }).sessionsPerWeek).toBe(
      DEFAULT_SESSIONS_BY_EXPERIENCE.beginner,
    );
    expect(setup({ experience: "advanced" }).sessionsPerWeek).toBe(
      DEFAULT_SESSIONS_BY_EXPERIENCE.advanced,
    );
  });

  it("honours an explicit sessions/week, clamped to [3, 8]", () => {
    expect(setup({ sessionsPerWeek: "6" }).sessionsPerWeek).toBe(6);
    expect(setup({ sessionsPerWeek: 99 }).sessionsPerWeek).toBe(8);
    expect(setup({ sessionsPerWeek: 1 }).sessionsPerWeek).toBe(3);
  });

  it("defaults unknown experience/division to intermediate / open", () => {
    const inst = setup({ experience: "nonsense", division: "nonsense" });
    expect(inst.experience).toBe("intermediate");
    expect(inst.division).toBe("open");
    expect(inst.weeks).toBe(12);
  });

  it("accepts all three divisions", () => {
    expect(setup({ division: "pro" }).division).toBe("pro");
    expect(setup({ division: "doubles" }).division).toBe("doubles");
    expect(setup({ division: "open" }).division).toBe("open");
  });

  it("produces a JSON-round-trippable instance", () => {
    const inst = setup({ experience: "advanced", division: "pro", sessionsPerWeek: "7" });
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("HYROX engine — timeline/prescribe stubs (filled steps 4–5)", () => {
  it("timeline is empty in the step-3 skeleton", () => {
    expect(hyroxEngine.timeline(setup())).toEqual([]);
  });

  it("prescribe returns an empty session in the step-3 skeleton", () => {
    expect(hyroxEngine.prescribe(setup(), "anything", ctx)).toEqual({ items: [] });
  });
});
