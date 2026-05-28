import { describe, expect, it } from "vitest";
import { hasAiAccess } from "../access";

describe("hasAiAccess", () => {
  const FULL = {
    ai_opt_in_at: new Date(),
    byoai_provider: "anthropic",
    byoai_key_vault_id: "00000000-0000-4000-8000-000000000000",
    byoai_unlocked_at: new Date(),
  };

  it("returns true when every gate is satisfied", () => {
    expect(hasAiAccess(FULL)).toBe(true);
  });

  it("returns false when opt-in is missing", () => {
    expect(hasAiAccess({ ...FULL, ai_opt_in_at: null })).toBe(false);
  });

  it("returns false when provider is missing", () => {
    expect(hasAiAccess({ ...FULL, byoai_provider: null })).toBe(false);
  });

  it("returns false when vault id is missing", () => {
    expect(hasAiAccess({ ...FULL, byoai_key_vault_id: null })).toBe(false);
  });

  it("returns false when unlocked_at is null (future paid gate)", () => {
    expect(hasAiAccess({ ...FULL, byoai_unlocked_at: null })).toBe(false);
  });

  it("treats string timestamps the same as Date objects", () => {
    expect(
      hasAiAccess({
        ...FULL,
        ai_opt_in_at: "2026-05-29T00:00:00Z",
        byoai_unlocked_at: "2026-05-29T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("is exhaustive across the 16 opt-in × provider × vault × unlocked combos", () => {
    let trueCount = 0;
    for (const a of [null, FULL.ai_opt_in_at]) {
      for (const p of [null, FULL.byoai_provider]) {
        for (const v of [null, FULL.byoai_key_vault_id]) {
          for (const u of [null, FULL.byoai_unlocked_at]) {
            const ok = hasAiAccess({
              ai_opt_in_at: a,
              byoai_provider: p,
              byoai_key_vault_id: v,
              byoai_unlocked_at: u,
            });
            if (ok) trueCount += 1;
          }
        }
      }
    }
    expect(trueCount).toBe(1);
  });
});
