/**
 * Render coverage for BwDiagnosticsSection.
 *
 * Uses renderToStaticMarkup (no new npm deps — same pattern as
 * SessionModalityChip.test.tsx). Covers: empty state, single
 * signal, multiple-signal sort, severity colour binding, and the
 * 5-card cap + "Show all" affordance.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BwDiagnosticsSection } from "../BwDiagnosticsSection";
import type { DiagnosticResult } from "@/lib/planner/bw-diagnostics";

const softStall: DiagnosticResult = {
  signal: {
    kind: "stall_at_node",
    family: "push_h",
    weeksAtNode: 4,
    severity: "soft",
  },
  intervention: {
    signalKind: "stall_at_node",
    copy: "Stalled at Push for 4 weeks.",
    actionable: {
      label: "Review progression settings",
      href: "/app/settings/bodyweight-progression",
    },
  },
};

const hardStall: DiagnosticResult = {
  signal: {
    kind: "stall_at_node",
    family: "pull_v",
    weeksAtNode: 7,
    severity: "hard",
  },
  intervention: {
    signalKind: "stall_at_node",
    copy: "Stalled at Pull for 7 weeks.",
  },
};

const upperDrift: DiagnosticResult = {
  signal: {
    kind: "aesthetics_drift_upper_strong",
    ratio: 3.4,
    lowerFamiliesLagging: ["hinge"],
  },
  intervention: {
    signalKind: "aesthetics_drift_upper_strong",
    copy: "Upper has progressed 3.4× faster than lower.",
    actionable: {
      label: "Bias next block toward lower body",
      href: "/app/plan/new?bias=lower",
    },
  },
};

const hingeGap: DiagnosticResult = {
  signal: { kind: "hinge_gap_active", weeksSinceHingeWork: 3 },
  intervention: {
    signalKind: "hinge_gap_active",
    copy: "No hinge work in 14 days.",
  },
};

describe("BwDiagnosticsSection", () => {
  it("renders nothing when no signals", () => {
    const html = renderToStaticMarkup(<BwDiagnosticsSection results={[]} />);
    expect(html).toBe("");
    expect(html).not.toContain("All clear");
  });

  it("renders a single signal with severity color and action link", () => {
    const html = renderToStaticMarkup(
      <BwDiagnosticsSection results={[softStall]} />,
    );
    expect(html).toContain('data-testid="bw-diagnostic-card-stall_at_node"');
    expect(html).toContain('data-severity="soft"');
    expect(html).toContain("var(--cp-warning)");
    expect(html).toContain("Stalled at Push");
    expect(html).toContain("Review progression settings");
    expect(html).toContain("/app/settings/bodyweight-progression");
  });

  it("renders hard severity with the danger colour binding", () => {
    const html = renderToStaticMarkup(
      <BwDiagnosticsSection results={[hardStall]} />,
    );
    expect(html).toContain('data-severity="hard"');
    expect(html).toContain("var(--cp-danger)");
  });

  it("preserves the caller-given order in the rendered HTML", () => {
    const html = renderToStaticMarkup(
      <BwDiagnosticsSection results={[hardStall, upperDrift, hingeGap]} />,
    );
    const hardIdx = html.indexOf("Stalled at Pull");
    const driftIdx = html.indexOf("Upper has progressed");
    const hingeIdx = html.indexOf("No hinge work");
    expect(hardIdx).toBeGreaterThan(-1);
    expect(driftIdx).toBeGreaterThan(hardIdx);
    expect(hingeIdx).toBeGreaterThan(driftIdx);
  });

  it("caps the visible list at 5 and shows the Show all affordance", () => {
    const many: DiagnosticResult[] = Array.from({ length: 7 }).map((_, i) => ({
      signal: {
        kind: "stall_at_node",
        family: "push_h",
        weeksAtNode: 4 + i,
        severity: "soft",
      },
      intervention: { signalKind: "stall_at_node", copy: `stall #${i}` },
    }));
    const html = renderToStaticMarkup(<BwDiagnosticsSection results={many} />);
    expect(html).toContain("Show all (7)");
    expect(html).toContain("stall #0");
    expect(html).toContain("stall #4");
    expect(html).not.toContain("stall #5");
  });

  it("does not show the Show all button when ≤ 5 signals", () => {
    const html = renderToStaticMarkup(
      <BwDiagnosticsSection results={[softStall, hingeGap, upperDrift]} />,
    );
    expect(html).not.toContain("Show all");
  });

  it("renders the action button only when actionable.href is present", () => {
    const html = renderToStaticMarkup(
      <BwDiagnosticsSection results={[hingeGap]} />,
    );
    expect(html).not.toContain(
      'data-testid="bw-diagnostic-action-hinge_gap_active"',
    );
  });
});
