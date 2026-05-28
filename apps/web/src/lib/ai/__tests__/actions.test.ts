import { describe, expect, it } from "vitest";
import { setKeySchema } from "../schema";
import { findCuratedOption, getDefaultModel } from "../providers/model-catalogue";

/**
 * setByoaiKey input-contract checks. The full action mutates the DB
 * and probes the provider's models endpoint; here we lock down the
 * Zod schema so malformed input is rejected before any side effect.
 */

describe("setByoaiKey input schema", () => {
  it("accepts a plausible key", () => {
    const r = setKeySchema.safeParse({
      provider: "anthropic",
      plaintextKey: "sk-ant-test-1234567890",
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown providers", () => {
    const r = setKeySchema.safeParse({
      provider: "cohere",
      plaintextKey: "sk-test-1234567890",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty keys", () => {
    const r = setKeySchema.safeParse({
      provider: "openai",
      plaintextKey: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-short keys", () => {
    const r = setKeySchema.safeParse({
      provider: "openai",
      plaintextKey: "abc",
    });
    expect(r.success).toBe(false);
  });

  it("rejects too-long keys (DOS guard)", () => {
    const r = setKeySchema.safeParse({
      provider: "openai",
      plaintextKey: "x".repeat(513),
    });
    expect(r.success).toBe(false);
  });

  it("trims whitespace before length-checking", () => {
    const r = setKeySchema.safeParse({
      provider: "openai",
      plaintextKey: "   sk-test-1234567890   ",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an optional curated model id", () => {
    const id = getDefaultModel("anthropic");
    expect(findCuratedOption("anthropic", id)).not.toBeNull();
    const r = setKeySchema.safeParse({
      provider: "anthropic",
      plaintextKey: "sk-ant-test-1234567890",
      model: id,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a custom model id within length bounds", () => {
    const r = setKeySchema.safeParse({
      provider: "anthropic",
      plaintextKey: "sk-ant-test-1234567890",
      model: "my-org-private-snapshot-2026-05-28",
    });
    expect(r.success).toBe(true);
  });

  it("accepts model = null (use the default)", () => {
    const r = setKeySchema.safeParse({
      provider: "anthropic",
      plaintextKey: "sk-ant-test-1234567890",
      model: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an over-long model id", () => {
    const r = setKeySchema.safeParse({
      provider: "anthropic",
      plaintextKey: "sk-ant-test-1234567890",
      model: "x".repeat(201),
    });
    expect(r.success).toBe(false);
  });
});
