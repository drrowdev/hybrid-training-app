import { describe, expect, it } from "vitest";
import { productionContext, productionDispatch, productionProfile, PRODUCTION_POST_UPDATE,
  PRODUCTION_RECONCILIATION } from "../swim-production-readonly-guards";
import { verifyRefreshSource } from "../refresh-swim-review";
import { POST_UPDATE_CATALOG_SQL, productionPostUpdateInventory, SHARED_PRE_FIELDS } from "../swim-production-post-update";
import { productionSchemaInventory, SWIM_SCHEMA_TABLES, SWIM_SCHEMA_FUNCTIONS } from "../swim-production-reconciliation";
import { PRODUCTION_SWIM_BASELINE } from "../swim-production-update-storage";
import { REVIEW } from "../swim-review-config-plan";

const sha = "c".repeat(40);
const env = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REPOSITORY: REVIEW.repository,
  GITHUB_REF: `refs/heads/${REVIEW.branch}`, GITHUB_REF_TYPE: "branch", GITHUB_JOB: PRODUCTION_POST_UPDATE.job,
  GITHUB_SHA: sha, EXPECTED_SHA: sha, GITHUB_RUN_ID: "34809000000", GITHUB_RUN_ATTEMPT: "1",
  INSPECT_SWIM_PRODUCTION: "true", PRODUCTION_READONLY_SCOPE: "post_update",
  ...Object.fromEntries(PRODUCTION_POST_UPDATE.otherOperations.map((key) => [key, "false"])),
};
const inputs = {
  expected_sha: sha, inspect_swim_production: "true", production_readonly_scope: "post_update",
  review_upgrade_read_only: "true", accept_legacy_swim_history: "false",
  ...Object.fromEntries(PRODUCTION_POST_UPDATE.otherOperations.map((key) => [key.toLowerCase(), "false"])),
};
const history = { complete: true, rowsRead: 203, fingerprint: PRODUCTION_SWIM_BASELINE.fingerprint };
const schema = () => productionSchemaInventory(
  SWIM_SCHEMA_TABLES.map((name) => ({ name, present: false, rls: null, forced: null, owner_uuid: false,
    columns: 0, policies: 0, foreign_keys: 0 })),
  SWIM_SCHEMA_FUNCTIONS.map((name) => ({ name, definitions: 0 })),
  [{ swim_result: false, completion_body: "before", movement_keys: [
    { name: "session_movements_movement_id_fkey", deferrable: false, deferred: false, validated: true, deleteAction: "r" },
    { name: "set_logs_movement_id_fkey", deferrable: false, deferred: false, validated: true, deleteAction: "r" },
  ] }],
);
const rows = () => [{
  shared_present: true, writer_present: false, swim_objects: false, swim_routines: false,
  shared_attributes: Array<boolean>(23).fill(true), shared_acl_counts: [1, 1, 1, 1, 1, 0, 0],
  shared_acl_options: true, shared_privileges: [true, true, true, true], other_default_grants: 0, default_grant_options: 0,
}];

describe("DC-SW8 post-update diagnosis remains read-only", () => {
  it("uses a separate fixed deployed-main profile without changing historical references", () => {
    expect(productionProfile(env)).toBe(PRODUCTION_POST_UPDATE);
    expect(productionContext(env)).toBe(sha);
    expect(productionDispatch(inputs, env)).toBe(true);
    expect(PRODUCTION_RECONCILIATION.expectedMain).toBeUndefined();
    const io = {
      regular: () => true, event: () => ({ inputs }),
      git: (...args: string[]) => {
        if (args[0] === "rev-parse") return sha;
        if (args[0] === "status" || args[0] === "merge-base") return "";
        if (args[0] === "diff") return "packages/db/scripts/inspect-swim-production.ts";
        if (args[0] === "ls-tree") return `100644 blob ${"a".repeat(40)}\tpackages/db/scripts/inspect-swim-production.ts`;
        if (args[0] === "ls-remote") return `${args.at(-1) === "refs/heads/main" ? PRODUCTION_POST_UPDATE.expectedMain : sha}\t${args.at(-1)}`;
        throw new Error("unexpected_git_command");
      },
    };
    verifyRefreshSource(env, io, PRODUCTION_POST_UPDATE);
    expect(() => verifyRefreshSource(env, io, PRODUCTION_RECONCILIATION)).toThrow();
    expect(() => verifyRefreshSource(env, io, { ...PRODUCTION_POST_UPDATE, expectedMain: "d".repeat(40) })).toThrow();
    expect(() => productionContext({ ...env, GITHUB_REF: "refs/heads/main" })).toThrow();
    for (const key of PRODUCTION_POST_UPDATE.otherOperations) {
      expect(() => productionDispatch({ ...inputs, [key.toLowerCase()]: "true" }, env)).toThrow();
    }
    expect(() => productionDispatch({ ...inputs, accept_legacy_swim_history: "true" }, env)).toThrow();
  });
  it("requires the complete original history and every pre-update schema condition to verify rollback", () => {
    const result = productionPostUpdateInventory(rows(), history, schema());
    expect(result.rollbackVerified).toBe(true);
    expect(result.updaterRetryAuthorized).toBe(false);
    for (const changed of [{ ...history, complete: false }, { ...history, rowsRead: 205 },
      { ...history, fingerprint: "d".repeat(64) }]) {
      expect(productionPostUpdateInventory(rows(), changed, schema()).rollbackVerified).toBe(false);
    }
    for (const field of ["writer_present", "swim_objects", "swim_routines"] as const) {
      const changed = rows(); changed[0]![field] = true;
      expect(productionPostUpdateInventory(changed, history, schema()).rollbackVerified).toBe(false);
    }
    const changed = schema(); changed.shared.completion_body = "after";
    expect(productionPostUpdateInventory(rows(), history, changed).rollbackVerified).toBe(false);
  });
  it("reports fixed attribute and permission differences without changing or inferring permission policy", () => {
    expect(SHARED_PRE_FIELDS).toHaveLength(23);
    const changed = rows(); changed[0]!.shared_attributes[SHARED_PRE_FIELDS.indexOf("sharedConfig")] = false;
    changed[0]!.shared_acl_counts[3] = 0;
    const result = productionPostUpdateInventory(changed, history, schema());
    expect(result.sharedAttributes?.sharedConfig).toBe(false);
    expect(result.sharedAclCounts.anon).toBe(0);
    expect(result.sharedPrivileges?.anon).toBe(true);
    expect(result.rollbackVerified).toBe(true);
    expect(result.updaterRetryAuthorized).toBe(false);
  });
  it("rejects extra data and limits the SQL to catalogue reads", () => {
    expect(() => productionPostUpdateInventory([{ ...rows()[0], private: "PrivateSyntheticCanary" }],
      history, schema())).toThrow("post_update_shape");
    expect(() => productionPostUpdateInventory([{ ...rows()[0], shared_acl_counts: [129] }],
      history, schema())).toThrow("post_update_shape");
    expect(POST_UPDATE_CATALOG_SQL).not.toMatch(/(?:FROM|JOIN)\s+(?:public|auth)\.|\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|CREATE)\b|pg_stat/i);
    expect(POST_UPDATE_CATALOG_SQL).not.toContain("pg_get_functiondef");
  });
});
