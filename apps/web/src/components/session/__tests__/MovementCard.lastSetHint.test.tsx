/**
 * Render contract for the accessory "last time" hint row.
 *
 * The web test env is Node (no JSDOM), so we assert the static markup
 * via `renderToStaticMarkup` against the exported pure `LastSetHintRow`
 * helper. The live wiring (accessory-only gating, expanded-body
 * placement) is exercised end-to-end in the Playwright spec; here we
 * pin the presentational contract: weight × reps + relative date, and
 * a no-op render when there is no hint.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LastSetHintRow } from "../MovementCard";

describe("LastSetHintRow", () => {
  it("renders the prior-session weight, reps and movement label", () => {
    const html = renderToStaticMarkup(
      <LastSetHintRow
        hint={{ weightKg: 22.5, reps: 12, performedAt: "2026-05-28T10:00:00Z" }}
        label="Dumbbell Curl"
      />,
    );
    expect(html).toContain('data-testid="last-time-hint"');
    expect(html).toContain("Last dumbbell curl:");
    expect(html).toContain("22.5 kg × 12");
  });

  it("renders nothing when there is no hint", () => {
    expect(renderToStaticMarkup(<LastSetHintRow hint={undefined} label="X" />)).toBe("");
    expect(renderToStaticMarkup(<LastSetHintRow hint={null} label="X" />)).toBe("");
  });
});
