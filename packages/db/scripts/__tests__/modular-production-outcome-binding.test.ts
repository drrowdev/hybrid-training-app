import { describe, expect, it } from "vitest";
import { modularProductionSettings } from "../modular-production-preflight-guards";
import { productionSettings } from "../swim-production-readonly-guards";
import { REVIEW } from "../swim-review-config-plan";

const key = "SWIM_IMPORT_OUTCOMES_ENABLED";
const project = {
  id: REVIEW.projectId, accountId: REVIEW.teamId, name: REVIEW.projectName,
  rootDirectory: "apps/web", framework: "nextjs",
  link: { type: "github", org: "drrowdev", repo: "hybrid-training-app", productionBranch: "main" },
  ssoProtection: { deploymentType: "all_except_custom_domains" },
};
const binding = () => ({
  id: "syntheticOutcomeFlag", key, type: "encrypted", target: ["production"],
  createdAt: 1000, updatedAt: 2000,
  get value(): never { throw new Error("Environment values must not be read"); },
});
const shared = (data: unknown[] = []) => ({ data, pagination: { count: data.length, next: null } });

describe("DC-SW8 modular preflight observes the outcome binding without reading values", () => {
  it("reports absence only after validating both complete metadata lists", () => {
    const value = modularProductionSettings(project, { envs: [] }, shared());
    expect(value.outcomeFlag).toEqual({ key, configured: false });
    expect(value.valuesRead).toBe(false);
  });

  it.each(["project", "shared"])("projects only metadata from the %s production binding", (location) => {
    const row = binding();
    const projectEnv = { envs: location === "project" ? [row] : [] };
    const sharedEnv = shared(location === "shared" ? [row] : []);
    const { outcomeFlag, ...legacy } = modularProductionSettings(project, projectEnv, sharedEnv);
    expect(outcomeFlag).toEqual({
      key, configured: true, id: row.id, type: "encrypted", updatedAt: 2000,
    });
    expect(legacy).toEqual(productionSettings(project, projectEnv, sharedEnv));
    expect(legacy.flags).toHaveLength(7);
    expect(legacy.valuesRead).toBe(false);
  });

  it.each(["preview", "development"])("does not mistake a %s binding for production", (target) => {
    const row = binding();
    row.target = [target];
    expect(modularProductionSettings(project, { envs: [row] }, shared()).outcomeFlag)
      .toEqual({ key, configured: false });
  });

  it("detects binding metadata changes without treating configured as enabled", () => {
    const row = binding();
    const before = modularProductionSettings(project, { envs: [row] }, shared());
    row.updatedAt++;
    const after = modularProductionSettings(project, { envs: [row] }, shared());
    expect(after).not.toEqual(before);
    expect(after.outcomeFlag).not.toHaveProperty("enabled");
    expect(after.outcomeFlag).not.toHaveProperty("value");
  });

  it("rejects duplicate or branch-specific production bindings", () => {
    const duplicate = binding();
    duplicate.id = "secondOutcomeFlag";
    expect(() => modularProductionSettings(project, { envs: [binding()] }, shared([duplicate])))
      .toThrow("production_bindings");
    const branchSpecific = binding();
    Object.defineProperty(branchSpecific, "gitBranch", { value: "feature" });
    expect(() => modularProductionSettings(project, { envs: [branchSpecific] }, shared()))
      .toThrow("metadata_entry_invalid");
  });

  it.each([
    [{ envs: [], hiddenProductionEnvCount: 1 }, shared()],
    [{ envs: [], pagination: { count: 0, next: 1 } }, shared()],
    [{ envs: [] }, { data: [], pagination: { count: 0, next: 1 } }],
    [{ envs: [] }, { data: [] }],
  ])("refuses incomplete metadata instead of reporting absence", (projectEnv, sharedEnv) => {
    expect(() => modularProductionSettings(project, projectEnv, sharedEnv)).toThrow();
  });

  it("does not retain raw values or malformed-response content", () => {
    const canary = "PrivateSyntheticCanary";
    const row = { id: "synthetic", key, type: "encrypted", target: ["production"],
      createdAt: 1000, updatedAt: 2000, value: canary };
    expect(JSON.stringify(modularProductionSettings(project, { envs: [row] }, shared())))
      .not.toContain(canary);
    row.type = canary;
    try {
      modularProductionSettings(project, { envs: [row] }, shared());
      throw new Error("Expected metadata rejection");
    } catch (error) {
      expect(String(error)).toContain("metadata_entry_invalid");
      expect(String(error)).not.toContain(canary);
    }
  });
});
