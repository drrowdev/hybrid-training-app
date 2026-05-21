import { describe, it, expect } from "vitest";
import { ceilingBandFor } from "../ceiling-queries";

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
