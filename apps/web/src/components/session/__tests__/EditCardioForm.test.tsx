/**
 * EditCardioForm — static render + mode tests.
 *
 * Covers the audit fixes for the edit-cardio page:
 *   - Heading rename (page-level, but verified via the form's
 *     submit-button copy which is paired with it).
 *   - Duration field rendered in MINUTES (not seconds).
 *   - Pace field rendered in M:SS (not s/km).
 *   - Prescription-only mode (Quick cardio, no logged metrics) hides
 *     Distance / Avg HR / Pace / RPE — only Duration + Notes remain.
 *   - Strava-imported mode is read-only and shows the re-sync note.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EditCardioForm,
  type EditCardioBlock,
} from "../EditCardioForm";

const noop = (async () => {}) as unknown as React.ComponentProps<typeof EditCardioForm>["action"];

function makeBlock(over: Partial<EditCardioBlock> = {}): EditCardioBlock {
  return {
    id: "00000000-0000-4000-8000-0000000000a1",
    duration_sec: 1800,
    distance_km: null,
    avg_hr_bpm: null,
    avg_pace_sec_per_km: null,
    rpe: null,
    notes: null,
    ...over,
  };
}

describe("EditCardioForm", () => {
  it("renders Duration in minutes (not seconds) from a 30-min block", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({ duration_sec: 1800 })}
        units="metric"
        mode={{ kind: "full" }}
        action={noop}
      />,
    );
    expect(html).toContain('name="durationMin"');
    expect(html).toContain("Duration (min)");
    // Default value 30, not 1800.
    expect(html).toContain('value="30"');
    expect(html).not.toContain('value="1800"');
    expect(html).not.toContain("Duration (s)");
  });

  it("renders Pace in M:SS format (not s/km) and uses correct label per units", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({ avg_pace_sec_per_km: 360, avg_hr_bpm: 150 })}
        units="metric"
        mode={{ kind: "full" }}
        action={noop}
      />,
    );
    expect(html).toContain("Pace (min:sec/km)");
    expect(html).toContain('value="6:00"');
    expect(html).not.toContain("Pace (s/km)");
    expect(html).not.toContain('value="360"');
  });

  it("uses imperial labels (mi) when profile.units === 'imperial'", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({ avg_pace_sec_per_km: 372, avg_hr_bpm: 150 })}
        units="imperial"
        mode={{ kind: "full" }}
        action={noop}
      />,
    );
    expect(html).toContain("Pace (min:sec/mi)");
    expect(html).toContain("Distance (mi)");
    expect(html).not.toContain("Distance (km)");
  });

  it("prescription-only mode hides metric fields and shows only Duration + Notes", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({ duration_sec: 1800 })}
        units="metric"
        mode={{ kind: "prescription-only" }}
        action={noop}
      />,
    );
    expect(html).toContain('data-mode="prescription-only"');
    expect(html).toContain("Duration (min)");
    expect(html).toContain('name="notes"');
    // Hidden in prescription-only mode.
    expect(html).not.toContain("Distance");
    expect(html).not.toContain("Avg HR");
    expect(html).not.toContain("Pace (");
    expect(html).not.toContain('name="rpe"');
  });

  it("strava-readonly mode renders all fields read-only with a re-sync note", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({
          duration_sec: 1800,
          distance_km: 6.4,
          avg_hr_bpm: 165,
          avg_pace_sec_per_km: 280,
          rpe: 7,
        })}
        units="metric"
        mode={{ kind: "strava-readonly" }}
        action={noop}
      />,
    );
    expect(html).toContain("Synced from Strava");
    expect(html).toContain('data-mode="strava-readonly"');
    expect(html).toContain("readonly");
    // No submit button in read-only mode.
    expect(html).not.toContain('data-testid="edit-cardio-submit"');
  });

  it("full mode renders every metric field with a save button", () => {
    const html = renderToStaticMarkup(
      <EditCardioForm
        sessionId="s"
        block={makeBlock({
          duration_sec: 1800,
          distance_km: 5,
          avg_hr_bpm: 150,
          avg_pace_sec_per_km: 360,
          rpe: 7,
        })}
        units="metric"
        mode={{ kind: "full" }}
        action={noop}
      />,
    );
    expect(html).toContain('data-mode="full"');
    expect(html).toContain("Duration (min)");
    expect(html).toContain("Distance (km)");
    expect(html).toContain("Avg HR (bpm)");
    expect(html).toContain("Pace (min:sec/km)");
    expect(html).toContain('name="rpe"');
    expect(html).toContain('data-testid="edit-cardio-submit"');
    expect(html).toContain("Save changes");
  });
});
