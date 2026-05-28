import { describe, expect, it } from "vitest";
import {
  MODEL_OPTIONS,
  describeModel,
  findCuratedOption,
  getDefaultModel,
  validateCustomModelId,
} from "../model-catalogue";
import type { LlmProviderName } from "../types";

const PROVIDERS: LlmProviderName[] = ["anthropic", "openai", "gemini"];

describe("MODEL_OPTIONS catalogue", () => {
  it.each(PROVIDERS)(
    "%s exposes at least one option per tier",
    (provider) => {
      const opts = MODEL_OPTIONS[provider];
      const tiers = new Set(opts.map((o) => o.tier));
      expect(tiers.has("most_capable")).toBe(true);
      expect(tiers.has("recommended")).toBe(true);
      expect(tiers.has("fast_cheap")).toBe(true);
    },
  );

  it.each(PROVIDERS)(
    "%s entries have non-empty id + label and a cost band",
    (provider) => {
      for (const opt of MODEL_OPTIONS[provider]) {
        expect(opt.id.length).toBeGreaterThan(0);
        expect(opt.label.length).toBeGreaterThan(0);
        expect(["$", "$$", "$$$", "$$$$"]).toContain(opt.costBand);
      }
    },
  );

  it.each(PROVIDERS)(
    "%s ids are unique",
    (provider) => {
      const ids = MODEL_OPTIONS[provider].map((o) => o.id);
      expect(new Set(ids).size).toBe(ids.length);
    },
  );
});

describe("getDefaultModel", () => {
  it.each(PROVIDERS)(
    "%s resolves to the Recommended-tier option (cost-conservative default)",
    (provider) => {
      const id = getDefaultModel(provider);
      const opt = findCuratedOption(provider, id);
      expect(opt).not.toBeNull();
      expect(opt?.tier).toBe("recommended");
    },
  );
});

describe("describeModel", () => {
  it("returns the catalogue label for a curated id", () => {
    const id = getDefaultModel("anthropic");
    const opt = findCuratedOption("anthropic", id)!;
    expect(describeModel("anthropic", id)).toBe(opt.label);
  });

  it("prefixes 'Custom:' for unknown ids", () => {
    expect(describeModel("anthropic", "some-experimental-id")).toBe(
      "Custom: some-experimental-id",
    );
  });
});

describe("validateCustomModelId", () => {
  it("accepts a plausible id", () => {
    expect(validateCustomModelId("claude-opus-4-7")).toEqual({ ok: true });
    expect(validateCustomModelId("gpt-5.4-thinking")).toEqual({ ok: true });
    expect(validateCustomModelId("models/gemini-3-pro@001")).toEqual({
      ok: true,
    });
  });

  it("rejects empty strings", () => {
    const r = validateCustomModelId("");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/empty/);
  });

  it("rejects whitespace-only strings", () => {
    const r = validateCustomModelId("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects strings longer than 200 chars", () => {
    const r = validateCustomModelId("a".repeat(201));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/long/);
  });

  it("rejects unsupported characters (whitespace, quotes, etc.)", () => {
    expect(validateCustomModelId("gpt 5").ok).toBe(false);
    expect(validateCustomModelId("gpt-5;DROP").ok).toBe(false);
    expect(validateCustomModelId('gpt-5"').ok).toBe(false);
  });
});
