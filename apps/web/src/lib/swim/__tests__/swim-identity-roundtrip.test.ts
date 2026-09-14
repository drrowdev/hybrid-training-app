import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AUTH_PRIVILEGES_SQL, SWIM_FUNCTION_ACLS_SQL, SWIM_FUNCTION_CONTRACTS,
  observeSwimFunctionAcls, projectAuthPrivilegeOutput, type PrivateCommand,
} from "../../../../scripts/swim-auth-privileges";
import {
  createIdentityRoundTripProof, enforceIdentityProofAfterRpc, IDENTITY_FILES, IDENTITY_PHASES, IDENTITY_HELPER_RPC_CASES,
  projectServiceProbe, requireIdentityHelperRpcCases, runIdentityRoundTrip, SERVICE_CASES, serviceProbeSql,
} from "../../../../scripts/swim-identity-roundtrip";
import { AcceptanceReporting, acceptanceAssert } from "../../../../scripts/swim-acceptance-reporting";

type Phase = typeof IDENTITY_PHASES[number];
type ServiceCase = typeof SERVICE_CASES[number];
const dbId = "a".repeat(64);
const success = { code: 0, signal: null, timedOut: false };
const unsafe = '<private> https://private.invalid/?key=synthetic-only\nprivate-role';
const files = Object.fromEntries(Object.values(IDENTITY_FILES).map((file) =>
  [file, readFileSync(new URL(`../../../../../../${file}`, import.meta.url), "utf8")]));
const acls = JSON.stringify(SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, "a".repeat(32)]));
const amended = (phase: Phase) => phase === "initial-148" || phase === "restored-148";
const observation = (phase: Phase) => ({
  connectionRole: "postgres", postgresSuperuser: false, postgresInherit: true,
  postgresMemberOfSupabaseAdmin: false, postgresInheritsSupabaseAdmin: false,
  postgresAuthUsage: true, postgresAuthUsageGrantOption: false,
  swimWriterAuthUsage: false, swimWriterPublicUsage: true,
  postgresAuthUidExecute: true, swimWriterAuthUidExecute: true, postgresAuthUidExecuteGrantOption: false,
  authOwner: "supabase_admin", authUidOwner: "supabase_auth_admin", swimCreatePlanOwner: "swim_writer",
  swimWriterLogin: false, swimWriterSuperuser: false, swimWriterInherit: false, swimWriterBypassRls: false,
  swimCreatePlanSecurityDefiner: true, swimCreatePlanRowSecurity: "on",
  serviceRoleAuthUsage: true, serviceRoleAuthUidExecute: true,
  serviceRoleLocalTodayExecute: true, serviceRoleSafetyExecute: true,
  helper: phase === "rolled-back-146" ? ["absent"]
    : ["present", true, true, true, false, amended(phase), false, false, !amended(phase), amended(phase)],
  shared: {
    attributes: true, original: !amended(phase), amended: amended(phase),
    originalAcl: !amended(phase), amendedAcl: amended(phase),
    authenticated: true, service: true, writer: true, owner: true, anon: !amended(phase), public: !amended(phase),
  },
  functions: SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, true, phase === "rolled-back-146", phase !== "rolled-back-146"]),
});
const catalogOutput = (value: ReturnType<typeof observation>) => JSON.stringify(Object.entries(value)
  .map(([key, entry]) => [key, key === "shared" ? Object.entries(value.shared) : entry]));
const evidence = (phase: Phase) => projectAuthPrivilegeOutput(catalogOutput(observation(phase)));
const probeOutput = (phase: Phase, testCase: ServiceCase) => JSON.stringify([
  ["case", testCase], ["identity", true], ["today", true], ["safety", true],
  ["helper", phase === "rolled-back-146" ? "absent" : true],
]);

