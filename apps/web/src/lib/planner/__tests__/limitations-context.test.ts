/**
 * Unit tests for `readLimitationsContext` + its pure derive helper.
 * Mocks the supabase client at the chainable-builder layer so the
 * test exercises the full read path without hitting the DB.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deriveLimitationsContext,
  readLimitationsContext,
  TENDINOPATHY_PATTERN,
} from "../limitations-context";

type Row = { region: string | null; kind: string | null; resolved_at: string | null };

function mockClient(rows: Row[] | null, error: Error | null = null): SupabaseClient {
  const builder = {
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(builder),
    }),
  } as unknown as SupabaseClient;
}

describe("TENDINOPATHY_PATTERN", () => {
  it("matches the tendinopathy / tendinitis / tendinosis family", () => {
    expect(TENDINOPATHY_PATTERN.test("Tendinopathy")).toBe(true);
    expect(TENDINOPATHY_PATTERN.test("Patellar tendinitis")).toBe(true);
    expect(TENDINOPATHY_PATTERN.test("achilles tendinosis")).toBe(true);
  });
  it("does not match unrelated kinds", () => {
    expect(TENDINOPATHY_PATTERN.test("knee")).toBe(false);
    expect(TENDINOPATHY_PATTERN.test("Region limitation")).toBe(false);
  });
});

describe("deriveLimitationsContext", () => {
  it("returns empty context for no rows", () => {
    const ctx = deriveLimitationsContext([]);
    expect(ctx.blockedRegions.size).toBe(0);
    expect(ctx.tendinopathyActive).toBe(false);
  });

  it("ignores resolved rows", () => {
    const ctx = deriveLimitationsContext([
      { region: "knee", kind: "Region limitation", resolved_at: "2026-01-01T00:00:00Z" },
      { region: null, kind: "Tendinopathy", resolved_at: "2026-01-01T00:00:00Z" },
    ]);
    expect(ctx.blockedRegions.size).toBe(0);
    expect(ctx.tendinopathyActive).toBe(false);
  });

  it("activates tendinopathy when an unresolved row's kind matches /tendin/i", () => {
    const ctx = deriveLimitationsContext([
      { region: null, kind: "Tendinopathy", resolved_at: null },
    ]);
    expect(ctx.tendinopathyActive).toBe(true);
    expect(ctx.blockedRegions.size).toBe(0);
  });

  it("activates tendinopathy for free-text rich rows too", () => {
    const ctx = deriveLimitationsContext([
      { region: "knee", kind: "Patellar tendinitis", resolved_at: null },
    ]);
    expect(ctx.tendinopathyActive).toBe(true);
    expect(ctx.blockedRegions.has("knee")).toBe(true);
  });

  it("adds region to blockedRegions for any unresolved row with a region", () => {
    const ctx = deriveLimitationsContext([
      { region: "shoulder_scapular", kind: "Region limitation", resolved_at: null },
    ]);
    expect(ctx.blockedRegions.has("shoulder_scapular")).toBe(true);
    expect(ctx.tendinopathyActive).toBe(false);
  });

  it("aggregates multiple active rows", () => {
    const ctx = deriveLimitationsContext([
      { region: "knee", kind: "Region limitation", resolved_at: null },
      { region: "shoulder_scapular", kind: "Region limitation", resolved_at: null },
      { region: null, kind: "Tendinopathy", resolved_at: null },
      { region: "elbow_forearm", kind: "Region limitation", resolved_at: "2026-01-02T00:00:00Z" }, // resolved → ignored
    ]);
    expect(ctx.blockedRegions.size).toBe(2);
    expect(ctx.blockedRegions.has("knee")).toBe(true);
    expect(ctx.blockedRegions.has("shoulder_scapular")).toBe(true);
    expect(ctx.blockedRegions.has("elbow_forearm")).toBe(false);
    expect(ctx.tendinopathyActive).toBe(true);
  });
});

describe("readLimitationsContext", () => {
  it("returns empty context when the table has no matching rows", async () => {
    const supabase = mockClient([]);
    const ctx = await readLimitationsContext(supabase, "user-1");
    expect(ctx.blockedRegions.size).toBe(0);
    expect(ctx.tendinopathyActive).toBe(false);
  });

  it("returns empty context and fails open on read error", async () => {
    const supabase = mockClient(null, new Error("boom"));
    const ctx = await readLimitationsContext(supabase, "user-1");
    expect(ctx.blockedRegions.size).toBe(0);
    expect(ctx.tendinopathyActive).toBe(false);
  });

  it("aggregates rows from the underlying query", async () => {
    const supabase = mockClient([
      { region: "knee", kind: "Region limitation", resolved_at: null },
      { region: null, kind: "Tendinopathy", resolved_at: null },
    ]);
    const ctx = await readLimitationsContext(supabase, "user-1");
    expect(ctx.blockedRegions.has("knee")).toBe(true);
    expect(ctx.tendinopathyActive).toBe(true);
  });
});
