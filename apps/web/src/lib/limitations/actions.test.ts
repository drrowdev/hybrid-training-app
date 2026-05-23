import { describe, expect, it } from "vitest";
import { limitationFormSchema } from "./schema";

/**
 * Unit tests for the validation contract on the new
 * /app/recovery/injuries form (createLimitation / updateLimitation).
 * The actions themselves talk to Supabase and are covered by the
 * Playwright spec; here we lock down the rules the schema enforces.
 */
describe("limitationFormSchema", () => {
  const base = {
    kind: "knee",
    severity: "mild" as const,
    affectedMuscles: ["quads"],
    affectedMovementIds: [],
    notes: null,
    expectedDurationDays: null,
  };

  it("accepts a minimal valid input", () => {
    const r = limitationFormSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("requires kind", () => {
    const r = limitationFormSchema.safeParse({ ...base, kind: "" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown severity", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      severity: "extreme" as unknown as "mild",
    });
    expect(r.success).toBe(false);
  });

  it("requires at least one muscle or movement", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      affectedMuscles: [],
      affectedMovementIds: [],
    });
    expect(r.success).toBe(false);
  });

  it("accepts movement-only selections", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      affectedMuscles: [],
      affectedMovementIds: ["00000000-0000-4000-8000-000000000000"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown muscle group values", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      affectedMuscles: ["pecs"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed uuids in movement list", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      affectedMuscles: [],
      affectedMovementIds: ["not-a-uuid"],
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative expected duration", () => {
    const r = limitationFormSchema.safeParse({
      ...base,
      expectedDurationDays: -3,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a 2000-char notes field but no longer", () => {
    const ok = limitationFormSchema.safeParse({
      ...base,
      notes: "x".repeat(2000),
    });
    expect(ok.success).toBe(true);
    const tooBig = limitationFormSchema.safeParse({
      ...base,
      notes: "x".repeat(2001),
    });
    expect(tooBig.success).toBe(false);
  });
});
