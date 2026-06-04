import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QuickWorkoutCard } from "../QuickWorkoutCard";

const noopStrength = async () => {};
const noopRepeat = async () => {};

describe("QuickWorkoutCard", () => {
  it("renders the planned-day subtitle when variant is 'planned'", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutCard
        variant="planned"
        recent={[]}
        startStrength={noopStrength}
        repeatRecent={noopRepeat}
      />,
    );
    expect(html).toContain('data-testid="quick-workout-card"');
    expect(html).toContain('data-variant="planned"');
    expect(html).toContain("Start something off-plan");
    expect(html).not.toContain("Got energy?");
    expect(html).toContain("Quick workout");
  });

  it("renders the rest-day subtitle when variant is 'rest'", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutCard
        variant="rest"
        recent={[]}
        startStrength={noopStrength}
        repeatRecent={noopRepeat}
      />,
    );
    expect(html).toContain('data-variant="rest"');
    expect(html).toContain("Got energy? Start something light");
    expect(html).not.toContain("off-plan");
  });

  it("renders the card as a button so the full surface is the tap target", () => {
    const html = renderToStaticMarkup(
      <QuickWorkoutCard
        variant="planned"
        recent={[]}
        startStrength={noopStrength}
        repeatRecent={noopRepeat}
      />,
    );
    expect(html).toMatch(/<button[^>]+data-testid="quick-workout-card"/);
  });
});

