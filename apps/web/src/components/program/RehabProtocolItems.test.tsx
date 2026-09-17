import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RehabProtocolItems } from "./RehabProtocolItems";

describe("rehab exercises in a program session card", () => {
  it("keeps separate sides and combined rep/hold targets without adding editing controls", () => {
    const html = renderToStaticMarkup(<RehabProtocolItems items={[
      { movementId: "a", movementName: "Copenhagen Plank", sets: 3, reps: 8, holdSeconds: 5, side: "left", targetWeightKg: 0 },
      { movementId: "a", movementName: "Copenhagen Plank", sets: 3, holdSeconds: 20, side: "right" },
    ]} />);
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).toContain("3 × 8 + 5s hold · 0 kg · Left");
    expect(html).toContain("3 × 20s hold · Right");
    expect(html).not.toMatch(/<button|<input|<select/);
  });

  it("preserves and escapes the user's exercise names and instructions", () => {
    const html = renderToStaticMarkup(<RehabProtocolItems items={[
      { movementId: "a", movementName: "Raise <slowly>", sets: 2, reps: 12, instructions: "Hold & lower\nKeep control" },
    ]} />);
    expect(html).toContain("Raise &lt;slowly&gt;");
    expect(html).toContain("Hold &amp; lower\nKeep control");
    expect(html).toContain("2 × 12");
    expect(html).not.toContain("kg");
    expect(html).not.toContain("Both sides");
  });
});
