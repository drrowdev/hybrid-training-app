import { describe, it, expect } from "vitest";
import {
  pickBestMatch,
  STRAVA_MATCH_WINDOW_MS,
  type StravaMatchCandidate,
} from "../match";

function candidate(
  partial: Partial<StravaMatchCandidate> & { performedAt: string; modality?: string },
): StravaMatchCandidate {
  return {
    cardioLogId: partial.cardioLogId ?? "log-1",
    stravaActivityId: partial.stravaActivityId ?? "act-1",
    modality: partial.modality ?? "run",
    durationSec: partial.durationSec ?? 1800,
    distanceKm: partial.distanceKm ?? 5,
    avgHrBpm: partial.avgHrBpm ?? 145,
    rpe: partial.rpe ?? null,
    performedAt: partial.performedAt,
  };
}

describe("pickBestMatch — Strava activity matcher (Phase 2 C1)", () => {
  const targetIso = "2026-05-23T10:00:00.000Z";

  it("picks an activity within ±90 min", () => {
    const c = candidate({ performedAt: "2026-05-23T09:30:00.000Z" });
    const r = pickBestMatch([c], { sessionPerformedAt: targetIso });
    expect(r?.cardioLogId).toBe("log-1");
  });

  it("returns null when nothing is within the window", () => {
    const c = candidate({ performedAt: "2026-05-23T12:00:00.000Z" }); // +2h
    const r = pickBestMatch([c], { sessionPerformedAt: targetIso });
    expect(r).toBeNull();
  });

  it("includes activities right at the edge (±90 min exactly)", () => {
    const onEdge = candidate({ performedAt: "2026-05-23T08:30:00.000Z" }); // exactly -90 min
    const r = pickBestMatch([onEdge], { sessionPerformedAt: targetIso });
    expect(r?.cardioLogId).toBe("log-1");
  });

  it("excludes activities outside the window by one minute", () => {
    const justOut = candidate({ performedAt: "2026-05-23T08:29:00.000Z" }); // -91 min
    const r = pickBestMatch([justOut], { sessionPerformedAt: targetIso });
    expect(r).toBeNull();
  });

  it("picks the closest match by absolute time delta", () => {
    const a = candidate({ cardioLogId: "a", performedAt: "2026-05-23T09:00:00.000Z" }); // -60 min
    const b = candidate({ cardioLogId: "b", performedAt: "2026-05-23T10:15:00.000Z" }); // +15 min
    const c = candidate({ cardioLogId: "c", performedAt: "2026-05-23T11:00:00.000Z" }); // +60 min
    const r = pickBestMatch([a, b, c], { sessionPerformedAt: targetIso });
    expect(r?.cardioLogId).toBe("b");
  });

  it("filters by modality when modalityFilter is provided", () => {
    const run = candidate({ cardioLogId: "run", modality: "run", performedAt: "2026-05-23T10:00:00.000Z" });
    const swim = candidate({ cardioLogId: "swim", modality: "swim", performedAt: "2026-05-23T10:00:00.000Z" });
    const r = pickBestMatch([run, swim], {
      sessionPerformedAt: targetIso,
      modalityFilter: new Set(["swim"]),
    });
    expect(r?.cardioLogId).toBe("swim");
  });

  it("returns null when target time is unparseable", () => {
    const c = candidate({ performedAt: "2026-05-23T10:00:00.000Z" });
    const r = pickBestMatch([c], { sessionPerformedAt: "not-a-date" });
    expect(r).toBeNull();
  });

  it("returns null on empty candidate list", () => {
    expect(pickBestMatch([], { sessionPerformedAt: targetIso })).toBeNull();
  });

  it("custom window override widens the match", () => {
    const c = candidate({ performedAt: "2026-05-23T13:00:00.000Z" }); // +3h
    expect(pickBestMatch([c], { sessionPerformedAt: targetIso })).toBeNull();
    const r = pickBestMatch([c], { sessionPerformedAt: targetIso, windowMs: 4 * 60 * 60 * 1000 });
    expect(r?.cardioLogId).toBe("log-1");
  });

  it("exposes STRAVA_MATCH_WINDOW_MS as 90 min", () => {
    expect(STRAVA_MATCH_WINDOW_MS).toBe(90 * 60 * 1000);
  });
});
