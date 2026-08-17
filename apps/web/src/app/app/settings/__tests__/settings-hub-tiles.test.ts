/**
 * Settings hub structural contract.
 *
 * Asserts at source-text level that the top-level Settings page does not
 * regress the tile reshuffle. The Integrations sub-hub was removed with
 * the Strava integration (2026-08-17) — it had exactly one card and zero
 * remaining integrations.
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

  it("does not expose a retired AI settings tile", () => {
    expect(source).not.toContain('testId="settings-hub-ai"');
    expect(source).not.toMatch(/href="\/app\/settings\/ai"/);
    expect(source).not.toContain("AI providers");
  });

  it("no longer mounts a Strava tile or an Integrations sub-hub tile", () => {
    expect(source).not.toContain('testId="settings-hub-strava"');
    expect(source).not.toContain('testId="settings-hub-integrations"');
    expect(source).not.toMatch(/href="\/app\/settings\/integrations"/);
    expect(source).not.toMatch(/strava/i);
  });

  it("uses plain-language copy on the Heart-rate zones tile", () => {
    // Terse, jargon-free fragment consistent with the other hub tiles.
    expect(source).toContain("Z1–Z5 thresholds for cardio intensity.");
    expect(source).not.toContain("%Max, %HRR, or %LTHR");
  });
});