function harness(change?: (
  response: Awaited<ReturnType<PrivateCommand>>, index: number, context: { phase: Phase; sql: string },
) => Awaited<ReturnType<PrivateCommand>>) {
  let phase: Phase = "initial-148";
  let index = 0;
  const proof = createIdentityRoundTripProof();
  const command = vi.fn<PrivateCommand>(async (_executable, args) => {
    const sql = args.at(-1)!;
    let text = "";
    if (sql === files[IDENTITY_FILES.sharedDown]) phase = "first-147";
    else if (sql === files[IDENTITY_FILES.down]) phase = "rolled-back-146";
    else if (sql === files[IDENTITY_FILES.up]) phase = "restored-147";
    else if (sql === files[IDENTITY_FILES.sharedUp]) phase = "restored-148";
    else if (sql === AUTH_PRIVILEGES_SQL) text = catalogOutput(observation(phase));
    else if (sql === SWIM_FUNCTION_ACLS_SQL) text = acls;
    else if (sql.includes("SELECT current_user")) text = "t\n";
    else {
      const testCase = SERVICE_CASES.find((value) => sql === serviceProbeSql(phase, value));
      expect(testCase).toBeDefined();
      text = probeOutput(phase, testCase!);
    }
    const response = { text, result: success };
    return change ? change(response, index++, { phase, sql }) : response;
  });
  const verifiedSql = vi.fn((file: typeof IDENTITY_FILES[keyof typeof IDENTITY_FILES]) => files[file]!);
  const checkConsistency = vi.fn(async () => {});
  const options = { command, dbId, initial: evidence("initial-148"), proof, verifiedSql, checkConsistency };
  return { ...options, run: () => runIdentityRoundTrip(options) };
}

