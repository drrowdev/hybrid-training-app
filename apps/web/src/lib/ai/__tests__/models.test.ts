import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOGUE,
  DEFAULT_MODEL,
  isKnownModel,
  resolveModel,
} from "../models";

describe("model catalogue", () => {
  it("every provider has at least one model and a default that's in its list", () => {
    for (const provider of ["anthropic", "openai", "gemini"] as const) {
      const list = MODEL_CATALOGUE[provider];
      expect(list.length).toBeGreaterThan(0);
      expect(list.some((m) => m.id === DEFAULT_MODEL[provider])).toBe(true);
    }
  });

  it("lists only the current Anthropic generation (no retired ids)", () => {
    const ids = MODEL_CATALOGUE.anthropic.map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-opus-4-8");
    // The retired default that caused the 404 must not be offered.
    expect(ids).not.toContain("claude-3-5-sonnet-latest");
  });

  it("isKnownModel only accepts ids belonging to the provider", () => {
    expect(isKnownModel("anthropic", "claude-opus-4-8")).toBe(true);
    expect(isKnownModel("anthropic", "gpt-4o")).toBe(false);
    expect(isKnownModel("openai", "gpt-4o")).toBe(true);
  });

  it("resolveModel keeps a valid stored choice", () => {
    expect(resolveModel("anthropic", "claude-opus-4-8")).toBe("claude-opus-4-8");
  });

  it("resolveModel falls back to default for null or a stale/cross-provider id", () => {
    expect(resolveModel("anthropic", null)).toBe(DEFAULT_MODEL.anthropic);
    expect(resolveModel("anthropic", "gpt-4o")).toBe(DEFAULT_MODEL.anthropic);
    expect(resolveModel("anthropic", "claude-3-5-sonnet-latest")).toBe(
      DEFAULT_MODEL.anthropic,
    );
  });
});
