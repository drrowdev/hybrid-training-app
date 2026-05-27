/**
 * HrZonesSettings — settings panel render coverage.
 *
 * The component is interactive (debounced auto-save), but the
 * project's vitest config runs in `node` without jsdom — so we cover
 * the bits that *can* be tested:
 *
 *   - `previewZoneRows` pure helper (method-swap parity, reset
 *     parity, "no inputs yet" empty state, boundary rounding).
 *   - Static-markup render of the initial panel for each method so
 *     the test catches a missing/renamed input field on regressions.
 *
 * The auto-save round-trip itself is covered by the action test in
 * `lib/settings/__tests__/hr-zones-actions.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// The component pulls in `updateHrZones`, which is a server action that
// imports `next/headers`. Stub the action module so a render doesn't
// drag the server-only dependency tree into the test.
vi.mock("@/lib/settings/hr-zones-actions", () => ({
  updateHrZones: vi.fn(async () => ({ ok: true, hrZones: null })),
}));

import {
  HrZonesSettings,
  previewZoneRows,
} from "../HrZonesSettings";
import { computeZoneBands } from "@/lib/stats/hr-zones";

describe("previewZoneRows", () => {
  it("returns 5 rows of em-dashes when bands are null (no inputs yet)", () => {
    const rows = previewZoneRows(null);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.zone)).toEqual(["Z1", "Z2", "Z3", "Z4", "Z5"]);
    expect(rows.every((r) => r.range === "—")).toBe(true);
  });

  it("formats %Max bands with rounded integers and inclusive display ranges", () => {
    const bands = computeZoneBands({ method: "max", hrMax: 200 });
    const rows = previewZoneRows(bands);
    expect(rows[0]).toEqual({ zone: "Z1", range: "≤ 119", hint: "recovery" });
    expect(rows[1].range).toBe("120–139");
    expect(rows[2].range).toBe("140–159");
    expect(rows[3].range).toBe("160–179");
    expect(rows[4]).toEqual({ zone: "Z5", range: "≥ 180", hint: "VO2 max" });
  });

  it("reflects method swap: %HRR bands differ from %Max bands for the same hrMax", () => {
    const maxRows = previewZoneRows(computeZoneBands({ method: "max", hrMax: 200 }));
    const hrrRows = previewZoneRows(
      computeZoneBands({ method: "hrr", hrMax: 200, hrResting: 60 }),
    );
    // Z1 upper-bound under %Max = 120; under %HRR = 130 (anchored at resting).
    expect(maxRows[0].range).toBe("≤ 119");
    expect(hrrRows[0].range).toBe("≤ 129");
  });

  it("reflects method swap: %LTHR puts LTHR itself in Z5", () => {
    const rows = previewZoneRows(computeZoneBands({ method: "lthr", hrLthr: 170 }));
    // z4Max = 170 * 0.99 = 168.3 → round → 168 → Z5 = "≥ 168".
    expect(rows[4].range).toBe("≥ 168");
  });
});

function render(props: React.ComponentProps<typeof HrZonesSettings>): string {
  return renderToStaticMarkup(<HrZonesSettings {...props} />);
}

describe("HrZonesSettings — static render", () => {
  it("method=max renders the Max-HR input, no resting / LTHR fields", () => {
    const html = render({
      initial: { hrMethod: "max", hrMax: 190, hrResting: null, hrLthr: null },
      age: 30,
    });
    expect(html).toContain('data-testid="hr-max-input"');
    expect(html).not.toContain('data-testid="hr-resting-input"');
    expect(html).not.toContain('data-testid="hr-lthr-input"');
    expect(html).toContain("Estimate from age");
  });

  it("method=hrr renders BOTH Max-HR and Resting-HR inputs", () => {
    const html = render({
      initial: { hrMethod: "hrr", hrMax: 195, hrResting: 55, hrLthr: null },
      age: null,
    });
    expect(html).toContain('data-testid="hr-max-input"');
    expect(html).toContain('data-testid="hr-resting-input"');
    expect(html).not.toContain('data-testid="hr-lthr-input"');
  });

  it("method=lthr renders only the LTHR input + the external help link", () => {
    const html = render({
      initial: { hrMethod: "lthr", hrMax: null, hrResting: null, hrLthr: 170 },
      age: null,
    });
    expect(html).not.toContain('data-testid="hr-max-input"');
    expect(html).not.toContain('data-testid="hr-resting-input"');
    expect(html).toContain('data-testid="hr-lthr-input"');
    expect(html).toContain("How do I find my LTHR");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener"');
  });

  it("renders the live zone preview reflecting current inputs", () => {
    const html = render({
      initial: { hrMethod: "max", hrMax: 200, hrResting: null, hrLthr: null },
      age: null,
    });
    // Z1 upper-bound display for hrMax=200 → 120*0.6=120 → "≤ 119 bpm".
    expect(html).toContain("≤ 119 bpm");
    expect(html).toContain("≥ 180 bpm");
  });

  it("renders the reset button with the age estimate when age is provided", () => {
    const html = render({
      initial: { hrMethod: "max", hrMax: null, hrResting: null, hrLthr: null },
      age: 28,
    });
    expect(html).toContain('data-testid="hr-zones-reset"');
    expect(html).toContain("Reset to estimate (192 bpm)");
  });
});
