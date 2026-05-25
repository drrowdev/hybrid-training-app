/**
 * DateTimeFormatCard — auto-preview wiring.
 *
 * The interactive preview update is driven by `useEffect` reading
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, which doesn't
 * run under the node-only static-markup pattern this project uses.
 * The bug-fix this test covers is structural, not visual:
 *
 *   1. The form renders a hidden `detectedTimezone` input so the
 *      server action can persist the browser-detected zone on save
 *      (the timezone-fallback half of the fix).
 *   2. The underlying `resolveTimeFormat` / `resolveDateFormat`
 *      helpers — which the auto-preview path calls with
 *      `{timezone: clientTimezone}` — return the right format ids
 *      for a Helsinki client even when the persisted profile zone
 *      is null. That's the swap that makes the preview match
 *      reality without a save.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DateTimeFormatCard } from "../DateTimeFormatCard";
import {
  resolveDateFormat,
  resolveTimeFormat,
} from "@/lib/format/datetime";

describe("DateTimeFormatCard — auto preview wiring", () => {
  it("renders the hidden detectedTimezone input so the server action gets the browser zone", () => {
    const html = renderToStaticMarkup(
      <DateTimeFormatCard
        initialTimeFormat={null}
        initialDateFormat={null}
        // Server-resolved fallback when the user has no profile timezone:
        // both default to the "anywhere else" branch (24h + iso).
        resolvedTimeFormat="24h"
        resolvedDateFormat="iso"
      />,
    );
    // Hidden field present so save flows can backfill `profiles.timezone`.
    expect(html).toContain('name="detectedTimezone"');
    expect(html).toContain('data-testid="settings-datetime-detected-timezone"');
    // The auto preview falls back to the server-resolved values when
    // useEffect hasn't run (e.g. in this SSR markup). 24h + ISO are the
    // anywhere-else defaults.
    expect(html).toContain("17:30"); // 24h example
    expect(html).toContain("2026-05-24"); // iso example
    // Copy update: mentions the browser-detected fallback.
    expect(html).toContain("browser");
  });

  it("auto preview helpers pick Helsinki defaults when only the timezone is known", () => {
    // Mirrors the live-preview useMemo: feed only `{timezone}` (no
    // explicit time_format / date_format) and expect the European
    // branch — 24h + DD/MM/YYYY — exactly what a Helsinki user expects
    // before they've ever clicked Save.
    expect(resolveTimeFormat({ timezone: "Europe/Helsinki" })).toBe("24h");
    expect(resolveDateFormat({ timezone: "Europe/Helsinki" })).toBe("dmy_short");
  });

  it("auto preview helpers pick US defaults for an America/* timezone", () => {
    expect(resolveTimeFormat({ timezone: "America/New_York" })).toBe("12h");
    expect(resolveDateFormat({ timezone: "America/New_York" })).toBe("mdy_short");
  });

  it("auto preview helpers fall back to 24h + dmy_short for an unrecognised region", () => {
    expect(resolveTimeFormat({ timezone: null })).toBe("24h");
    expect(resolveDateFormat({ timezone: null })).toBe("dmy_short");
  });
});
