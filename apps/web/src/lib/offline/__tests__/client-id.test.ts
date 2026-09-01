import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createClientId } from "../client-id";

describe("createClientId", () => {
  it("returns an RFC 4122 UUID when randomUUID is unavailable", () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) },
    });
    try {
      const id = createClientId();
      expect(z.string().uuid().safeParse(id).success).toBe(true);
      expect(id[14]).toBe("4");
      expect(["8", "9", "a", "b"]).toContain(id[19]);
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        configurable: true,
        value: originalCrypto,
      });
    }
  });
});
