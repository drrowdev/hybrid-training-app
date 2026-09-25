import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecoveryView } from "../RecoveryView";
import type { CeilingExplain } from "@/lib/stats/engine";

const ceiling: CeilingExplain = {
  baseCeiling: 10000, confidenceBias: 0.8, finalCeiling: 8000,
  formula: "cold_start_partial", basisWeeks: [{ weekStart: "2026-09-14", volume: 10000, included: true }],
  inputs: { completedSessions28d: 3, recoveredWeeksCount: 1, dataCompleteness: 1, notes: [] },
};

describe("Recovery view", () => {
  it("keeps calculation inputs in one closed disclosure while exposing the estimate", () => {
    const html = renderToStaticMarkup(<RecoveryView regions={[]} buckets={[]} ceiling={ceiling} overrides={[]} formatProfile={null} />);
    expect(html.match(/<details\b/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*\bopen/);
    const disclosure = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    expect(disclosure).toContain('data-testid="stats-engine-ceiling-basis-row"');
    expect(disclosure).toContain('dateTime="2026-09-14"');
    expect(disclosure).toContain((10000).toLocaleString());
    expect(html.slice(0, html.indexOf("<details"))).toContain((8000).toLocaleString());
  });

  it("preserves chart values and user-entered change notes (DC-C2, DC-C14, DC-K4)", () => {
    const html = renderToStaticMarkup(<RecoveryView
      regions={[{ region: "knee", label: "Knees", currentFreshness: 0.6, history: [0.4, 0.6], lastLoadDate: "2026-09-24", setCounts: { d7: 1, d14: 2, d28: 3 } }]}
      buckets={[{ bucket: "neural", label: "Nervous system", atl: 11, ctl: 10, ceiling: 10, currentPressure: 11, percentOfCeiling: 1.1, description: "", why: "" }]}
      ceiling={ceiling} overrides={[{ kind: "movement_swap", what: "Bench press", did: "Changed movement", occurredAt: "2026-09-24T10:00:00Z", note: "Bar busy" }]} formatProfile={null} />);
    expect(html).toContain('data-testid="miniline"');
    expect(html).toContain('data-testid="pressure-meter-over"');
    expect(html).toContain("110%");
    expect(html).toContain("60%");
    expect(html).toContain('data-testid="stats-engine-override-note"');
    expect(html).toContain("Bar busy");
  });
});
