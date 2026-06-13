/**
 * Tests for EditableKgChips with imperial unit conversion.
 * Verifies that the component correctly converts display values ↔ kg
 * when the `units` prop is set to "imperial".
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EditableKgChips } from "../EditableKgChips";

describe("EditableKgChips — imperial", () => {
  it("renders chip labels in lb when units='imperial'", () => {
    // 20 kg ≈ 44 lb (rounded)
    const html = renderToStaticMarkup(
      <EditableKgChips values={[20]} onChange={() => {}} units="imperial" />,
    );
    expect(html).toContain("44 lb");
    expect(html).not.toContain("20 kg");
  });

  it("renders chip labels in kg when units='metric' (default)", () => {
    const html = renderToStaticMarkup(
      <EditableKgChips values={[20]} onChange={() => {}} units="metric" />,
    );
    expect(html).toContain("20 kg");
  });

  it("preserves existing behaviour when no units prop is passed (uses unit string)", () => {
    const html = renderToStaticMarkup(
      <EditableKgChips values={[5]} onChange={() => {}} unit="kg" />,
    );
    expect(html).toContain("5 kg");
  });
});
