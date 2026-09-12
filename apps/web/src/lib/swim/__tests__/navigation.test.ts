import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSwimNavigation, swimEntryHref } from "../navigation";
import { getSwimCapability } from "../capability";

vi.mock("../capability", () => ({ getSwimCapability: vi.fn() }));

describe("ADR0079 standalone swimming reachability", () => {
  it("keeps existing swim history reachable when setup is disabled", () => {
    expect(swimEntryHref({ hasPlans: true, setupEnabled: false })).toBe("/app/swim");
    expect(swimEntryHref({ hasPlans: false, setupEnabled: true })).toBe("/app/swim/setup");
  });
  it("leaves non-swimming users unchanged when setup is disabled", () => {
    expect(swimEntryHref({ hasPlans: false, setupEnabled: false })).toBeNull();
  });
  it("does not query missing tables during the additive rollout", async () => {
    vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: false, setupEnabled: false });
    const from = vi.fn();
    expect(await getSwimNavigation({ from } as unknown as SupabaseClient, "user"))
      .toEqual({ storageAvailable: false, setupEnabled: false, hasPlans: false });
    expect(from).not.toHaveBeenCalled();
  });
  it("does not treat a storage failure as an empty plan", async () => {
    vi.mocked(getSwimCapability).mockResolvedValue({ storageAvailable: true, setupEnabled: false });
    const query = { select: vi.fn(), eq: vi.fn(), limit: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.limit.mockResolvedValue({ data: null, error: { message: "connection lost" } });
    await expect(getSwimNavigation({ from: () => query } as unknown as SupabaseClient, "user"))
      .rejects.toThrow("Could not load swimming.");
  });
});
