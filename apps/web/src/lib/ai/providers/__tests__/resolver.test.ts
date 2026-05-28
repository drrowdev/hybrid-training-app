import { describe, expect, it } from "vitest";
import { resolveModel } from "../resolver";
import { getDefaultModel } from "../model-catalogue";

describe("resolveModel", () => {
  it("returns the Recommended-tier default when saved is null", () => {
    expect(resolveModel("anthropic", null)).toBe(getDefaultModel("anthropic"));
    expect(resolveModel("openai", null)).toBe(getDefaultModel("openai"));
    expect(resolveModel("gemini", null)).toBe(getDefaultModel("gemini"));
  });

  it("returns the default when saved is undefined", () => {
    expect(resolveModel("anthropic", undefined)).toBe(
      getDefaultModel("anthropic"),
    );
  });

  it("returns the default when saved is empty / whitespace", () => {
    expect(resolveModel("anthropic", "")).toBe(getDefaultModel("anthropic"));
    expect(resolveModel("anthropic", "   ")).toBe(getDefaultModel("anthropic"));
  });

  it("returns the saved curated id verbatim", () => {
    expect(resolveModel("anthropic", "claude-opus-4-7")).toBe(
      "claude-opus-4-7",
    );
  });

  it("returns a custom string verbatim (trimmed)", () => {
    expect(resolveModel("anthropic", "  my-private-snapshot-2026 ")).toBe(
      "my-private-snapshot-2026",
    );
  });
});
