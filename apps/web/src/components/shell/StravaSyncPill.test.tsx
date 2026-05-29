/**
 * StravaSyncPill — verifies the Today-page mobile pill renders when
 * a Strava connection exists, hides otherwise, and surfaces the
 * `lastSyncedAt` value in the tooltip.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StravaSyncPill } from "./StravaSyncPill";

describe("StravaSyncPill", () => {
  it("renders nothing when there is no Strava connection", () => {
    const html = renderToStaticMarkup(
      <StravaSyncPill hasStravaConnection={false} lastSyncedAt={null} />,
    );
    expect(html).toBe("");
  });

  it("renders the pill with a 'never synced' tooltip when lastSyncedAt is null", () => {
    const html = renderToStaticMarkup(
      <StravaSyncPill hasStravaConnection={true} lastSyncedAt={null} />,
    );
    expect(html).toContain('data-testid="strava-sync-pill"');
    expect(html).toContain('data-state="stale"');
    expect(html).toContain("never synced");
  });

  it("marks the pill fresh when lastSyncedAt is recent", () => {
    const recent = new Date(Date.now() - 60_000).toISOString();
    const html = renderToStaticMarkup(
      <StravaSyncPill hasStravaConnection={true} lastSyncedAt={recent} />,
    );
    expect(html).toContain('data-state="fresh"');
    expect(html).toContain("Up to date");
  });

  it("marks the pill stale when lastSyncedAt is older than 24h", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const html = renderToStaticMarkup(
      <StravaSyncPill hasStravaConnection={true} lastSyncedAt={old} />,
    );
    expect(html).toContain('data-state="stale"');
    expect(html).toContain("Stale");
  });
});
