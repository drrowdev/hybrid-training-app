import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { describe, expect, it, vi } from "vitest";
import {
  APPLICATION_SHA, SETUP_PATHS, assertPristine, defaultRuntime, emitEvidence, prepareReview,
  runSeed, validateContext, validateDatabaseUrl, validateSourceDiff, type Runtime,
} from "../prepare-swim-review";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(), spawn: vi.fn(),
}));
vi.mock("node:fs", async (original) => ({
  ...await original<typeof import("node:fs")>(), appendFileSync: vi.fn(),
}));

const root = resolve(import.meta.dirname, "../../../..");
const password = encodeURIComponent(["offline", "unit", "only", "42"].join("-"));
const url = `postgresql://postgres.whwilnhqfiaquwxgkxwt:${password}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`;
const pristine = {
  publicEmpty: true, ledgerAbsent: true, schemasExpected: true,
  publicCodeEmpty: true, usersEmpty: true, storageEmpty: true, visible: true,
};
const absentPlatform = {
  present: false, ownerExpected: false, relationsEmpty: true, typesEmpty: true, oneRoutine: false,
  signatureExpected: false, languageExpected: false, securityDefiner: false, searchPathEmpty: false,
  publicExecuteRevoked: false, pgbouncerExecuteGranted: false,
};
const validPlatform = Object.fromEntries(Object.keys(absentPlatform).map((key) => [key, true]));
const sha = "a".repeat(40);
const context = {
  GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REPOSITORY: "drrowdev/hybrid-training-app", GITHUB_REF_TYPE: "branch",
  GITHUB_REF: "refs/heads/copilot/new-acceptance-cases", GITHUB_JOB: "prepare-swim-review",
  PREPARE_SWIM_REVIEW: "true", INSPECT_SWIM_REVIEW: "false", MIGRATE_PRODUCTION: "false",
  ALLOW_UNDEPLOYED: "false", SWIM_ACCEPTANCE: "false", EXPECTED_SHA: sha, GITHUB_SHA: sha,
};
const canonical = Array.from({ length: 150 }, (_, i) => ({ hash: `${i}`, folderMillis: i + 1 }));
function fake() {
  const query = vi.fn(async (text: string, _parameters?: Parameters<ReturnType<Runtime["connect"]>["query"]>[1]): Promise<Record<string, unknown>[]> => {
    if (text.includes('AS "publicEmpty"')) return [
      { ...pristine, unexpectedNamespaces: 0, postgresOwnedRelations: 0, pgbouncer: absentPlatform },
    ];
    if (text.includes("auth.users")) return [{ usersEmpty: true, storageEmpty: true }];
    if (text.includes('AS "extensionMember"')) return [];
    if (text.includes("ORDER BY id")) return canonical.map((m, i) =>
      ({ id: i + 1, hash: m.hash, created_at: m.folderMillis }));
    if (text.includes("AS global")) return [{ global: 334, seeded: 330, ready: true }];
    if (text.includes("c.relname AS name")) return [{ name: "movements" }, { name: "sessions" }];
    return [{ empty: true }];
  });
  const close = vi.fn(async () => {});
  const runtime: Runtime = {
    source: vi.fn(), canonical: vi.fn(() => canonical),
    connect: vi.fn(() => ({ query, close })),
    migrate: vi.fn(async () => {}), seed: vi.fn(async () => {}), emit: vi.fn(),
  };
  return { runtime, query, close };
}

