/**
 * LogNowDateForm — date-picker modal for the overdue "Log now" CTA.
 *
 * The repo intentionally avoids @testing-library/react (see notes on
 * `CardioPrescriptionList.test.tsx`), so we drive these tests via
 * server-rendered markup + source inspection. The interactive flow
 * (open → pick date → submit) is exercised end-to-end by the
 * server-action tests in `start-session-direct.test.ts`; here we
 * just verify the rendered surface contract that PR #173's
 * "one-tap on today/future, picker on overdue" rule depends on.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LogNowDateForm } from "./LogNowDateForm";

describe("LogNowDateForm — closed state (default)", () => {
  it("renders the one-tap 'Log now' button with the overdue testid", () => {
    const html = renderToStaticMarkup(
      <LogNowDateForm
        plannedId="p-1"
        title="Upper push"
        defaultDateYmd="2026-05-18"
        maxDateYmd="2026-05-23"
        action={async () => {}}
      />,
    );
    expect(html).toContain('data-testid="overdue-log-p-1"');
    expect(html).toContain("Log now");
    // Default state must NOT include the date input — the input
    // surfaces only after the user clicks the button.
    expect(html).not.toContain('data-testid="log-now-date-input-p-1"');
    expect(html).not.toContain('data-testid="log-now-confirm-p-1"');
  });
});

describe("LogNowDateForm — source contract", () => {
  // We can't simulate React state transitions without a DOM testing
  // library, so pin the testids + pre-fill behaviour at the source
  // level. If anyone renames a testid or drops the `value=` binding,
  // these break loudly.
  it("source defines the picker testids and binds the picker default to defaultDateYmd", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const here = path.dirname(
      new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, ""),
    );
    const src = await fs.readFile(
      path.join(here, "LogNowDateForm.tsx"),
      "utf8",
    );
    expect(src).toContain("data-testid={`log-now-date-input-${plannedId}`}");
    expect(src).toContain("data-testid={`log-now-confirm-${plannedId}`}");
    expect(src).toContain("data-testid={`log-now-cancel-${plannedId}`}");
    // The picker's value tracks the local `date` state, which is
    // seeded from `defaultDateYmd`. The `max` attribute is
    // `maxDateYmd` (today in user tz) so the browser blocks
    // future-date selection client-side, complementing the server
    // validation in `startSessionDirect`.
    expect(src).toContain("useState(defaultDateYmd)");
    expect(src).toContain("max={maxDateYmd}");
    // Confirm posts FormData with both `id` and `performedAt`.
    expect(src).toMatch(/fd\.set\("id", plannedId\)/);
    expect(src).toContain('fd.set("performedAt", date)');
  });
});