describe("identity round trip (synthetic only; no database execution)", () => {
  it("hands off each exact tracked complete file once and bounds the private owned channel", async () => {
    const h = harness();
    await h.run();
    expect(h.command).toHaveBeenCalledTimes(29);
    expect(h.verifiedSql.mock.calls).toEqual([
      [IDENTITY_FILES.sharedDown], [IDENTITY_FILES.down], [IDENTITY_FILES.up], [IDENTITY_FILES.sharedUp],
    ]);
    for (const [index, file] of [
      [5, IDENTITY_FILES.sharedDown], [11, IDENTITY_FILES.down], [17, IDENTITY_FILES.up], [23, IDENTITY_FILES.sharedUp],
    ] as const) {
      expect(h.command.mock.calls[index]).toEqual(["docker", [
        "exec", "-e", "PGOPTIONS=-c statement_timeout=30s -c lock_timeout=5s", dbId,
        "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", files[file],
      ], { capture: true, allowFailure: true, timeout: 30_000 }]);
    }
    for (const [executable, args, options] of h.command.mock.calls) {
      expect(executable).toBe("docker");
      expect(args).toContain(dbId);
      expect(args).not.toContain("-f");
      expect(args).not.toContain("--single-transaction");
      expect(options).toEqual({ capture: true, allowFailure: true, timeout: args.includes("-e") ? 30_000 : 10_000 });
    }
    expect(h.checkConsistency).toHaveBeenCalledOnce();
    expect(h.proof.ddl).toEqual({ sharedDown: "completed", down: "completed", up: "completed", sharedUp: "completed" });
    expect(h.proof.consistency).toBe("matched");
    expect(h.proof.result).toBe("matched");
    for (const phase of IDENTITY_PHASES) {
      expect(h.proof.phases[phase]).toEqual({
        boundary: "matched", acls: "matched", restoration: "matched", attempted: 3, matched: 3,
        callers: { missing: "matched", "subject-a": "matched", "subject-b": "matched" },
      });
    }
    expect(JSON.stringify(h.proof)).not.toContain("a".repeat(32));
    expect(JSON.stringify(h.proof)).not.toContain("00000000");
  });

  it("retains exact-byte verification and restoration before full-file RPC without ledger shortcuts", () => {
    const runner = readFileSync(new URL("../../../../scripts/swim-acceptance.ts", import.meta.url), "utf8");
    expect(runner).toMatch(/verifiedSql: \(file\) => {\s+requireUnchanged\(\);\s+const bytes = readFileSync\(join\(root, file\)\);\s+assert\(hash\(bytes\) === sourceHashes\[file\]/);
    expect(runner).toContain('assert(Buffer.from(sql, "utf8").equals(bytes)');
    expect(runner).toMatch(/checkConsistency: async \(\) => {\s+requireUnchanged\(\);\s+await command\("pnpm", \["--filter", "@hta\/db", "db:check"\]/);
    expect(runner.indexOf("await stage(\"identity down-up round trip\"")).toBeLessThan(runner.indexOf("await enforceIdentityProofAfterRpc"));
    expect(runner.match(/"db:migrate"/g)).toHaveLength(1);
    expect(runner).not.toMatch(/(?:DELETE FROM|UPDATE) .*__drizzle_migrations/i);
    expect(runner).toContain('"src/lib/swim/__tests__/storage-rpc.smoke.test.ts", "--passWithNoTests=false"');
  });

  it.each([0, 5, 11, 17, 23])("stops on procedural failure at command %i with no retry/RPC", async (index) => {
    for (const result of [
      { ...success, code: 1 }, { ...success, signal: "SIGTERM" }, { ...success, timedOut: true },
    ]) {
      const h = harness((response, i) => i === index ? { text: unsafe, result } : response);
      const rpc = vi.fn();
      await expect(h.run().then(() => enforceIdentityProofAfterRpc("matched", h.proof, rpc, new AcceptanceReporting())))
        .rejects.toThrow(index === 0 ? "Swimming service role assumption failed" : "Swimming identity DDL round trip failed");
      expect(h.command).toHaveBeenCalledTimes(index + 1);
      expect(h.checkConsistency).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(h.proof.result).not.toBe("matched");
      if (index > 0) expect(h.proof.ddl[({ 5: "sharedDown", 11: "down", 17: "up", 23: "sharedUp" } as const)[index as 5 | 11 | 17 | 23]]).toBe("aborted");
      expect(JSON.stringify(h.proof)).not.toContain(unsafe);
    }
  });

  it.each([0, 5, 11, 17, 23])("sanitizes a thrown private command at procedural step %i", async (index) => {
    const h = harness((response, i) => { if (i === index) throw new Error(unsafe); return response; });
    await expect(h.run()).rejects.not.toThrow(unsafe);
    expect(h.command).toHaveBeenCalledTimes(index + 1);
  });

  it("stops on file verification failure or catalog consistency failure without a recovery reapply", async () => {
    const h = harness();
    h.verifiedSql.mockImplementation(() => { throw new Error(unsafe); });
    await expect(h.run()).rejects.toThrow("Swimming identity DDL round trip failed");
    expect(h.command).toHaveBeenCalledTimes(5);
    const restored = harness();
    const primary = new Error("consistency failure");
    restored.checkConsistency.mockRejectedValue(primary);
    await expect(restored.run()).rejects.toBe(primary);
    expect(restored.proof.consistency).toBe("aborted");
    expect(restored.proof.result).not.toBe("matched");
    expect(restored.verifiedSql).toHaveBeenCalledTimes(4);
  });

  it.each([1, 2, 3, 4, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 26, 27, 28])(
    "records failed evidence at command %i but attempts RPC after exact restore", async (index) => {
      for (const failure of ["malformed", "nonzero", "timeout", "signal", "throw"] as const) {
        const h = harness((response, i) => {
          if (i !== index) return response;
          if (failure === "throw") throw new Error(unsafe);
          return { text: unsafe, result: failure === "nonzero" ? { ...success, code: 1 }
            : failure === "timeout" ? { ...success, timedOut: true }
              : failure === "signal" ? { ...success, signal: "SIGTERM" } : success };
        });
        await h.run();
        expect(h.proof.result).toBe("mismatched");
        expect(h.proof.ddl.sharedUp).toBe("completed");
        const rpc = vi.fn(async () => {});
        await expect(enforceIdentityProofAfterRpc("matched", h.proof, rpc, new AcceptanceReporting())).rejects.toThrow();
        expect(rpc).toHaveBeenCalledOnce();
        expect(h.command).toHaveBeenCalledTimes(29);
        expect(JSON.stringify(h.proof)).not.toContain(unsafe);
      }
    },
  );

  it("defers initial missing metadata and rejects changed cross-phase ACLs/attributes/helper/body modes", async () => {
    const h = harness();
    h.initial.status = "unavailable";
    await h.run();
    expect(h.proof.phases["initial-148"].boundary).toBe("unavailable");
    expect(h.proof.result).toBe("mismatched");
    for (const index of [7, 13, 19, 25]) {
      const changed = harness((response, i) => i === index ? { ...response, text: acls.replace(/a{32}/, "b".repeat(32)) } : response);
      await changed.run();
      expect(changed.proof.result).toBe("mismatched");
    }
    for (const [index, phase] of [[6, "first-147"], [12, "rolled-back-146"], [18, "restored-147"], [24, "restored-148"]] as const) {
      for (const change of [
        { helper: ["present", true, true, true, true, false, false, false, true, false] },
        { functions: SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, false, true, true]) },
        { functions: SWIM_FUNCTION_CONTRACTS.map(([name]) => [name, true, phase !== "rolled-back-146", phase === "rolled-back-146"]) },
      ]) {
        const changed = harness((response, i) => i === index ? { ...response,
          text: catalogOutput({ ...observation(phase), ...change }),
        } : response);
        await changed.run();
        expect(changed.proof.result).toBe("mismatched");
      }
    }
  });

  it.each(["restored-147", "restored-148"] as const)(
    "rejects independent restoration drift while the %s boundary still matches", async (restored) => {
      for (const change of [{ postgresInherit: false }, { authUidOwner: "postgres" }]) {
        const h = harness((response, _index, { phase, sql }) =>
          phase === restored && sql === AUTH_PRIVILEGES_SQL
            ? { ...response, text: catalogOutput({ ...observation(phase), ...change }) } : response);
        await h.run();
        expect(h.proof.phases[restored].boundary).toBe("matched");
        expect(h.proof.phases[restored].restoration).toBe("mismatched");
        expect(h.proof.phases[restored].acls).toBe("matched");
        expect(h.proof.phases[restored].matched).toBe(3);
        expect(h.proof.result).toBe("mismatched");
        expect(h.proof.ddl.sharedUp).toBe("completed");
      }
    },
  );

  it.each(["matched", "mismatched", "unavailable"] as const)(
    "preserves RPC process/ledger failure identity and secondary proof/boundary failures (%s)", async (boundary) => {
      for (const proofResult of ["matched", "mismatched", "unavailable", "not-attempted"] as const) {
        for (const failure of ["none", "process", "ledger"] as const) {
          const h = harness();
          await h.run();
          const proof = h.proof;
          proof.result = proofResult;
          const reporting = new AcceptanceReporting();
          let primary: unknown;
          try { acceptanceAssert(false, "RPC acceptance failed"); } catch (error) { primary = error; }
          const rpc = vi.fn(() => reporting.stage(failure, async () => { if (failure !== "none") throw primary; }, () => {}));
          const run = enforceIdentityProofAfterRpc(boundary, proof, rpc, reporting);
          if (failure !== "none") await expect(run).rejects.toBe(primary);
          else if (boundary === "matched" && proofResult === "matched") await expect(run).resolves.toBeUndefined();
          else await expect(run).rejects.toThrow();
          expect(rpc).toHaveBeenCalledOnce();
          expect(Number(reporting.failures.primary !== null) + reporting.failures.secondary.length)
            .toBe(Number(failure !== "none") + Number(boundary !== "matched") + Number(proofResult !== "matched"));
          if (failure !== "none") expect(reporting.failures.primary?.stage).toBe(failure);
        }
      }
    },
  );
});

describe("service caller SQL and strict private evidence", () => {
  it("requires all six additive HTTP cases after the unchanged original minimum and canonical gate", () => {
    type Cases = Parameters<typeof requireIdentityHelperRpcCases>[0]["suites"][number]["cases"];
    const original: Cases = Array.from({ length: 30 }, (_, index) => ({ name: `original-${index}`, status: "passed" }));
    const helperCases = IDENTITY_HELPER_RPC_CASES.map((name) => ({
      name: `ADR0079 dedicated authenticated swim RPCs (DC-SW6/DC-SW7) ${name}`, status: "passed" as const,
    }));
    const check = (cases: typeof original) => requireIdentityHelperRpcCases({ suites: [{ name: "suite", status: "passed", cases }] });
    expect(() => check([...original, ...helperCases])).not.toThrow();
    expect(() => check([...original.slice(1), ...helperCases])).toThrow();
    expect(() => check(original)).toThrow();
    for (let index = 0; index < helperCases.length; index++) {
      for (const status of ["failed", "skipped", "pending", "todo"] as const) {
        expect(() => check([...original, ...helperCases.map((test, i) => i === index ? { ...test, status } : test)])).toThrow();
      }
      expect(() => check([...original, ...helperCases, helperCases[index]!])).toThrow();
      expect(() => check([...original, ...helperCases.filter((_, i) => i !== index), { name: "unrelated", status: "passed" }])).toThrow();
    }
    const source = readFileSync(new URL("./storage-rpc.smoke.test.ts", import.meta.url), "utf8");
    expect(IDENTITY_HELPER_RPC_CASES).toHaveLength(6);
    expect(new Set(IDENTITY_HELPER_RPC_CASES).size).toBe(6);
    expect(source.match(/\bit\("/g)).toHaveLength(33);
    expect(source).toContain('it.each(["paused", "finished", "archived"] as const)');
    for (const name of IDENTITY_HELPER_RPC_CASES) expect(source).toContain(`it("${name}",`);
    expect(source.match(/"401\/42501", "403\/42501", "404\/PGRST202"/g)).toHaveLength(2);
  });

  it.each(IDENTITY_PHASES)("isolates all cases and verifies non-vacuous native identity in %s", (phase) => {
    for (const testCase of SERVICE_CASES) {
      const sql = serviceProbeSql(phase, testCase);
      expect(sql).toContain("BEGIN READ ONLY;");
      expect(sql).toContain("SET LOCAL statement_timeout = '5s';");
      expect(sql).toContain("SET LOCAL ROLE service_role;");
      expect(sql).toContain("SET LOCAL request.jwt.claim.sub =");
      expect(sql).toContain("SET LOCAL request.jwt.claims =");
      expect(sql.trim().endsWith("ROLLBACK;")).toBe(true);
      expect(sql.includes("public.swim_request_user_id()")).toBe(phase !== "rolled-back-146");
      expect(sql).toContain("public.swim_local_today() IS DISTINCT FROM (now() AT TIME ZONE COALESCE(");
      expect(sql).toContain("public.swim_assert_start_safety(");
      expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|GRANT|COMMIT)\b/);
      expect(sql.indexOf("Identity precondition failed")).toBeLessThan(sql.indexOf("public.swim_local_today()"));
      if (testCase === "missing") {
        expect(sql).toContain("IF auth.uid() IS NOT NULL THEN");
        expect(sql).toContain("SET LOCAL request.jwt.claim.sub = '';");
        expect(sql).toContain("SET LOCAL request.jwt.claims = '{}';");
        expect(sql).toMatch(/BEGIN\s+PERFORM public\.swim_assert_start_safety\('[^']+'::jsonb\);\s+EXCEPTION WHEN OTHERS THEN\s+IF SQLSTATE = 'P0001' AND SQLERRM = 'Not signed in\.' THEN\s+RETURN;\s+END IF;\s+RAISE;\s+END;\s+RAISE EXCEPTION USING ERRCODE = 'XX000'/);
      } else {
        expect(sql).toMatch(/IF auth.uid\(\) IS NULL OR auth.uid\(\) IS DISTINCT FROM '[0-9a-f-]+'::uuid/);
        expect(sql).not.toContain("EXCEPTION WHEN");
      }
      expect(sql.match(/SELECT '\[\[/g)).toHaveLength(1);
      expect(projectServiceProbe(probeOutput(phase, testCase), phase, testCase)).toBe("matched");
    }
    expect(serviceProbeSql(phase, "subject-a")).not.toEqual(serviceProbeSql(phase, "subject-b"));
  });

  it("keeps the easy fixture identical in shape without replacing seeded catalog rows", () => {
    const sql = serviceProbeSql("initial-148", "subject-a");
    const fixture = JSON.parse(sql.match(/swim_assert_start_safety\('([^']+)'::jsonb\)/)![1]);
    expect(fixture.totalLengths).toBe(3);
    expect(fixture.sections.map((section: { kind: string }) => section.kind)).toEqual(["warmup", "main", "cooldown"]);
    for (const section of fixture.sections) expect(section.items).toEqual([
      { repeats: 1, lengths: 1, stroke: "freestyle", equipment: [], effort: "easy", optional: false, restSeconds: 20 },
    ]);
    expect(sql).not.toContain("INSERT");
  });

  it.each(IDENTITY_PHASES)("rejects missing/duplicate/extra/hostile evidence and caller-supplied weaker phases in %s", (phase) => {
    const valid = probeOutput(phase, "subject-a");
    const pairs: unknown[] = JSON.parse(valid);
    for (const text of [
      "", unsafe, "null", "{}", valid + "\n" + valid,
      JSON.stringify(pairs.slice(1)), JSON.stringify([...pairs, pairs[0]]),
      JSON.stringify([pairs[0], pairs[1], pairs[1], pairs[3], pairs[4]]),
      valid.replace('"subject-a"', '"subject-b"'), valid.replace("true", "null"),
      valid.replace("true", '"true"'), valid.replace('"identity"', '"phase"'),
      probeOutput(phase === "rolled-back-146" ? "initial-148" : "rolled-back-146", "subject-a"),
    ]) expect(projectServiceProbe(text, phase, "subject-a")).toBe("unavailable");
    for (const key of ["identity", "today", "safety", ...(phase === "rolled-back-146" ? [] : ["helper"])]) {
      expect(projectServiceProbe(valid.replace(`"${key}",true`, `"${key}",false`), phase, "subject-a")).toBe("mismatched");
    }
  });

  it("normalizes NULL/default ACL semantics and ordering for only the ten exact signatures", async () => {
    expect(SWIM_FUNCTION_ACLS_SQL).toContain("COALESCE(f.proacl, pg_catalog.acldefault('f', f.proowner))");
    expect(SWIM_FUNCTION_ACLS_SQL).toContain("ORDER BY a.grantor, a.grantee, a.privilege_type, a.is_grantable");
    expect([...SWIM_FUNCTION_ACLS_SQL.matchAll(/to_regprocedure\('([^']+)'\)/g)].map((match) => match[1]))
      .toEqual(SWIM_FUNCTION_CONTRACTS.map(([name, args]) => `public.${name}(${args})`));
    const command = vi.fn<PrivateCommand>(async () => ({ text: acls, result: success }));
    expect(await observeSwimFunctionAcls(command, dbId)).toBe(acls);
    expect(command.mock.calls[0]?.[2]).toEqual({ capture: true, allowFailure: true, timeout: 10_000 });
    const entries: unknown[] = JSON.parse(acls);
    for (const text of [
      unsafe, "null", "[]", acls + acls, acls.replace(/a{32}/, "unknown"), acls.replace(/"a{32}"/, "null"),
      JSON.stringify(entries.slice(1)), JSON.stringify([...entries, entries[0]]),
      JSON.stringify([entries[0], entries[0], ...entries.slice(2)]), JSON.stringify([...entries].reverse()),
    ]) {
      command.mockResolvedValue({ text, result: success });
      expect(await observeSwimFunctionAcls(command, dbId)).toBeNull();
    }
  });
});