describe("isolated review guards (offline, not hosted proof)", () => {
  it("accepts only the exact test route", () => expect(validateDatabaseUrl(url)).toBe(url));
  it.each([
    undefined, "", url.replace("whwilnhqfiaquwxgkxwt", "grhetczkxawkcfgkwerj"),
    url.replace("aws-0-eu-north-1", "aws-0-eu-west-1"),
    url.replace(":5432/", ":6543/"), url.replace("/postgres?", "/other?"),
    url.replace("postgres.whwilnhqfiaquwxgkxwt", "postgres"),
    url.replace("postgresql:", "http:"), url.replace(password, ""),
    url.replace(password, "placeholder-password"), url.replace(password, "%0A" + password),
    url.replace(password, "%ZZ"), url + "#fragment", " " + url,
    url + "&host=localhost", url + "&sslmode=disable", url + "&options=-c",
    url.replace("require", "disable"), url.replace("?sslmode=require", ""),
    url.replace(":5432", ""), url.replace(password, "%6F" + password.slice(1)),
    url.replace("aws-0", "AWS-0"), url.replace("/postgres", "/x/../postgres"),
    url.replace(password, "your-secret-goes-here"),
  ])("refuses unsafe credentials without connecting: %s", (value) => {
    expect(() => validateDatabaseUrl(value)).toThrow();
  });
  it.each(Object.keys(context))("fails closed on missing or changed %s", (key) => {
    for (const inspect of [false, true]) {
      const mode = { ...context, PREPARE_SWIM_REVIEW: String(!inspect), INSPECT_SWIM_REVIEW: String(inspect) };
      expect(validateContext(mode)).toBe(inspect);
      expect(() => validateContext({ ...mode, [key]: "" })).toThrow();
      expect(() => validateContext({ ...mode, [key]: "wrong" })).toThrow();
    }
  });
  it.each(["true", "false"])("rejects both review modes set to %s", (value) => {
    expect(() => validateContext({
      ...context, PREPARE_SWIM_REVIEW: value, INSPECT_SWIM_REVIEW: value,
    })).toThrow();
  });
  it.each([
    { GITHUB_REF: "refs/heads/main" }, { GITHUB_REF_TYPE: "tag" },
    { GITHUB_REPOSITORY: "fork/hybrid-training-app" }, { GITHUB_EVENT_NAME: "push" },
    { EXPECTED_SHA: APPLICATION_SHA, GITHUB_SHA: APPLICATION_SHA },
  ])("rejects non-review source contexts", (override) => {
    expect(() => validateContext({ ...context, ...override })).toThrow();
  });
  it("confines the accepted application diff to four setup paths", () => {
    expect(() => validateSourceDiff([...SETUP_PATHS])).not.toThrow();
    for (const paths of [[], ["packages/db/package.json"], ["packages/db/drizzle/0149.sql"],
      ["apps/web/src/app/page.tsx"], ["HANDOFF.md", "pnpm-lock.yaml"]]) {
      expect(() => validateSourceDiff(paths)).toThrow();
    }
  });
  it.each(Object.keys(pristine))("requires exact readable true for %s", (key) => {
    for (const value of [false, null, undefined, 1, "true"]) {
      expect(() => assertPristine({ ...pristine, [key]: value })).toThrow();
    }
  });
  it("refuses newer migrations in the spent 150-file bootstrap profile", () => {
    expect(() => defaultRuntime().canonical()).toThrow();
  });
});

