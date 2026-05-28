/**
 * ActiveLimitationsCard — persistent Today-page banner.
 *
 * Mirrors the testing approach used by OverdueNotice.test.tsx
 * (renderToStaticMarkup, no DOM environment required) so the suite
 * stays a pure node run.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActiveLimitationsCard,
  type ActiveLimitationSummary,
} from "./ActiveLimitationsCard";

const sample = (over: Partial<ActiveLimitationSummary> = {}): ActiveLimitationSummary => ({
  id: over.id ?? "lim-1",
  kind: over.kind ?? "knee",
  severity: over.severity ?? "moderate",
  startedAt:
    over.startedAt ?? new Date(Date.now() - 3 * 86_400_000).toISOString(),
});

describe("ActiveLimitationsCard", () => {
  it("renders nothing when there are no active limitations", () => {
    const html = renderToStaticMarkup(
      <ActiveLimitationsCard limitations={[]} />,
    );
    expect(html).toBe("");
  });

  it("renders the kind, severity, and a Manage → link", () => {
    const html = renderToStaticMarkup(
      <ActiveLimitationsCard limitations={[sample({ kind: "knee" })]} />,
    );
    expect(html).toContain('data-testid="active-limitations-card"');
    expect(html).toContain("knee");
    expect(html).toContain("moderate");
    expect(html).toContain('href="/app/recovery/injuries"');
  });

  it("caps to 3 rows and surfaces a +N more line beyond that", () => {
    const limitations: ActiveLimitationSummary[] = Array.from(
      { length: 5 },
      (_, i) => sample({ id: `id-${i}`, kind: `k${i}` }),
    );
    const html = renderToStaticMarkup(
      <ActiveLimitationsCard limitations={limitations} />,
    );
    const rowMatches = html.match(/data-testid="active-limitations-row"/g) ?? [];
    expect(rowMatches.length).toBe(3);
    expect(html).toContain("active-limitations-more");
    expect(html).toMatch(/\+ 2 more/);
  });

  it("uses singular wording for a single limitation", () => {
    const html = renderToStaticMarkup(
      <ActiveLimitationsCard limitations={[sample()]} />,
    );
    expect(html).toContain("Active limitation:");
    expect(html).not.toContain("Active limitations:");
  });

  it("uses plural wording for multiple limitations", () => {
    const html = renderToStaticMarkup(
      <ActiveLimitationsCard
        limitations={[
          sample({ id: "a", kind: "knee" }),
          sample({ id: "b", kind: "shoulder" }),
        ]}
      />,
    );
    expect(html).toContain("Active limitations:");
  });
});
