import { z } from "zod";
import { MIN_RPC_CASES, type readSwimRpcReport } from "../src/lib/swim/__tests__/storage-rpc-report";
import { acceptanceAssert, type AcceptanceReporting } from "./swim-acceptance-reporting";
import {
  checkAuthBoundary, enforceAuthBoundaryAfterRpc, observeAuthPrivileges, observeSwimFunctionAcls,
  type AuthBoundaryResult, type AuthPrivilegeEvidence, type PrivateCommand,
} from "./swim-auth-privileges";

export const IDENTITY_FILES = {
  down: "packages/db/rollbacks/0146_swim_request_identity.down.sql",
  up: "packages/db/drizzle/0146_swim_request_identity.sql",
} as const;
export const IDENTITY_PHASES = ["initial-up", "rolled-back", "restored-up"] as const;
export const SERVICE_CASES = ["missing", "subject-a", "subject-b"] as const;
export const IDENTITY_HELPER_RPC_CASES = [
  "DC-SW8 denies anonymous identity-helper invocation",
  "DC-SW8 denies authenticated identity-helper invocation",
  "DC-SW8 permits service identity-helper invocation with a UUID-or-null result",
] as const;

export function requireIdentityHelperRpcCases(ledger: Pick<ReturnType<typeof readSwimRpcReport>, "suites">): void {
  const cases = ledger.suites.flatMap((suite) => suite.cases);
  const prefix = "ADR0079 dedicated authenticated swim RPCs (DC-SW6/DC-SW7) ";
  acceptanceAssert(cases.length >= MIN_RPC_CASES + IDENTITY_HELPER_RPC_CASES.length
    && IDENTITY_HELPER_RPC_CASES.every((name) => {
      const matches = cases.filter((test) => test.name === prefix + name);
      return matches.length === 1 && matches[0]!.status === "passed";
    }), "Swimming identity helper RPC cases missing or not passed");
}

type Phase = typeof IDENTITY_PHASES[number];
type ServiceCase = typeof SERVICE_CASES[number];
type Outcome = "matched" | "mismatched" | "unavailable" | "not-attempted";
type PhaseProof = {
  boundary: Outcome; acls: Outcome; callers: Record<ServiceCase, Outcome>; attempted: number; matched: number;
};
export type IdentityRoundTripProof = {
  ddl: Record<"down" | "up", "not-attempted" | "running" | "completed" | "aborted">;
  phases: Record<Phase, PhaseProof>;
  consistency: "not-attempted" | "matched" | "aborted";
  result: Outcome;
};

export function createIdentityRoundTripProof(): IdentityRoundTripProof {
  const phase = (): PhaseProof => ({
    boundary: "not-attempted", acls: "not-attempted",
    callers: { missing: "not-attempted", "subject-a": "not-attempted", "subject-b": "not-attempted" },
    attempted: 0, matched: 0,
  });
  return {
    ddl: { down: "not-attempted", up: "not-attempted" },
    phases: { "initial-up": phase(), "rolled-back": phase(), "restored-up": phase() },
    consistency: "not-attempted", result: "not-attempted",
  };
}

// The same all-easy, three-whole-length shape as the existing RPC prescription.
const prescription = {
  kind: "swim_workout", focus: "endurance", totalLengths: 3, estimatedMs: null,
  budget: { minutes: 30, accountedMs: 60_000 },
  snapshot: {
    course: { numerator: 100, denominator: 3, unit: "m" },
    strokes: ["freestyle"], equipment: [], protocol: null, calibration: null,
    versions: { model: "swim-model-1", generator: "swim-rpc-test", assessment: null },
  },
  sections: ["warmup", "main", "cooldown"].map((kind) => ({
    kind, label: kind, rounds: 1,
    items: [{ repeats: 1, lengths: 1, stroke: "freestyle", equipment: [], effort: "easy", optional: false, restSeconds: 20 }],
  })),
};
const subjects = {
  missing: "", "subject-a": "00000000-0000-4000-8000-000000000001", "subject-b": "00000000-0000-4000-8000-000000000002",
} as const;

