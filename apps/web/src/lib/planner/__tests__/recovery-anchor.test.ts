import { describe, it, expect } from "vitest";
import { resolveBoundaryAnchor } from "../recovery-anchor";

describe("where a program-advised recovery week goes", () => {
  const refs = ["b0-w6-peak-squat", "b0-w6-peak-bench", "b0-w6-peak-deadlift"];

  it("anchors to the week the named sessions are actually in", () => {
    const anchor = resolveBoundaryAnchor(refs, [
      { weekIndex: 4, programRef: "b0-w5-s1" },
      { weekIndex: 5, programRef: "b0-w6-peak-squat" },
      { weekIndex: 5, programRef: "b0-w6-peak-bench" },
      { weekIndex: 5, programRef: "b0-w6-peak-deadlift" },
    ]);
    expect(anchor).toEqual({ afterWeek: 5, contiguous: true });
  });

  it("reads the live plan, so an earlier inserted week has already moved it", () => {
    // A recovery week taken at week 3 pushed the peak week from 5 to 6.
    const anchor = resolveBoundaryAnchor(refs, [
      { weekIndex: 6, programRef: "b0-w6-peak-squat" },
      { weekIndex: 6, programRef: "b0-w6-peak-bench" },
      { weekIndex: 6, programRef: "b0-w6-peak-deadlift" },
    ]);
    expect(anchor?.afterWeek).toBe(6);
  });

  it("ignores sessions the boundary didn't name", () => {
    const anchor = resolveBoundaryAnchor(refs, [
      { weekIndex: 5, programRef: "b0-w6-peak-squat" },
      { weekIndex: 11, programRef: "b1-w6-peak-squat" },
    ]);
    expect(anchor?.afterWeek).toBe(5);
  });

  it("gives up rather than guessing when the plan no longer has those sessions", () => {
    expect(
      resolveBoundaryAnchor(refs, [{ weekIndex: 2, programRef: "b0-w3-s1" }]),
    ).toBeNull();
    expect(resolveBoundaryAnchor(refs, [])).toBeNull();
  });

  it("takes the last of a split boundary and says it was split", () => {
    const anchor = resolveBoundaryAnchor(refs, [
      { weekIndex: 5, programRef: "b0-w6-peak-squat" },
      { weekIndex: 6, programRef: "b0-w6-peak-deadlift" },
    ]);
    expect(anchor).toEqual({ afterWeek: 6, contiguous: false });
  });
});
