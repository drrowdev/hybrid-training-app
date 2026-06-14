import { describe, it, expect } from "vitest";
import { ceilingBandFor, tallyPlannedWeek } from "../ceiling-queries";
import type { Prescription } from "@hta/db";

function presc(items: Prescription["items"]): Prescription {
  return { items } as Prescription;
}

describe("ceilingBandFor", () => {
  it("<70% -> under-loading", () => {
    expect(ceilingBandFor(0.5).band).toBe("under");
    expect(ceilingBandFor(0.69).band).toBe("under");
  });

  it("70-90% -> on-budget", () => {
    expect(ceilingBandFor(0.7).band).toBe("on-budget");
    expect(ceilingBandFor(0.85).band).toBe("on-budget");
  });

  it("90-110% -> at-line", () => {
    expect(ceilingBandFor(0.9).band).toBe("at-line");
    expect(ceilingBandFor(1.05).band).toBe("at-line");
  });

  it("110-130% -> over budget", () => {
    expect(ceilingBandFor(1.1).band).toBe("over");
    expect(ceilingBandFor(1.25).band).toBe("over");
  });

  it(">=130% -> way over", () => {
    expect(ceilingBandFor(1.3).band).toBe("way-over");
    expect(ceilingBandFor(2.0).band).toBe("way-over");
  });

  it("0% -> under (cold start with no logged sets)", () => {
    expect(ceilingBandFor(0).band).toBe("under");
  });

  it("labels are plain-language (no jargon)", () => {
    expect(ceilingBandFor(0.6).label).toBe("Under-loading");
    expect(ceilingBandFor(1.0).label).toBe("At the line");
    expect(ceilingBandFor(2.0).label).toBe("Way over");
  });
});

describe("tallyPlannedWeek (platform prescribed-volume source)", () => {
  it("sums working sets across strength items, excluding warmups", () => {
    const out = tallyPlannedWeek([
      {
        prescription: presc([
          { movementId: "m1", kind: "warmup", sets: 2 },
          { movementId: "m1", kind: "main", sets: 3 },
          { movementId: "m2", kind: "accessory", sets: 3 },
          { movementId: "m3", kind: "back_off", sets: 1 },
        ]),
      },
    ]);
    // 3 + 3 + 1 = 7 working sets; warmup excluded.
    expect(out.counts.strengthSets).toBe(7);
    expect(out.counts.cardioSessions).toBe(0);
  });

  it("defaults missing `sets` to 1 (planner repeats items per wave)", () => {
    const out = tallyPlannedWeek([
      {
        prescription: presc([
          { movementId: "m1", kind: "main" },
          { movementId: "m1", kind: "main" },
          { movementId: "m2", kind: "accessory" },
        ]),
      },
    ]);
    expect(out.counts.strengthSets).toBe(3);
  });

  it("counts a session with any cardio item as one cardio session", () => {
    const out = tallyPlannedWeek([
      { prescription: presc([{ movementId: "c1", kind: "cardio_z2" }]) },
      { prescription: presc([{ movementId: "c2", kind: "cardio_vo2" }]) },
      { prescription: presc([{ movementId: "m1", kind: "main", sets: 5 }]) },
    ]);
    expect(out.counts.cardioSessions).toBe(2);
    expect(out.counts.strengthSets).toBe(5);
  });

  it("flags the week as deload when any session has role='deload'", () => {
    const out = tallyPlannedWeek([
      { prescription: presc([{ movementId: "m1", kind: "main", sets: 3 }]), role: "strength" },
      { prescription: presc([{ movementId: "m2", kind: "main", sets: 3 }]), role: "deload" },
    ]);
    expect(out.isDeload).toBe(true);
  });

  it("handles null prescription / empty rows safely", () => {
    expect(tallyPlannedWeek([]).counts).toEqual({ strengthSets: 0, cardioSessions: 0 });
    expect(
      tallyPlannedWeek([{ prescription: null }]).counts,
    ).toEqual({ strengthSets: 0, cardioSessions: 0 });
  });
});
