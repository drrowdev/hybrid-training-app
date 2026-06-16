/**
 * Settings hub structural contract.
 *
 * Asserts at source-text level that the top-level Settings page mounts
 * the new Integrations tile and no longer mounts the old top-level AI
 * tile (Strava lives under the Integrations sub-hub, never had its own
 * top-level tile). The Integrations sub-hub at
 * /app/settings/integrations is exercised separately in its own
 * `__tests__/page.test.tsx`.
 *
 * A full render of `SettingsPage` would require mocking six Supabase
 * queries plus auth; the structural assertion here is enough to catch
 * accidental regression of the tile reshuffle.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const SETTINGS_PAGE = path.resolve(
  __dirname,
  "..",
  "page.tsx",
);

describe("settings hub — tile contract", () => {
  const source = readFileSync(SETTINGS_PAGE, "utf8");

  it("mounts the new Integrations hub tile", () => {
    expect(source).toContain('testId="settings-hub-integrations"');
    expect(source).toContain('href="/app/settings/integrations"');
  });

  it("no longer mounts the old top-level AI tile", () => {
    expect(source).not.toContain('testId="settings-hub-ai"');
    expect(source).not.toMatch(/href="\/app\/settings\/ai"/);
  });

  it("no longer mounts a top-level Strava tile", () => {
    // Belt-and-suspenders: spec calls out removing Strava + AI tiles.
    // Strava lives under Preferences and (now) the Integrations sub-hub.
    expect(source).not.toContain('testId="settings-hub-strava"');
  });

  it("uses plain-language copy on the Heart-rate zones tile", () => {
    // Replaces the jargon-y "%Max, %HRR, or %LTHR. Powers HR-aware stats."
    expect(source).toContain(
      "Define your heart rate training zones so the app can categorize cardio intensity.",
    );
    expect(source).not.toContain("%Max, %HRR, or %LTHR");
  });
});
