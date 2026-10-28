import { describe, expect, it } from "vitest";
import {
  buildMovementHistory,
  formatHistoryEntry,
  historySummary,
  weightPrIds,
  type HistoryCardioEntry,
  type HistorySetEntry,
} from "../movement-history";

const session = (id: string, performed_at: string, title: string | null = "Monday strength") => ({ id, title, performed_at });
const set = (id: string, over: Partial<HistorySetEntry> = {}): HistorySetEntry => ({
  kind: "set", id, setIndex: 0, createdAt: "2026-10-01T10:00:00Z", weightKg: 90, reps: 5, durationSec: null,
  distanceM: null, rpe: null, notes: null, skipped: false, skipReason: null, ...over,
});
const cardio = (id: string, over: Partial<HistoryCardioEntry> = {}): HistoryCardioEntry => ({
  kind: "cardio", id, createdAt: "2026-10-01T10:00:00Z", durationSec: 105, distanceKm: null, rpe: null, notes: null, ...over,
});

describe("buildMovementHistory", () => {
  it("lists sessions newest first with sets in set order", () => {
    const old = session("a", "2026-09-28T00:00:00Z");
    const recent = session("b", "2026-10-19T00:00:00Z");
    const history = buildMovementHistory([
      { session: old, entry: set("a1") },
      { session: recent, entry: set("b2", { setIndex: 1 }) },
      { session: recent, entry: set("b1", { setIndex: 0 }) },
    ], []);
    expect(history.sessions.map((s) => s.sessionId)).toEqual(["b", "a"]);
    expect(history.sessions[0]!.entries.map((e) => e.id)).toEqual(["b1", "b2"]);
  });

  it("keeps skipped sets", () => {
    const history = buildMovementHistory([
      { session: session("a", "2026-10-01T00:00:00Z"), entry: set("s", { skipped: true, skipReason: "pain", weightKg: 0, reps: 0 }) },
    ], []);
    expect(history.sessions[0]!.entries).toHaveLength(1);
    expect(formatHistoryEntry(history.sessions[0]!.entries[0]!, "metric")).toBe("Skipped · Pain");
  });

  it("drops the one-second marker a circuit station saves, but keeps a timed block", () => {
    const s = session("a", "2026-10-01T00:00:00Z");
    const history = buildMovementHistory([], [
      { session: s, entry: cardio("marker", { durationSec: 1 }) },
      { session: s, entry: cardio("timed", { durationSec: 105 }) },
    ]);
    expect(history.sessions[0]!.entries.map((e) => e.id)).toEqual(["timed"]);
  });

  it("omits a session that has nothing to show", () => {
    const history = buildMovementHistory([], [{ session: session("a", "2026-10-01T00:00:00Z"), entry: cardio("m", { durationSec: 1 }) }]);
    expect(history.sessions).toHaveLength(0);
  });
});

describe("formatHistoryEntry", () => {
  it("shows weight × reps in the user's unit", () => {
    expect(formatHistoryEntry(set("x", { weightKg: 92.5, reps: 5 }), "metric")).toBe("92.5 kg × 5");
    expect(formatHistoryEntry(set("x", { weightKg: 100, reps: 5 }), "imperial")).toBe("220 lb × 5");
  });

  it("shows bodyweight reps, loaded distance and timed holds", () => {
    expect(formatHistoryEntry(set("x", { weightKg: 0, reps: 12 }), "metric")).toBe("12 reps");
    expect(formatHistoryEntry(set("x", { weightKg: 102.5, reps: null, distanceM: 20 }), "metric")).toBe("102.5 kg × 20 m");
    expect(formatHistoryEntry(set("x", { weightKg: null, reps: null, durationSec: 45 }), "metric")).toBe("0:45");
  });

  it("shows cardio time as m:ss with distance", () => {
    expect(formatHistoryEntry(cardio("c", { durationSec: 105, distanceKm: 0.5 }), "metric")).toBe("1:45 · 0.50 km");
  });
});

describe("weightPrIds and historySummary", () => {
  const history = buildMovementHistory([
    { session: session("a", "2026-09-21T00:00:00Z"), entry: set("a1", { weightKg: 90 }) },
    { session: session("b", "2026-09-28T00:00:00Z"), entry: set("b1", { weightKg: 100, reps: 3 }) },
    { session: session("c", "2026-10-12T00:00:00Z"), entry: set("c1", { weightKg: 92.5 }) },
    { session: session("d", "2026-10-19T00:00:00Z"), entry: set("d1", { weightKg: 95, reps: 4 }) },
  ], []);

  it("marks only a set that beat every earlier weight, never the first session", () => {
    expect([...weightPrIds(history)]).toEqual(["b1"]);
  });

  it("reports the heaviest set and the session count", () => {
    expect(historySummary(history)).toEqual({ heaviest: { weightKg: 100, reps: 3 }, sessions: 4 });
  });
});
