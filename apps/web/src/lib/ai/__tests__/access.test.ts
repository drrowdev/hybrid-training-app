import { describe, expect, it } from "vitest";
import { hasAiAccess } from "../access";

describe("hasAiAccess", () => {
  const FULL = {
    byoai_provider: "anthropic",
    byoai_key_vault_id: "00000000-0000-4000-8000-000000000000",
    byoai_unlocked_at: new Date(),
  };

  it("returns true when every gate is satisfied", () => {
    expect(hasAiAccess(FULL)).toBe(true);
  });

  it("returns false when provider is missing", () => {
    expect(hasAiAccess({ ...FULL, byoai_provider: null })).toBe(false);
  });

  it("returns false when vault id is missing (no BYOAI key configured)", () => {
    expect(hasAiAccess({ ...FULL, byoai_key_vault_id: null })).toBe(false);
  });

  it("returns false when unlocked_at is null (future paid gate)", () => {
    expect(hasAiAccess({ ...FULL, byoai_unlocked_at: null })).toBe(false);
  });

  it("treats string timestamps the same as Date objects", () => {
    expect(
      hasAiAccess({
        ...FULL,
        byoai_unlocked_at: "2026-05-29T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is exhaustive across the 8 provider × vault × unlocked combos", () => {
    let trueCount = 0;
    for (const p of [null, FULL.byoai_provider]) {
      for (const v of [null, FULL.byoai_key_vault_id]) {
        for (const u of [null, FULL.byoai_unlocked_at]) {
          const ok = hasAiAccess({
            byoai_provider: p,
            byoai_key_vault_id: v,
            byoai_unlocked_at: u,
          });
          if (ok) trueCount += 1;
        }
      }
    }
    expect(trueCount).toBe(1);
  });
});
