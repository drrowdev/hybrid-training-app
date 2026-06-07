import { describe, it, expect } from "vitest";
import { starterChipsForPath } from "../starter-chips";

describe("starterChipsForPath", () => {
  it("returns stats prompts on the stats page", () => {
    const c = starterChipsForPath("/app/stats");
    expect(c.heading.toLowerCase()).toContain("stats");
    expect(c.prompts.length).toBeGreaterThanOrEqual(2);
    expect(c.prompts.join(" ").toLowerCase()).toContain("squat");
  });

  it("returns plan prompts on the plan page", () => {
    const c = starterChipsForPath("/app/plan");
    expect(c.heading.toLowerCase()).toContain("plan");
    expect(c.prompts.join(" ").toLowerCase()).toContain("week");
  });

  it("returns session prompts on a session page", () => {
    const c = starterChipsForPath("/app/sessions/abc-123");
    expect(c.prompts.join(" ").toLowerCase()).toContain("workout");
  });

  it("returns today prompts on the dashboard", () => {
    const c = starterChipsForPath("/app");
    expect(c.heading.toLowerCase()).toContain("today");
  });

  it("falls back to a general set for unknown pages and null", () => {
    expect(starterChipsForPath("/app/something-else").prompts.length).toBeGreaterThan(0);
    expect(starterChipsForPath(null).prompts.length).toBeGreaterThan(0);
  });
});
