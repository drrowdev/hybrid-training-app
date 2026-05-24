/**
 * MatchUnfulfilledModal — header context test.
 *
 * Asserts the modal renders the planned session's title and a
 * human-formatted date so the user knows which past day they're
 * matching against.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MatchUnfulfilledModal } from "./MatchUnfulfilledModal";

describe("MatchUnfulfilledModal", () => {
  it("renders planned title + formatted date + summary when open", () => {
    const html = renderToStaticMarkup(
      <MatchUnfulfilledModal
        open
        onClose={() => {}}
        planned={{
          id: "p1",
          date: "2026-05-19",
          title: "Squat day",
          summary: "Top set 102 kg × 5 · 3 working sets",
        }}
        candidates={[]}
      />,
    );
    expect(html).toContain('data-testid="match-modal-planned-title"');
    expect(html).toContain("Squat day");
    expect(html).toContain('data-testid="match-modal-planned-date"');
    // toLocaleDateString("en-GB") → "Tue, 19 May" or "Tue 19 May" depending on platform;
    // assert the day + month are surfaced.
    expect(html).toMatch(/19/);
    expect(html).toMatch(/May/);
    expect(html).toContain('data-testid="match-modal-planned-summary"');
    expect(html).toContain("Top set 102 kg");
  });

  it("renders nothing when closed", () => {
    const html = renderToStaticMarkup(
      <MatchUnfulfilledModal
        open={false}
        onClose={() => {}}
        planned={{ id: "p1", date: "2026-05-19", title: "Squat day" }}
        candidates={[]}
      />,
    );
    expect(html).toBe("");
  });
});