export function serviceProbeSql(phase: Phase, testCase: ServiceCase): string {
  const subject = subjects[testCase];
  const missing = testCase === "missing";
  return `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL ROLE service_role;
SET LOCAL request.jwt.claim.sub = '${subject}';
SET LOCAL request.jwt.claims = '${missing ? "{}" : JSON.stringify({ sub: subject })}';
DO $probe$
BEGIN
  IF ${missing ? "auth.uid() IS NOT NULL" : `auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM '${subject}'::uuid`} THEN
    RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'Identity precondition failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.limitations WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'Synthetic context is not empty';
  END IF;
  IF public.swim_local_today() IS DISTINCT FROM (now() AT TIME ZONE COALESCE(
    (SELECT timezone FROM public.profiles WHERE id = auth.uid()), 'UTC'))::date THEN
    RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'Date comparison failed';
  END IF;
  ${phase === "rolled-back" ? "" : `IF public.swim_request_user_id() IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'Helper comparison failed';
  END IF;`}
  ${missing ? `BEGIN
    PERFORM public.swim_assert_start_safety('${JSON.stringify(prescription)}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = 'Not signed in.' THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION USING ERRCODE = 'XX000', MESSAGE = 'Safety unexpectedly returned';`
    : `PERFORM public.swim_assert_start_safety('${JSON.stringify(prescription)}'::jsonb);`}
END;
$probe$;
SELECT '[["case","${testCase}"],["identity",true],["today",true],["safety",true],["helper",${phase === "rolled-back" ? '"absent"' : "true"}]]';
ROLLBACK;
`;
}

export function projectServiceProbe(text: string, phase: Phase, testCase: ServiceCase): Outcome {
  try {
    const parsed = z.tuple([
      z.tuple([z.literal("case"), z.literal(testCase)]),
      z.tuple([z.literal("identity"), z.boolean()]),
      z.tuple([z.literal("today"), z.boolean()]),
      z.tuple([z.literal("safety"), z.boolean()]),
      z.tuple([z.literal("helper"), phase === "rolled-back" ? z.literal("absent") : z.boolean()]),
    ]).safeParse(JSON.parse(text));
    if (!parsed.success) return "unavailable";
    return parsed.data.slice(1).every(([, value]) => value === true || value === "absent") ? "matched" : "mismatched";
  } catch {
    return "unavailable";
  }
}

const psql = (dbId: string, sql: string) => [
  "exec", dbId, "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql,
];
const succeeded = (result: Awaited<ReturnType<PrivateCommand>>["result"]) =>
  result.code === 0 && result.signal === null && !result.timedOut;

export async function runIdentityRoundTrip(options: {
  command: PrivateCommand; dbId: string; initial: AuthPrivilegeEvidence; proof: IdentityRoundTripProof;
  verifiedSql: (file: typeof IDENTITY_FILES[keyof typeof IDENTITY_FILES]) => string;
  checkConsistency: () => Promise<void>;
}): Promise<void> {
  const { command, dbId, initial, proof } = options;
  proof.result = "unavailable";
  let initialAcls: string | null = null;
  const observe = async (phase: Phase, evidence: AuthPrivilegeEvidence) => {
    const current = proof.phases[phase];
    current.boundary = checkAuthBoundary(evidence, phase === "rolled-back" ? "rolled-back" : "up");
    const acls = await observeSwimFunctionAcls(command, dbId);
    if (phase === "initial-up") initialAcls = acls;
    current.acls = acls === null || initialAcls === null ? "unavailable" : acls === initialAcls ? "matched" : "mismatched";
    for (const testCase of SERVICE_CASES) {
      current.attempted++;
      try {
        const { text, result } = await command("docker", psql(dbId, serviceProbeSql(phase, testCase)),
          { capture: true, allowFailure: true, timeout: 10_000 });
        current.callers[testCase] = succeeded(result) ? projectServiceProbe(text, phase, testCase) : "unavailable";
      } catch {
        current.callers[testCase] = "unavailable";
      }
      if (current.callers[testCase] === "matched") current.matched++;
    }
  };
  // A failed role assumption is procedural, not an expected behavioral denial.
  let roleAvailable = false;
  try {
    const { text, result } = await command("docker", psql(dbId,
      "BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; SET LOCAL ROLE service_role; SELECT current_user = 'service_role'; ROLLBACK;"),
    { capture: true, allowFailure: true, timeout: 10_000 });
    roleAvailable = succeeded(result) && text.trim() === "t";
  } catch { /* The fixed assertion below owns the procedural failure. */ }
  acceptanceAssert(roleAvailable, "Swimming service role assumption failed");
  await observe("initial-up", initial);
  for (const direction of ["down", "up"] as const) {
    proof.ddl[direction] = "running";
    let completed = false;
    try {
      const sql = options.verifiedSql(IDENTITY_FILES[direction]);
      const args = psql(dbId, sql);
      args.splice(1, 0, "-e", "PGOPTIONS=-c statement_timeout=30s -c lock_timeout=5s");
      const { result } = await command("docker", args, { capture: true, allowFailure: true, timeout: 30_000 });
      completed = succeeded(result);
    } catch { /* Never retry DDL in an unknown disposable schema state. */ }
    proof.ddl[direction] = completed ? "completed" : "aborted";
    acceptanceAssert(completed, "Swimming identity DDL round trip failed");
    await observe(direction === "down" ? "rolled-back" : "restored-up", await observeAuthPrivileges(command, dbId));
  }
  proof.consistency = "aborted";
  await options.checkConsistency();
  proof.consistency = "matched";
  proof.result = IDENTITY_PHASES.every((phase) => {
    const current = proof.phases[phase];
    return current.boundary === "matched" && current.acls === "matched"
      && current.attempted === SERVICE_CASES.length && current.matched === SERVICE_CASES.length
      && SERVICE_CASES.every((testCase) => current.callers[testCase] === "matched");
  }) ? "matched" : "mismatched";
}

export function enforceIdentityProofAfterRpc(
  boundary: AuthBoundaryResult, proof: IdentityRoundTripProof, rpc: () => Promise<unknown>,
  reporting: Pick<AcceptanceReporting, "recordFailure">,
): Promise<void> {
  return enforceAuthBoundaryAfterRpc(boundary, async () => {
    let failed = false;
    let primary: unknown;
    try { await rpc(); } catch (error) { failed = true; primary = error; }
    try {
      acceptanceAssert(proof.result === "matched", "Swimming identity round-trip proof unavailable or mismatched");
    } catch (error) {
      reporting.recordFailure("swimming identity round-trip proof", error);
      if (!failed) throw error;
    }
    if (failed) throw primary;
  }, reporting);
}
