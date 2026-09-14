import { z } from "zod";
import { MIN_RPC_CASES, type readSwimRpcReport } from "../src/lib/swim/__tests__/storage-rpc-report";
import { acceptanceAssert, type AcceptanceReporting } from "./swim-acceptance-reporting";
import {
  checkAuthBoundary, enforceAuthBoundaryAfterRpc, observeAuthPrivileges, observeSwimFunctionAcls,
  type AuthBoundaryResult, type AuthPrivilegeEvidence, type IdentityLevel, type PrivateCommand,
} from "./swim-auth-privileges";

export const IDENTITY_FILES = {
  sharedDown: "packages/db/rollbacks/0148_shared_completion_identity.down.sql",
  down: "packages/db/rollbacks/0147_swim_request_identity.down.sql",
  up: "packages/db/drizzle/0147_swim_request_identity.sql",
  sharedUp: "packages/db/drizzle/0148_shared_completion_identity.sql",
} as const;
export const IDENTITY_PHASES = ["initial-148", "first-147", "rolled-back-146", "restored-147", "restored-148"] as const;
const PHASE_LEVELS: Record<Phase, IdentityLevel> = {
  "initial-148": 148, "first-147": 147, "rolled-back-146": 146, "restored-147": 147, "restored-148": 148,
};
export const SERVICE_CASES = ["missing", "subject-a", "subject-b"] as const;
export const IDENTITY_HELPER_RPC_CASES = [
  "DC-SW8 denies anonymous identity-helper invocation",
  "DC-SW8 returns each authenticated caller's exact identity",
  "DC-SW8 permits service identity-helper invocation with a UUID-or-null result",
  "DC-SW8 completes an owner's non-swim session with a durable receipt and same/new-entry replay",
  "DC-SW8 returns no shared completion for another user's session and preserves owner data",
  "DC-SW8 denies anonymous shared-completion invocation",
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
  boundary: Outcome; acls: Outcome; restoration: Outcome;
  callers: Record<ServiceCase, Outcome>; attempted: number; matched: number;
};
export type IdentityRoundTripProof = {
  ddl: Record<keyof typeof IDENTITY_FILES, "not-attempted" | "running" | "completed" | "aborted">;
  phases: Record<Phase, PhaseProof>;
  consistency: "not-attempted" | "matched" | "aborted";
  result: Outcome;
};

export function createIdentityRoundTripProof(): IdentityRoundTripProof {
  const phase = (): PhaseProof => ({
    boundary: "not-attempted", acls: "not-attempted", restoration: "not-attempted",
    callers: { missing: "not-attempted", "subject-a": "not-attempted", "subject-b": "not-attempted" },
    attempted: 0, matched: 0,
  });
  return {
    ddl: { sharedDown: "not-attempted", down: "not-attempted", up: "not-attempted", sharedUp: "not-attempted" },
    phases: { "initial-148": phase(), "first-147": phase(), "rolled-back-146": phase(),
      "restored-147": phase(), "restored-148": phase() },
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
  ${PHASE_LEVELS[phase] === 146 ? "" : `IF public.swim_request_user_id() IS DISTINCT FROM auth.uid() THEN
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
SELECT '[["case","${testCase}"],["identity",true],["today",true],["safety",true],["helper",${PHASE_LEVELS[phase] === 146 ? '"absent"' : "true"}]]';
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
      z.tuple([z.literal("helper"), PHASE_LEVELS[phase] === 146 ? z.literal("absent") : z.boolean()]),
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
  const firstEvidence: Partial<Record<IdentityLevel, string>> = {};
  const observe = async (phase: Phase, evidence: AuthPrivilegeEvidence) => {
    const current = proof.phases[phase];
    const level = PHASE_LEVELS[phase];
    current.boundary = checkAuthBoundary(evidence, level);
    const comparison = evidence.status === "available" ? JSON.stringify({
      ...evidence.observation,
      functions: [...evidence.observation.functions].sort(([a], [b]) => a.localeCompare(b)),
    }) : undefined;
    if (!phase.startsWith("restored-")) firstEvidence[level] = comparison;
    current.restoration = comparison === undefined || firstEvidence[level] === undefined
      ? "unavailable" : comparison === firstEvidence[level] ? "matched" : "mismatched";
    const acls = await observeSwimFunctionAcls(command, dbId);
    if (phase === "initial-148") initialAcls = acls;
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
  await observe("initial-148", initial);
  for (const [direction, phase] of [
    ["sharedDown", "first-147"], ["down", "rolled-back-146"],
    ["up", "restored-147"], ["sharedUp", "restored-148"],
  ] as const) {
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
    await observe(phase, await observeAuthPrivileges(command, dbId));
  }
  proof.consistency = "aborted";
  await options.checkConsistency();
  proof.consistency = "matched";
  proof.result = identityProofComplete(proof) ? "matched" : "mismatched";
}

function identityProofComplete(proof: IdentityRoundTripProof): boolean {
  return Object.keys(IDENTITY_FILES).every((key) => proof.ddl[key as keyof typeof IDENTITY_FILES] === "completed")
    && proof.consistency === "matched" && IDENTITY_PHASES.every((phase) => {
    const current = proof.phases[phase];
    return current.boundary === "matched" && current.acls === "matched" && current.restoration === "matched"
      && current.attempted === SERVICE_CASES.length && current.matched === SERVICE_CASES.length
      && SERVICE_CASES.every((testCase) => current.callers[testCase] === "matched");
  });
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
      acceptanceAssert(proof.result === "matched" && identityProofComplete(proof),
        "Swimming identity round-trip proof unavailable or mismatched");
    } catch (error) {
      reporting.recordFailure("swimming identity round-trip proof", error);
      if (!failed) throw error;
    }
    if (failed) throw primary;
  }, reporting);
}
