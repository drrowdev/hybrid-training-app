import { describe, expect, it } from "vitest";
import { programSetupAuditInput } from "../setup-audit";

describe("programSetupAuditInput", () => {
  it("persists a later program start so phase labels can be rebased", () => {
    expect(
      programSetupAuditInput({
        values: { template: "activation" },
        weekdays: [0, 2, 4],
        startedOn: "2026-08-03",
        startWeekIndex: 5,
      }),
    ).toEqual({
      values: { template: "activation" },
      weekdays: [0, 2, 4],
      startedOn: "2026-08-03",
      startWeekIndex: 5,
    });
  });
  it("keeps beginning-start records byte-compatible", () => {
    expect(
      programSetupAuditInput({
        values: {},
        weekdays: [1, 3],
        startedOn: "2026-08-03",
        startWeekIndex: 0,
      }),
    ).toEqual({
      values: {},
      weekdays: [1, 3],
      startedOn: "2026-08-03",
    });
  });
});
