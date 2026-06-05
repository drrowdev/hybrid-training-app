/**
 * Snapshot-ish render coverage for SessionModalityChip. Uses
 * renderToStaticMarkup (already pulled in by other component tests in
 * this directory) rather than a DOM testing library to stay within the
 * Phase 5 "no new npm deps" constraint.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionModalityChip } from "../SessionModalityChip";

describe("SessionModalityChip", () => {
  it("renders the mixed-modal pill with the warning color binding", () => {
    const html = renderToStaticMarkup(
      <SessionModalityChip modality="mixed_modal" />,
    );
    expect(html).toContain('data-testid="session-modality-chip"');
    expect(html).toContain('data-modality="mixed_modal"');
    expect(html).toContain("Mixed-modal");
    expect(html).toContain("var(--cp-warning)");
    expect(html).toContain("recovery");
  });

  it("renders the skill-focused pill with the link color binding", () => {
    const html = renderToStaticMarkup(
      <SessionModalityChip modality="skill_focused" />,
    );
    expect(html).toContain('data-modality="skill_focused"');
    expect(html).toContain("Skill-focused");
    expect(html).toContain("var(--cp-cardio)");
  });

  it("renders the pure-strength pill with the muted color binding", () => {
    const html = renderToStaticMarkup(
      <SessionModalityChip modality="pure_strength" />,
    );
    expect(html).toContain("Pure strength");
    expect(html).toContain("var(--cp-text-muted)");
  });

  it("renders nothing when modality is null", () => {
    const html = renderToStaticMarkup(
      <SessionModalityChip modality={null} />,
    );
    expect(html).toBe("");
  });
});
