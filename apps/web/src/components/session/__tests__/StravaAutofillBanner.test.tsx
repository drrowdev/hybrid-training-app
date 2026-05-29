/**
 * StravaAutofillBanner — three-state surface tests.
 *
 * The component has client-side state (useState/useTransition) and a
 * server-action prop, so we test:
 *   - pure state picker (pickBannerState) directly
 *   - pure "last synced" formatter (formatLastSynced) directly
 *   - static render with the 3 inputs to confirm copy + actions
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StravaAutofillBanner,
  pickBannerState,
  formatLastSynced,
  type StravaAutofillMatch,
} from "../StravaAutofillBanner";

type SyncAction = React.ComponentProps<typeof StravaAutofillBanner>["syncAction"];
type ApplyAction = React.ComponentProps<typeof StravaAutofillBanner>["applyAction"];

const noop = (async () => ({ ok: true as const })) as unknown as SyncAction;
const noopApply = (async () => undefined) as unknown as ApplyAction;

const matchFixture: StravaAutofillMatch = {
  cardioLogId: "c1",
  stravaActivityId: "100",
  modality: "run",
  durationSec: 35 * 60,
  distanceKm: 6.4,
  avgHrBpm: 152,
};

describe("pickBannerState", () => {
  it("returns 'no_match' when there is no match and we're not syncing", () => {
    expect(
      pickBannerState({
        match: null,
        syncing: false,
        applied: false,
        dismissed: false,
      }),
    ).toBe("no_match");
  });
  it("returns 'syncing' when a sync is in flight (no match yet)", () => {
    expect(
      pickBannerState({
        match: null,
        syncing: true,
        applied: false,
        dismissed: false,
      }),
    ).toBe("syncing");
  });
  it("returns 'match' when we have a match and nothing else is going on", () => {
    expect(
      pickBannerState({
        match: matchFixture,
        syncing: false,
        applied: false,
        dismissed: false,
      }),
    ).toBe("match");
  });
  it("returns 'applied' once the user has accepted the autofill", () => {
    expect(
      pickBannerState({
        match: matchFixture,
        syncing: false,
        applied: true,
        dismissed: false,
      }),
    ).toBe("applied");
  });
  it("returns 'dismissed' which the component should treat as 'do not render'", () => {
    expect(
      pickBannerState({
        match: matchFixture,
        syncing: false,
        applied: false,
        dismissed: true,
      }),
    ).toBe("dismissed");
  });
});

describe("formatLastSynced", () => {
  const now = new Date("2030-01-01T12:00:00Z");
  it("never synced when null", () => {
    expect(formatLastSynced(null, now)).toBe("never synced");
  });
  it("'just now' under a minute", () => {
    expect(
      formatLastSynced(new Date(now.getTime() - 30_000), now),
    ).toBe("just now");
  });
  it("minutes ago under an hour", () => {
    expect(
      formatLastSynced(new Date(now.getTime() - 12 * 60_000), now),
    ).toBe("12m ago");
  });
  it("hours ago under a day", () => {
    expect(
      formatLastSynced(new Date(now.getTime() - 5 * 3600_000), now),
    ).toBe("5h ago");
  });
  it("days ago beyond 24h", () => {
    expect(
      formatLastSynced(new Date(now.getTime() - 3 * 86_400_000), now),
    ).toBe("3d ago");
  });
});

describe("StravaAutofillBanner (no-match state)", () => {
  it("renders the no-match neutral surface with a Sync now button", () => {
    const html = renderToStaticMarkup(
      <StravaAutofillBanner
        sessionId="s1"
        match={null}
        applyAction={noopApply}
        syncAction={noop}
        lastSyncedAt={new Date(Date.now() - 12 * 60_000)}
      />,
    );
    expect(html).toContain('data-state="no_match"');
    expect(html).toContain("Strava — no match yet");
    expect(html).toContain('data-testid="strava-autofill-sync"');
    expect(html).not.toContain('data-testid="strava-autofill-use"');
  });

  it("renders the match accent surface with Use/Dismiss when a match is provided", () => {
    const html = renderToStaticMarkup(
      <StravaAutofillBanner
        sessionId="s1"
        match={matchFixture}
        applyAction={noopApply}
        syncAction={noop}
        lastSyncedAt={new Date()}
      />,
    );
    expect(html).toContain('data-state="match"');
    expect(html).toContain('data-testid="strava-autofill-use"');
    expect(html).toContain('data-testid="strava-autofill-dismiss"');
    expect(html).toContain("run · 35 min · 6.4 km · 152 bpm avg HR");
  });
});
