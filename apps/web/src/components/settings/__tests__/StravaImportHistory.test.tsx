/**
 * Coverage for the Strava history import summary view — verifies the
 * structured imported / matched / skipped breakdown the spec requires.
 * Same node/static-markup pattern as the other settings tests so we
 * don't pull in @testing-library/react.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportSummaryView } from "../StravaImportHistory";
import type { ImportSummary } from "@/lib/integrations/strava/import-history";

function makeSummary(over: Partial<ImportSummary> = {}): ImportSummary {
  return {
    imported: 0,
    skipped: { strength: 0, sport: 0, other: 0, duplicates: 0, unknown: 0 },
    matchedToPlanned: 0,
    errors: [],
    ...over,
  };
}

describe("ImportSummaryView", () => {
  it("renders imported count + matched count headline", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView
        summary={makeSummary({ imported: 42, matchedToPlanned: 18 })}
      />,
    );
    expect(html).toMatch(/Imported 42 activities/);
    expect(html).toMatch(/matched 18 to past plans/);
  });

  it("uses singular noun when imported === 1", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView summary={makeSummary({ imported: 1 })} />,
    );
    expect(html).toMatch(/Imported 1 activity/);
    expect(html).not.toMatch(/1 activities/);
  });

  it("breaks skip reasons into labeled buckets", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView
        summary={makeSummary({
          imported: 5,
          skipped: { strength: 10, sport: 2, other: 1, duplicates: 3, unknown: 0 },
        })}
      />,
    );
    expect(html).toMatch(/10 strength sessions/);
    expect(html).toMatch(/2 sports/);
    expect(html).toMatch(/3 duplicates/);
    expect(html).toMatch(/1 activities we don/);
  });

  it("hides the skip section entirely when nothing was skipped", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView summary={makeSummary({ imported: 3 })} />,
    );
    expect(html).not.toMatch(/Skipped:/);
  });

  it("renders the errors block when partial failures occurred", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView
        summary={makeSummary({
          imported: 1,
          errors: [{ activityId: 0, message: "Strava rate limit reached." }],
        })}
      />,
    );
    expect(html).toMatch(/1 error/);
    expect(html).toMatch(/Strava rate limit reached/);
  });

  it("omits the matched suffix when zero planned sessions were linked", () => {
    const html = renderToStaticMarkup(
      <ImportSummaryView
        summary={makeSummary({ imported: 5, matchedToPlanned: 0 })}
      />,
    );
    expect(html).not.toMatch(/matched 0/);
  });
});
