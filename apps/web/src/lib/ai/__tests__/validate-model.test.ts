import { describe, expect, it } from "vitest";
import { validateChosenModel } from "../validate-model";
import { getDefaultModel } from "../providers/model-catalogue";

describe("validateChosenModel — setByoaiKey model gate", () => {
  it("treats null / undefined / empty model as 'use default' → ok", () => {
    expect(validateChosenModel("anthropic", null, []).ok).toBe(true);
    expect(validateChosenModel("anthropic", undefined, []).ok).toBe(true);
    expect(validateChosenModel("anthropic", "", []).ok).toBe(true);
    expect(validateChosenModel("anthropic", "   ", []).ok).toBe(true);
  });

  it("accepts a curated id without consulting the live list", () => {
    const id = getDefaultModel("openai");
    // liveModelIds intentionally empty: curated entries are trusted.
    const r = validateChosenModel("openai", id, []);
    expect(r.ok).toBe(true);
  });

  it("accepts a custom id that appears in the live list", () => {
    const r = validateChosenModel("openai", "gpt-5.4-thinking", [
      "gpt-5.4-thinking",
      "gpt-5.1",
    ]);
    expect(r.ok).toBe(true);
  });

  it("rejects a custom id that is not in the live list with the spec message", () => {
    const r = validateChosenModel("openai", "gpt-9-unicorn", ["gpt-5.1"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("Your API key works");
      expect(r.reason).toContain("'gpt-9-unicorn'");
      expect(r.reason).toContain("not found on your account");
    }
  });

  it("rejects malformed custom ids before checking the live list", () => {
    const r = validateChosenModel("openai", "gpt 5; DROP TABLE", [
      "gpt 5; DROP TABLE",
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unsupported characters/);
  });
});