describe("bounded phase evidence and connection cleanup", () => {
  it("executes ordered phases and closes on success", async () => {
    const { runtime, close } = fake();
    expect(await prepareReview(url, runtime)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(vi.mocked(runtime.emit).mock.calls.map(([r]) => [r.phase, r.status])).toEqual(
      ["source", "credentials", "canonical", "client", "preflight", "migrate", "seed", "verify", "close"]
        .map((phase) => [phase, "passed"]));
  });
  it.each(["source", "canonical", "connect", "migrate", "seed"] as const)(
    "redacts raw %s failures and never proceeds to later writes", async (phase) => {
      const { runtime, close } = fake();
      vi.mocked(runtime[phase]).mockImplementation(() => { throw new Error(`private SQL ${url}`); });
      expect(await prepareReview(url, runtime)).toBe(false);
      expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain("private SQL");
      expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain(password);
      expect(close).toHaveBeenCalledTimes(phase === "migrate" || phase === "seed" ? 1 : 0);
      if (phase !== "seed") expect(runtime.seed).not.toHaveBeenCalled();
    });
  it("does not connect with invalid credentials", async () => {
    const { runtime } = fake();
    expect(await prepareReview(undefined, runtime)).toBe(false);
    expect(runtime.connect).not.toHaveBeenCalled();
  });
  it.each(Object.keys(pristine))("blocks writes on existing/ambiguous %s", async (key) => {
    const { runtime, query, close } = fake();
    query.mockResolvedValue([{ ...pristine, unexpectedNamespaces: key === "schemasExpected" ? 1 : 0,
      postgresOwnedRelations: 0, [key]: false }]);
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(runtime.migrate).not.toHaveBeenCalled();
    expect(runtime.seed).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
  });
  it("fails closed on unreadable preflight and closes without raw errors", async () => {
    const { runtime, query, close } = fake();
    query.mockRejectedValue(new Error(`private rows ${url}`));
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(runtime.migrate).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).not.toContain("private");
  });
  it.each(["hash", "order", "count", "ready", "catalog", "users", "storage", "application"])(
    "fails postflight on mismatched %s and preserves partial setup for inspection", async (kind) => {
      const { runtime, query, close } = fake();
      const original = query.getMockImplementation()!;
      query.mockImplementation(async (text) => {
        const rows = await original(text);
        if (text.includes("ORDER BY id")) {
          if (kind === "hash") rows[0]!.hash = "wrong";
          if (kind === "order") rows.reverse();
          if (kind === "count") rows.pop();
        }
        if (text.includes("AS global")) {
          if (kind === "ready") rows[0]!.ready = "true";
          if (kind === "catalog") rows[0]!.global = 330;
        }
        if (vi.mocked(runtime.seed).mock.calls.length && text.includes("auth.users")) {
          if (kind === "users") rows[0]!.usersEmpty = false;
          if (kind === "storage") rows[0]!.storageEmpty = false;
        }
        if (kind === "application" && text.includes("AS empty")) rows[0]!.empty = false;
        return rows;
      });
      expect(await prepareReview(url, runtime)).toBe(false);
      expect(runtime.seed).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
      expect(query.mock.calls.every(([sql]) => !/DELETE|TRUNCATE|DROP|UPDATE/.test(sql))).toBe(true);
    });
  it("reports shutdown failure as failure, not success", async () => {
    const { runtime, close } = fake();
    close.mockRejectedValue(new Error(url));
    expect(await prepareReview(url, runtime)).toBe(false);
    expect(vi.mocked(runtime.emit).mock.calls.at(-1)![0]).toMatchObject({ phase: "close", status: "failed" });
  });
  it("aborts a stalled phase, closes the connection and never starts a later write", async () => {
    vi.useFakeTimers();
    try {
      const { runtime, close } = fake();
      vi.mocked(runtime.migrate).mockImplementation(() => new Promise(() => {}));
      const result = prepareReview(url, runtime);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(await result).toBe(false);
      expect(close).toHaveBeenCalledOnce();
      expect(runtime.seed).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe("read-only pristine inspection (fake runtime, not hosted proof)", () => {
  function evidence(runtime: Runtime) {
    return vi.mocked(runtime.emit).mock.calls.map(([record]) => record)
      .find((record) => record.phase === "preflight")!;
  }
  function noWrites(runtime: Runtime) {
    expect(runtime.migrate).not.toHaveBeenCalled();
    expect(runtime.seed).not.toHaveBeenCalled();
    expect(vi.mocked(runtime.emit).mock.calls.every(([r]) => r.mode === "read-only")).toBe(true);
  }
  it("observes the two existing reads and one bounded metadata read, never setup", async () => {
    const { runtime, query, close } = fake();
    expect(await prepareReview(url, runtime, true)).toBe(true);
    noWrites(runtime);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([sql]) => /^\s*SELECT/.test(sql))).toBe(true);
    expect(evidence(runtime)).toEqual({
      phase: "preflight", status: "passed", mode: "read-only",
      inspection: {
        predicates: pristine, schemaCounts: { unexpectedNamespaces: 0, postgresOwnedRelations: 0 },
        unexpectedSchemas: { status: "empty", entries: [] },
        pgbouncer: absentPlatform,
      },
    });
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(Object.keys(pristine))("reports failed %s as failure without writes", async (key) => {
    const { runtime, query, close } = fake();
    query.mockResolvedValue([{ ...pristine, unexpectedNamespaces: key === "schemasExpected" ? 1 : 0,
      postgresOwnedRelations: 0, [key]: false }]);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime).inspection!.predicates[key as keyof typeof pristine]).toBe(false);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["unexpectedNamespaces", "postgresOwnedRelations"] as const)(
    "preserves bounded %s evidence alongside namespace metadata", async (key) => {
      const { runtime, query, close } = fake();
      query.mockResolvedValueOnce([{ ...pristine, unexpectedNamespaces: 0, postgresOwnedRelations: 0, [key]: 1000 }]);
      expect(await prepareReview(url, runtime, true)).toBe(false);
      expect(evidence(runtime).inspection!.schemaCounts[key]).toBe(1000);
      expect(evidence(runtime).inspection!.predicates.schemasExpected).toBe(false);
      expect(query.mock.calls[0]![0].match(/LIMIT 1000/g)).toHaveLength(2);
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    });
  const namespace = {
    name: "offline_namespace", owner: "other", relations: 0, routines: 1, types: 1000,
    extensionMember: false,
  };
  function metadataFake(rows: Record<string, unknown>[], expected = rows.length) {
    const state = fake();
    state.query
      .mockResolvedValueOnce([{ ...pristine, unexpectedNamespaces: expected, postgresOwnedRelations: 0 }])
      .mockResolvedValueOnce([{ usersEmpty: true, storageEmpty: true }])
      .mockResolvedValueOnce(rows);
    return state;
  }
  function platformFake(platform: unknown = validPlatform, extraNamespace = false) {
    const state = fake();
    const original = state.query.getMockImplementation()!;
    state.query.mockImplementation(async (sql, parameters) => {
      if (sql.includes('AS "publicEmpty"')) return [{
        ...pristine, unexpectedNamespaces: extraNamespace ? 2 : 1,
        postgresOwnedRelations: 0, pgbouncer: platform,
      }];
      if (sql.includes('AS "extensionMember"')) return [
        ...(parameters?.[0] === true ? [] : [{ ...namespace, name: "pgbouncer", types: 0 }]),
        ...(extraNamespace ? [namespace] : []),
      ];
      return original(sql, parameters);
    });
    return state;
  }
  it("recognizes only the documented pgbouncer shape in both the count and namespace list", async () => {
    const { runtime, query, close } = platformFake();
    expect(await prepareReview(url, runtime, true)).toBe(true);
    expect(evidence(runtime).inspection).toEqual({
      predicates: pristine, pgbouncer: validPlatform,
      schemaCounts: { unexpectedNamespaces: 0, postgresOwnedRelations: 0 },
      unexpectedSchemas: { status: "empty", entries: [] },
    });
    expect(query.mock.calls[2]![1]).toEqual([true]);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([true, false])("binds native %s through the installed driver's boolean serializer offline", async (recognized) => {
    const sql = postgres({ host: "127.0.0.1", max: 1 });
    try {
      const serialize = sql.options.serializers[16]!;
      const { runtime, query, close } = platformFake({ ...validPlatform, ownerExpected: recognized });
      expect(await prepareReview(url, runtime, true)).toBe(recognized);
      const parameters = query.mock.calls.find(([text]) => text.includes('AS "extensionMember"'))![1]!;
      expect(parameters).toEqual([recognized]);
      expect(serialize(parameters[0])).toBe(recognized ? "t" : "f");
      expect(serialize("true")).toBe("f");
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      await sql.end({ timeout: 0 });
    }
  });
  it.each(Object.keys(validPlatform).filter((key) => key !== "present"))(
    "keeps pgbouncer unexpected when %s fails", async (key) => {
      const { runtime, query, close } = platformFake({ ...validPlatform, [key]: false });
      expect(await prepareReview(url, runtime, true)).toBe(false);
      expect(evidence(runtime).inspection).toMatchObject({
        pgbouncer: { [key]: false }, predicates: { schemasExpected: false },
        schemaCounts: { unexpectedNamespaces: 1 },
        unexpectedSchemas: { status: "readable", entries: [{ name: "pgbouncer" }] },
      });
      expect(query.mock.calls[2]![1]).toEqual([false]);
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    });
  it.each(Object.keys(validPlatform))("fails closed on unreadable platform %s", async (key) => {
    for (const value of [undefined, null, "true", "<private>", 1]) {
      const { runtime, close } = platformFake({ ...validPlatform, [key]: value, arbitrary: url });
      expect(await prepareReview(url, runtime, true)).toBe(false);
      expect(evidence(runtime).inspection!.pgbouncer[key as keyof typeof absentPlatform]).toBe("unreadable");
      expect(JSON.stringify(evidence(runtime))).not.toMatch(/private|arbitrary|postgresql/);
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    }
  });
  it.each([null, "private", [], [{ ...validPlatform }]])(
    "rejects absent or ambiguous platform metadata: %j", async (platform) => {
      const { runtime, close } = platformFake(platform);
      expect(await prepareReview(url, runtime, true)).toBe(false);
      expect(Object.values(evidence(runtime).inspection!.pgbouncer)).toEqual(Array(11).fill("unreadable"));
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    });
  it("keeps additional unknown namespaces blocked beside valid pgbouncer", async () => {
    const { runtime, query } = platformFake(validPlatform, true);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime).inspection).toMatchObject({
      pgbouncer: validPlatform, schemaCounts: { unexpectedNamespaces: 1 },
      unexpectedSchemas: { status: "readable", entries: [{ name: namespace.name }] },
    });
    expect(query.mock.calls[2]![1]).toEqual([true]);
    noWrites(runtime);
  });
  it.each([0, 1000])("fails closed on inconsistent or saturated raw namespace count %s", async (raw) => {
    const { runtime, query, close } = platformFake();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, parameters) => {
      const rows = await original(sql, parameters);
      if (sql.includes('AS "publicEmpty"')) rows[0]!.unexpectedNamespaces = raw;
      return rows;
    });
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime).inspection!.schemaCounts.unexpectedNamespaces).toBe("unreadable");
    expect(evidence(runtime).inspection!.unexpectedSchemas!.status).toBe("invalid");
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["visible", "publicEmpty", "ledgerAbsent", "publicCodeEmpty", "usersEmpty",
    "storageEmpty", "postgresOwnedRelations"])("valid pgbouncer cannot bypass %s", async (key) => {
    const { runtime, query, close } = platformFake();
    const original = query.getMockImplementation()!;
    query.mockImplementation(async (sql, parameters) => {
      const rows = await original(sql, parameters);
      if (sql.includes('AS "publicEmpty"') || sql.includes("auth.users")) {
        rows[0]![key] = key === "postgresOwnedRelations" ? 1 : false;
      }
      return rows;
    });
    expect(await prepareReview(url, runtime, true)).toBe(false);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it("uses bounded catalog predicates, default ACLs, and never a deployed body or function call", async () => {
    const { runtime, query } = platformFake();
    expect(await prepareReview(url, runtime, true)).toBe(true);
    const sql = query.mock.calls[0]![0];
    expect(sql).toContain("r.rolname = 'pgbouncer'");
    expect(sql).toContain("pg_catalog.pg_class WHERE relnamespace = n.oid");
    expect(sql).toContain("pg_catalog.pg_type WHERE typnamespace = n.oid");
    expect(sql).toContain("count(*) = 1");
    expect(sql).toContain("WHERE pronamespace = n.oid LIMIT 2");
    expect(sql).toContain("p.proname = 'get_auth' AND p.prokind = 'f' AND p.pronargs = 1");
    expect(sql).toContain("p.proargtypes[0] = 'pg_catalog.text'::regtype");
    expect(sql).toContain("p.pronargdefaults = 0 AND p.provariadic = 0");
    expect(sql).toContain("p.proallargtypes = ARRAY['pg_catalog.text'::regtype, 'pg_catalog.text'::regtype,");
    expect(sql).toContain("'pg_catalog.text'::regtype]::oid[]");
    expect(sql).toContain("p.proargmodes = ARRAY['i', 't', 't']::\"char\"[]");
    expect(sql).toContain("p.proargnames = ARRAY['p_usename', 'username', 'password']");
    expect(sql).toContain("p.proretset AND p.prorettype = 'pg_catalog.record'::regtype");
    expect(sql).toContain("l.lanname = 'plpgsql'");
    expect(sql).toContain("COALESCE(p.prosecdef, false)");
    expect(sql).toContain("p.proconfig = ARRAY['search_path=\"\"'] OR p.proconfig = ARRAY['search_path=']");
    expect(sql.match(/pg_catalog\.aclexplode\(COALESCE\(p\.proacl, pg_catalog\.acldefault\('f', p\.proowner\)\)\)/g)).toHaveLength(2);
    expect(sql).toContain("a.grantee = 0 AND a.privilege_type = 'EXECUTE'");
    expect(sql).toContain("grantee.rolname = 'pgbouncer' AND a.privilege_type = 'EXECUTE'");
    expect(sql).not.toMatch(/p\.proowner\s*=|pg_shadow|prosrc|prosqlbody|pg_get_|pgbouncer\.get_auth\s*\(/);
    expect(query.mock.calls[2]![0]).toContain("NOT ($1::boolean AND n.nspname = 'pgbouncer')");
    expect(query.mock.calls.every(([text]) => /^\s*SELECT/.test(text))).toBe(true);
    noWrites(runtime);
  });
  it("records the one-namespace metadata before rejecting the unchanged pristine guard", async () => {
    const { runtime, query, close } = metadataFake([namespace]);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime)).toMatchObject({
      phase: "preflight", status: "failed",
      inspection: {
        predicates: { ...pristine, schemasExpected: false },
        schemaCounts: { unexpectedNamespaces: 1, postgresOwnedRelations: 0 },
        unexpectedSchemas: {
          status: "readable", entries: [{
            name: namespace.name, owner: "other",
            relations: { count: 0, saturated: false },
            routines: { count: 1, saturated: false },
            types: { count: 1000, saturated: true },
            extensionMember: false,
          }],
        },
      },
    });
    const sql = query.mock.calls[2]![0];
    const namespaceFilter = (text: string) => text.match(
      /(?:n\.)?nspname NOT IN \([\s\S]*?AND (?:n\.)?nspname NOT LIKE 'pg_toast_temp_%'/,
    )![0].replace(/\bn\./g, "").replace(/\s+/g, " ");
    expect(namespaceFilter(sql)).toBe(namespaceFilter(query.mock.calls[0]![0]));
    expect(sql).toMatch(/ORDER BY n\.oid LIMIT 17/);
    expect(sql.match(/LIMIT 1000/g)).toHaveLength(3);
    expect(sql).toContain("ELSE 'other' END AS owner");
    expect(sql).toContain("ELSE NULL END AS name");
    expect(sql).toContain("d.refclassid = 'pg_catalog.pg_extension'::regclass");
    expect(sql).not.toMatch(/auth\.|storage\.|public\.|\b(?:relname|proname|typname)\b|pg_get_|INSERT|UPDATE|DELETE|CREATE/);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["postgres", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin", "other"])(
    "allows only the fixed owner category %s and explicit saturation", async (owner) => {
      const { runtime, close } = metadataFake([{
        ...namespace, name: "_" + "a".repeat(62), owner, relations: 1000, routines: 999,
        types: 0, extensionMember: true, arbitrary: url,
      }]);
      expect(await prepareReview(url, runtime, true)).toBe(false);
      expect(evidence(runtime).inspection!.unexpectedSchemas).toMatchObject({
        status: "readable", entries: [{
          owner, relations: { count: 1000, saturated: true },
          routines: { count: 999, saturated: false }, types: { count: 0, saturated: false },
          extensionMember: true,
        }],
      });
      expect(JSON.stringify(evidence(runtime))).not.toMatch(/arbitrary|postgresql|offline-unit/);
      noWrites(runtime);
      expect(close).toHaveBeenCalledOnce();
    });
  it.each([
    ...["", "A", "0name", "a-b", "a.b", "<private>", "a".repeat(64), "a\n", "a\r", "a\u2028",
      "a\u2029", null, undefined, 1].map((name) => ({ name })),
    ...["private_role", "", null, 1].map((owner) => ({ owner })),
    ...["relations", "routines", "types"].flatMap((key) =>
      [-1, 1001, 1.5, "1", null, undefined, NaN, Infinity].map((value) => ({ [key]: value }))),
    ...["true", 1, null, undefined].map((extensionMember) => ({ extensionMember })),
  ])("rejects invalid namespace fields without unchecked text: %j", async (override) => {
    const { runtime, close } = metadataFake([{ ...namespace, ...override }]);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime).inspection!.unexpectedSchemas).toEqual({ status: "invalid", entries: [] });
    expect(evidence(runtime).inspection!.predicates).toEqual({ ...pristine, schemasExpected: false });
    expect(JSON.stringify(evidence(runtime))).not.toMatch(/private|postgresql/);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([16, 17])("bounds namespace results at sixteen, observing %s rows", async (size) => {
    const { runtime, close } = metadataFake(Array.from({ length: size }, (_, i) =>
      ({ ...namespace, name: `offline_${i}` })));
    expect(await prepareReview(url, runtime, true)).toBe(false);
    const metadata = evidence(runtime).inspection!.unexpectedSchemas!;
    expect(metadata.status).toBe(size === 16 ? "readable" : "overflow");
    expect(metadata.entries).toHaveLength(size === 16 ? 16 : 0);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([
    { rows: [], expected: 1 }, { rows: [namespace], expected: 0 },
    { rows: [namespace, namespace], expected: 2 },
  ])("fails closed on inconsistent or duplicate namespace results", async ({ rows, expected }) => {
    const { runtime, close } = metadataFake(rows, expected);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime).inspection!.unexpectedSchemas).toEqual({ status: "invalid", entries: [] });
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it("retains all known predicates on a metadata read error", async () => {
    const { runtime, query, close } = fake();
    query.mockResolvedValueOnce([{ ...pristine, unexpectedNamespaces: 1, postgresOwnedRelations: 0 }])
      .mockResolvedValueOnce([{ usersEmpty: true, storageEmpty: true }])
      .mockRejectedValueOnce(Object.assign(new Error(`private ${url}`), {
        name: "PostgresError", severity: "ERROR", code: "42501",
      }));
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(evidence(runtime)).toMatchObject({
      status: "failed", code: { sqlstate: "42501" },
      inspection: {
        predicates: { ...pristine, schemasExpected: false },
        schemaCounts: { unexpectedNamespaces: 1, postgresOwnedRelations: 0 },
        unexpectedSchemas: { status: "unreadable", entries: [] },
      },
    });
    expect(JSON.stringify(evidence(runtime))).not.toMatch(/private|postgresql|offline/);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it("never queries or emits namespace metadata in write mode", async () => {
    const { runtime, query } = fake();
    expect(await prepareReview(url, runtime)).toBe(true);
    expect(query.mock.calls.some(([sql]) => sql.includes('AS "extensionMember"'))).toBe(false);
    expect(vi.mocked(runtime.emit).mock.calls.every(([record]) => record.inspection === undefined)).toBe(true);
  });
  it.each([0, 1])("keeps unreadable predicates and safe codes when probe %s fails", async (probe) => {
    const { runtime, query, close } = fake();
    if (probe === 1) query.mockResolvedValueOnce([{ ...pristine, unexpectedNamespaces: 0, postgresOwnedRelations: 0 }]);
    query.mockRejectedValueOnce(Object.assign(new Error(`private ${url}`), {
      name: "PostgresError", severity: "ERROR", code: "42501",
    }));
    expect(await prepareReview(url, runtime, true)).toBe(false);
    const record = evidence(runtime);
    expect(record.code?.sqlstate).toBe("42501");
    expect(record.inspection!.predicates).toEqual(probe === 0 ?
      Object.fromEntries(Object.keys(pristine).map((key) => [key, "unreadable"])) :
      { ...pristine, usersEmpty: "unreadable", storageEmpty: "unreadable" });
    expect(JSON.stringify(record)).not.toMatch(/private|postgresql|offline/);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([null, undefined, "true", "<private>", 1])("projects non-booleans as unreadable: %s", async (value) => {
    const { runtime, query, close } = fake();
    query.mockResolvedValue([{ ...Object.fromEntries(Object.keys(pristine).map((key) => [key, value])),
      unexpectedNamespaces: "<private>", postgresOwnedRelations: -1, arbitrary: url }]);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    const inspection = evidence(runtime).inspection!;
    expect(inspection.predicates).toEqual(Object.fromEntries(Object.keys(pristine).map((key) => [key, "unreadable"])));
    expect(inspection.schemaCounts).toEqual({ unexpectedNamespaces: "unreadable", postgresOwnedRelations: "unreadable" });
    expect(JSON.stringify(inspection)).not.toMatch(/private|arbitrary|postgresql/);
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([{ rows: [] }, { rows: [{}, {}] }])("does not fabricate evidence for ambiguous row counts", async ({ rows }) => {
    const { runtime, query, close } = fake();
    query.mockResolvedValue(rows);
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(Object.values(evidence(runtime).inspection!.predicates)).toEqual(Array(7).fill("unreadable"));
    noWrites(runtime);
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(["source", "canonical", "connect"] as const)("blocks inspection on failed %s guard", async (key) => {
    const { runtime, query } = fake();
    vi.mocked(runtime[key]).mockImplementation(() => { throw new Error(url); });
    expect(await prepareReview(url, runtime, true)).toBe(false);
    noWrites(runtime);
    expect(query).not.toHaveBeenCalled();
  });
  it("does not connect inspection to a forbidden target", async () => {
    const { runtime } = fake();
    expect(await prepareReview(url.replace("whwilnhqfiaquwxgkxwt", "grhetczkxawkcfgkwerj"), runtime, true)).toBe(false);
    expect(runtime.connect).not.toHaveBeenCalled();
    noWrites(runtime);
  });
  it.each([0, 1, 2])("closes after timeout at probe %s without late reads or writes", async (probe) => {
    vi.useFakeTimers();
    try {
      const { runtime, query, close } = fake();
      if (probe >= 1) query.mockResolvedValueOnce([{ ...pristine, unexpectedNamespaces: 0, postgresOwnedRelations: 0 }]);
      if (probe === 2) query.mockResolvedValueOnce([{ usersEmpty: true, storageEmpty: true }]);
      let finish!: (rows: Record<string, unknown>[]) => void;
      query.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      const result = prepareReview(url, runtime, true);
      await vi.advanceTimersByTimeAsync(300_000);
      expect(await result).toBe(false);
      const before = JSON.stringify(vi.mocked(runtime.emit).mock.calls);
      expect(evidence(runtime).inspection!.predicates.usersEmpty).toBe(probe === 2 ? true : "unreadable");
      expect(evidence(runtime).inspection!.unexpectedSchemas).toEqual({ status: "unreadable", entries: [] });
      finish([pristine]);
      await vi.advanceTimersByTimeAsync(1);
      expect(JSON.stringify(vi.mocked(runtime.emit).mock.calls)).toBe(before);
      expect(query).toHaveBeenCalledTimes(probe + 1);
      expect(close).toHaveBeenCalledOnce();
      noWrites(runtime);
    } finally { vi.useRealTimers(); }
  });
  it("fails inspection on closure failure", async () => {
    const { runtime, close } = fake();
    close.mockRejectedValue(new Error(url));
    expect(await prepareReview(url, runtime, true)).toBe(false);
    expect(close).toHaveBeenCalledOnce();
    noWrites(runtime);
  });
  it.each([namespace, { ...namespace, name: "<private>&\n" }])(
    "emits only projected namespace metadata through the existing escaped summary", async (row) => {
      vi.stubEnv("GITHUB_STEP_SUMMARY", "/tmp/swim-review-summary-test");
      const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(appendFileSync).mockClear();
      try {
        const { runtime, close } = metadataFake([row]);
        runtime.emit = vi.fn(emitEvidence);
        expect(await prepareReview(url, runtime, true)).toBe(false);
        const lines = stdout.mock.calls.map(([line]) => line as string);
        expect(lines.join("")).not.toMatch(/private|postgresql|offline-unit/);
        expect(evidence(runtime).inspection!.unexpectedSchemas!.status).toBe(
          row === namespace ? "readable" : "invalid");
        expect(vi.mocked(appendFileSync).mock.calls.map(([, data]) => data)).toEqual(
          lines.map((line) => `<pre>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`));
        noWrites(runtime);
        expect(close).toHaveBeenCalledOnce();
      } finally { stdout.mockRestore(); vi.unstubAllEnvs(); }
    });
  it("uses the same safe records on stdout and the escaped step summary", async () => {
    vi.stubEnv("GITHUB_STEP_SUMMARY", "/tmp/swim-review-summary-test");
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(appendFileSync).mockClear();
    try {
      const { runtime, query } = fake();
      runtime.emit = emitEvidence;
      query.mockRejectedValue(Object.assign(new Error(`<private>${url}</private>`), {
        name: "PostgresError", severity: "ERROR", code: "42501",
      }));
      expect(await prepareReview(url, runtime, true)).toBe(false);
      const lines = stdout.mock.calls.map(([line]) => line as string);
      expect(lines.join("")).not.toMatch(/private|postgresql|offline/);
      expect(vi.mocked(appendFileSync).mock.calls.map(([, data]) => data)).toEqual(
        lines.map((line) => `<pre>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>\n`));
      expect(lines.every((line) => JSON.parse(line).mode === "read-only")).toBe(true);
    } finally { stdout.mockRestore(); vi.unstubAllEnvs(); }
  });
});

describe("canonical seed subprocess boundary (fake process only)", () => {
  function child() {
    const process = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(process as unknown as ReturnType<typeof spawn>);
    return process;
  }
  it("discards all raw streams and supplies only bounded isolated connection settings", async () => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    const [, args, options] = vi.mocked(spawn).mock.calls.at(-1)!;
    expect(args).toEqual(["--import", "tsx", "seeds/run.ts"]);
    expect(options!.stdio).toBe("ignore");
    expect(Object.keys(options!.env!).sort()).toEqual(["DATABASE_URL", "PATH", "PGSSLMODE"]);
    const target = new URL(options!.env!.DATABASE_URL!);
    expect(target.searchParams.get("statement_timeout")).toBe("60000");
    expect(target.searchParams.get("connect_timeout")).toBe("10");
    expect(target.searchParams.get("client_min_messages")).toBe("error");
    process.emit("close", 0);
    await expect(result).resolves.toBeUndefined();
  });
  it.each([1, 99, null])("never treats exit %s as success", async (code) => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    process.emit("close", code);
    await expect(result).rejects.toThrow("Seed process failed");
  });
  it("suppresses raw process errors", async () => {
    const process = child();
    const result = runSeed(url, new AbortController().signal);
    process.emit("error", new Error(`private ${url}`));
    await expect(result).rejects.toThrow(/^Seed process failed$/);
  });
  it("kills a timed-out process and fails even if it subsequently reports zero", async () => {
    vi.useFakeTimers();
    try {
      const process = child();
      const result = runSeed(url, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(process.kill).toHaveBeenCalledWith("SIGKILL");
      process.emit("close", 0);
      await expect(result).rejects.toThrow("Seed deadline exceeded");
    } finally { vi.useRealTimers(); }
  });
  it("kills the child on bootstrap cancellation", async () => {
    const process = child();
    const controller = new AbortController();
    const result = runSeed(url, controller.signal);
    controller.abort();
    expect(process.kill).toHaveBeenCalledWith("SIGKILL");
    process.emit("close", null);
    await expect(result).rejects.toThrow("Seed deadline exceeded");
  });
});

describe("saved workflow and raw-stream boundaries", () => {
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8")
    .split("\n  configure-swim-review:\n")[0]!.trimEnd() + "\n";
  const job = workflow.split("\n  prepare-swim-review:\n")[1]!.split("\n  prod-migrate:")[0]!;
  const source = readFileSync(resolve(root, "packages/db/scripts/prepare-swim-review.ts"), "utf8");
  it("preserves every existing job byte-for-byte", () => {
    // Accepted APPLICATION_SHA jobs digest; also works in CI's shallow checkout.
    const existing = workflow.slice(workflow.indexOf("\njobs:")).replace(
      "\n  prepare-swim-review:\n" + job, "");
    expect(createHash("sha256").update(existing).digest("hex")).toBe(
      "f12b596a4038dae77b798b60c8b2f2ebd2486110bde61bf6b952d49e7aca6bc9");
  });
  it("requires explicit manual exact-head context and independent noncancelling serialization", () => {
    for (const gate of ["needs: [ci, identity-guard]", "github.event_name == 'workflow_dispatch'",
      "github.repository == 'drrowdev/hybrid-training-app'", "github.ref_type == 'branch'",
      "github.ref == 'refs/heads/copilot/new-acceptance-cases'",
      "inputs.expected_sha != '' && inputs.expected_sha == github.sha",
      "!inputs.migrate_production && !inputs.allow_undeployed", "!inputs.swim_acceptance",
      "ref: ${{ inputs.expected_sha }}", "environment: swim-review",
      "cancel-in-progress: false", "timeout-minutes: 7"]) expect(job).toContain(gate);
    expect(workflow).toMatch(/prepare_swim_review:\n[\s\S]*?default: false\n\s+type: boolean/);
    expect(workflow).toMatch(/inspect_swim_review:\n[\s\S]*?default: false\n\s+type: boolean/);
    expect(workflow).toContain("(inputs.prepare_swim_review || inputs.inspect_swim_review) && 'ci-swim-review-bootstrap'");
    expect(workflow).toContain("(inputs.prepare_swim_review || inputs.inspect_swim_review || inputs.swim_acceptance)");
    expect(job).toContain("((inputs.prepare_swim_review && !inputs.inspect_swim_review) ||");
    expect(job).toContain("(inputs.inspect_swim_review && !inputs.prepare_swim_review))");
    expect(job).toContain("INSPECT_SWIM_REVIEW: ${{ inputs.inspect_swim_review }}");
    expect(job).toContain("scripts/prepare-swim-review.ts ${{ inputs.inspect_swim_review && '--inspect-only' || '' }}");
    expect(source).toContain('process.argv[2] === "--inspect-only"');
    expect(source).toContain("...(inspectOnly ? { default_transaction_read_only: true } : {})");
    expect(source).toContain('git("ls-remote", "--exit-code"');
    expect(source).toContain('git("rev-parse", "HEAD") === env.EXPECTED_SHA');
  });
  it("exposes only the environment DB secret, only after installation and offline checks", () => {
    expect(job.match(/secrets\.[A-Z_]+/g)).toEqual(["secrets.SWIM_REVIEW_DATABASE_URL"]);
    expect(job.indexOf("secrets.SWIM_REVIEW_DATABASE_URL")).toBeGreaterThan(job.indexOf("--check-source"));
    expect(job).not.toMatch(/SUPABASE_PROD|E2E_|continue-on-error|retry/);
    expect(source).toContain('cwd: packageRoot, stdio: "ignore"');
    expect(source).toContain('child.kill("SIGKILL")');
    expect(source).toContain("onnotice: () => {}");
    expect(source).not.toContain("console.error");
    expect(source).not.toContain("openMigrationEvidence(");
  });
});
