import { describe, expect, it } from "vitest";
import { classifyProviderError } from "../types";

describe("classifyProviderError", () => {
  it("maps auth + rate-limit", () => {
    expect(classifyProviderError({ status: 401 })).toBe("auth-failed");
    expect(classifyProviderError({ status: 403 })).toBe("auth-failed");
    expect(classifyProviderError({ status: 429 })).toBe("rate-limited");
  });

  it("maps 404 (e.g. retired/unavailable model) to bad-input rather than unknown", () => {
    // A dead default model id 404s; this previously fell through to "unknown"
    // and surfaced the opaque "something went wrong" message.
    expect(
      classifyProviderError({
        status: 404,
        message: 'model: claude-3-5-sonnet-latest',
      }),
    ).toBe("bad-input");
  });

  it("maps 400/422 to bad-input", () => {
    expect(classifyProviderError({ status: 400 })).toBe("bad-input");
    expect(classifyProviderError({ status: 422 })).toBe("bad-input");
  });

  it("maps timeouts and gateway errors", () => {
    expect(classifyProviderError({ status: 408 })).toBe("llm-timeout");
    expect(classifyProviderError({ name: "AbortError" })).toBe("llm-timeout");
    expect(classifyProviderError({ status: 503 })).toBe("llm-unreachable");
  });

  it("falls back to unknown for unrecognised shapes", () => {
    expect(classifyProviderError({})).toBe("unknown");
    expect(classifyProviderError(null)).toBe("unknown");
  });
});
