/**
 * Static-render coverage for the three Strava connect/import states.
 *
 * Vitest runs in node — we render with `react-dom/server`'s
 * `renderToStaticMarkup` and assert on coarse structural markers
 * (test IDs, copy fragments, the form's hidden returnTo input).
 * Matches the pattern used by `bw-assessment/__tests__/pages.test.tsx`
 * and the other onboarding tests, so we don't pull in
 * @testing-library/react.
 *
 * The "import done" path can be tested as a pure render by mounting
 * `ImportSummaryView` directly — that component is exported from the
 * settings module and the connect step delegates to it verbatim, so
 * we cover it indirectly here and explicitly in
 * `settings/__tests__/StravaImportHistory.test.tsx`.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StravaConnectStep } from "../StravaConnectStep";

const noopConnect = async () => undefined;
const noopImport = async () => ({
  ok: true as const,
  summary: {
    imported: 0,
    skipped: { strength: 0, sport: 0, other: 0, duplicates: 0, unknown: 0 },
    matchedToPlanned: 0,
    errors: [],
  },
});

describe("StravaConnectStep — not connected", () => {
  it("renders the connect CTA + a skip hint", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={false}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={true}
        kicker="Step 6"
      />,
    );
    expect(html).toContain('data-state="not-connected"');
    expect(html).toContain('data-testid="onboarding-strava-connect-button"');
    expect(html).toContain('data-testid="onboarding-strava-skip-hint"');
    expect(html).toMatch(/Connect Strava/);
    expect(html).toMatch(/optional/i);
  });

  it("submits returnTo=onboarding so the OAuth callback can resume here", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={false}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={true}
        kicker="Step 6"
      />,
    );
    expect(html).toMatch(
      /<input[^>]*type="hidden"[^>]*name="returnTo"[^>]*value="onboarding"/,
    );
  });

  it("disables the connect button when env vars are missing", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={false}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={false}
        kicker="Step 6"
      />,
    );
    expect(html).toContain('data-testid="onboarding-strava-not-configured"');
    // React renders `disabled={true}` as a bare attribute on the
    // button; assert both attributes appear on the same `<button>` tag.
    expect(html).toMatch(
      /<button[^>]*disabled[^>]*data-testid="onboarding-strava-connect-button"|<button[^>]*data-testid="onboarding-strava-connect-button"[^>]*disabled/,
    );
  });

  it("contains no external programme names (brand purity)", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={false}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={true}
        kicker="Step 6"
      />,
    );
    expect(html.toLowerCase()).not.toMatch(
      /wendler|smolov|531|stronglifts|gzcl|gvt/,
    );
  });
});

describe("StravaConnectStep — connected, import idle", () => {
  it("renders the 90-day import prompt and skip-import affordance", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={true}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={true}
        kicker="Step 6"
      />,
    );
    expect(html).toContain('data-state="connected"');
    expect(html).toContain('data-testid="onboarding-strava-import-button"');
    expect(html).toContain('data-testid="onboarding-strava-skip-import-button"');
    expect(html).toMatch(/past 90 days/i);
    // Should NOT render the not-connected connect CTA in this state.
    expect(html).not.toContain('data-testid="onboarding-strava-connect-button"');
  });

  it("uses the shared kicker label so wizard numbering stays consistent", () => {
    const html = renderToStaticMarkup(
      <StravaConnectStep
        connected={true}
        connectAction={noopConnect}
        importAction={noopImport}
        isConfigured={true}
        kicker="Step 6"
      />,
    );
    expect(html).toContain("Step 6");
  });
});
