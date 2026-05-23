import { describe, expect, it } from "vitest";
import {
  computePrTable,
  findBestPace,
  formatDelta,
  formatDuration,
  TARGET_DISTANCES,
  type Activity,
} from "./pace-prs";

const TODAY = "2026-05-23";

const RUN = (date: string, distanceKm: number, paceSecPerKm: number, id = "1"): Activity => ({
  date,
  modality: "run",
  distanceKm,
  avgPaceSecPerKm: paceSecPerKm,
  stravaActivityId: id,
});

describe("findBestPace", () => {
  it("ignores activities whose distance is below the target", () => {
    const best = findBestPace([RUN("2026-05-01", 3, 300)], 5);
    expect(best).toBeNull();
  });

  it("picks the lowest estimated time across qualifying activities", () => {
    const result = findBestPace(
      [
        RUN("2026-05-01", 6, 360, "a"), // 5K → 1800s
        RUN("2026-05-10", 8, 330, "b"), // 5K → 1650s ← faster
      ],
      5,
    );
    expect(result?.stravaActivityId).toBe("b");
    expect(result?.timeSec).toBe(330 * 5);
  });

  it("ignores non-run modalities", () => {
    const result = findBestPace(
      [{ date: "2026-05-01", modality: "bike", distanceKm: 30, avgPaceSecPerKm: 120, stravaActivityId: null }],
      10,
    );
    expect(result).toBeNull();
  });

  it("includes activities like trail_run that contain 'run'", () => {
    const result = findBestPace(
      [{ ...RUN("2026-05-12", 12, 350), modality: "trail_run" }],
      10,
    );
    expect(result).not.toBeNull();
  });
});

describe("computePrTable", () => {
  it("computes delta vs the previous 12-month window", () => {
    const rows = computePrTable(
      [
        RUN("2025-01-01", 10, 360), // previous window (>365d ago)
        RUN("2026-05-01", 10, 330), // current window
      ],
      TODAY,
    );
    const tenK = rows.find((r) => r.key === "10k")!;
    expect(tenK.current?.timeSec).toBe(3300);
    expect(tenK.previous?.timeSec).toBe(3600);
    expect(tenK.deltaSec).toBe(300);
  });

  it("returns null delta when no previous PR exists", () => {
    const rows = computePrTable([RUN("2026-05-01", 10, 330)], TODAY);
    expect(rows.find((r) => r.key === "10k")?.deltaSec).toBeNull();
  });

  it("produces a row for every canonical distance", () => {
    const rows = computePrTable([], TODAY);
    expect(rows.map((r) => r.key)).toEqual(TARGET_DISTANCES.map((t) => t.key));
  });
});

describe("formatDuration", () => {
  it("formats MM:SS for sub-hour", () => {
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(59)).toBe("0:59");
  });

  it("formats H:MM:SS for ≥1 hour", () => {
    expect(formatDuration(3725)).toBe("1:02:05");
  });
});

describe("formatDelta", () => {
  it("renders an improvement with ↓", () => {
    const { text, tone } = formatDelta(12);
    expect(text).toBe("↓ 0:12");
    expect(tone).toBe("success");
  });

  it("renders a regression with ↑", () => {
    expect(formatDelta(-8).text).toBe("↑ 0:08");
    expect(formatDelta(-8).tone).toBe("danger");
  });

  it("renders em-dash when null", () => {
    expect(formatDelta(null).text).toBe("—");
  });
});
