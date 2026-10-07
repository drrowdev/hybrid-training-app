import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEED_MOVEMENTS } from "../../../../../../packages/db/seeds/movements";
import { bandPressdownRehearsalSql } from "../../../../scripts/band-pressdown-rehearsal";
import { resolveRequiredEquipment, isEquipmentAvailable } from "../../planner/equipment-requirements";
import { CUSTOM_EMPTY_PRESET } from "../../settings/equipment-presets";
import { isBodyweightCapableEquipment } from "../bodyweight-equipment";

describe("band triceps pressdown", () => {
  it("requires bands, not cables, and permits logging without a kg estimate (DC-A1)", () => {
    const movement = SEED_MOVEMENTS.find((m) => m.slug === "band-triceps-pressdown")!;
    expect(movement).toBeDefined();
    const requirement = resolveRequiredEquipment(movement);
    expect(requirement).toEqual({ kind: "bands" });
    expect(isEquipmentAvailable(requirement, {
      ...CUSTOM_EMPTY_PRESET,
      accessories: { ...CUSTOM_EMPTY_PRESET.accessories, bands: true },
    })).toBe(true);
    expect(isEquipmentAvailable(requirement, CUSTOM_EMPTY_PRESET)).toBe(false);
    expect(isBodyweightCapableEquipment(movement.equipment)).toBe(true);
    expect(movement.bodyWeightLoaded).toBe(false);
  });

  it("wires exact migration SQL and seed values into the CI-only rollback rehearsal", () => {
    const up = readFileSync(new URL("../../../../../../packages/db/drizzle/0163_seed_band_triceps_pressdown.sql", import.meta.url), "utf8");
    const down = readFileSync(new URL("../../../../../../packages/db/rollbacks/0163_seed_band_triceps_pressdown.down.sql", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const sql = bandPressdownRehearsalSql(up, down);
    expect(sql).toContain(up);
    expect(sql).toContain('"equipment":"band"');
    expect(sql).toContain('"primary_muscles":["triceps"]');
    expect(sql.match(/EXECUTE \$up\$/g)).toHaveLength(3);
    expect(sql.match(/EXCEPTION WHEN SQLSTATE '55000'/g)).toHaveLength(4);
    expect(sql).toContain("public.session_movements");
    expect(sql).toContain("public.set_logs");
    expect(sql).toContain("'movementSlug'");
    expect(sql).toContain("'movementId'");
    expect(sql).toMatch(/ROLLBACK;$/);
  });
});
