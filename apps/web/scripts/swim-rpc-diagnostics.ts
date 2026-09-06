import { createHash } from "node:crypto";
import {
  closeSync, constants, fstatSync, ftruncateSync, lstatSync, openSync, readSync,
  realpathSync, writeFileSync, writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { Reporter } from "vitest/reporters";
import { z } from "zod";
import { RPC_SUITE, type readSwimRpcReport } from "../src/lib/swim/__tests__/storage-rpc-report";

export const DIAGNOSTICS_ENV = "SWIM_RPC_DIAGNOSTICS_PATH";
export const DIAGNOSTICS_FILE = "rpc-diagnostics.jsonl";
export const DIAGNOSTICS_SUITE = "ADR0079 dedicated authenticated swim RPCs (DC-SW6/DC-SW7)";
export const DIAGNOSTICS_LIMITS = {
  causes: 8, tasks: 1024, taskDepth: 16, records: 256,
  messageBytes: 8192, recordBytes: 2048, fileBytes: 1024 * 1024,
} as const;

const rpcNames = [
  "swim_storage_ready", "swim_create_plan", "swim_start_workout", "swim_set_plan_status",
  "swim_skip_workout", "swim_update_plan", "swim_resume_plan", "swim_complete_workout", "swim_edit_result",
] as const;
const errorClasses = ["Error", "AssertionError", "PostgrestError", "TypeError", "SyntaxError", "RangeError", "Other"] as const;
const categories = ["permission", "constraint", "undefined-object", "schema-cache", "domain", "unclassified"] as const;
const deniedKinds = ["table", "function", "schema", "sequence", "column", "type", "rls-policy", "role", "unknown"] as const;
type DeniedKind = typeof deniedKinds[number];
const denialPrefixes: ReadonlyArray<readonly [DeniedKind, string]> = [
  ["table", "permission denied for table "],
  ["function", "permission denied for function "],
  ["schema", "permission denied for schema "],
  ["sequence", "permission denied for sequence "],
  ["column", "permission denied for column "],
  ["type", "permission denied for type "],
  ["rls-policy", "new row violates row-level security policy for table "],
  ["rls-policy", 'new row violates row-level security policy "'],
  ["rls-policy", "query would be affected by row-level security policy for table "],
  ["role", "permission denied to set role "],
  ["role", "must be member of role "],
];
const codeCategories: Record<string, typeof categories[number]> = {
  "42501": "permission", "23502": "constraint", "23503": "constraint", "23505": "constraint",
  "23514": "constraint", "42P01": "undefined-object", "42703": "undefined-object",
  "42883": "undefined-object", PGRST202: "schema-cache", PGRST204: "schema-cache", P0001: "domain",
};
// Compile-time object vocabulary, anchored in packages/db/drizzle/0145_standalone_pool_swimming.sql.
const identifiers = [
  // Schemas: 0145:6,89; extensions: 0090_byoai_pgcrypto_search_path.sql:27.
  "public", "auth", "pg_catalog", "extensions",
  // Tables, roles, column, type and named constraints/indexes/policies: 0145:5-83,713.
  "swim_plans", "swim_workouts", "sessions", "cardio_logs", "users", "planned_sessions",
  "set_logs", "session_movements", "profiles", "limitations", "movements",
  "swim_writer", "anon", "authenticated", "service_role", "swim_result", "session_slot",
  "swim_workouts_owned_plan_fk", "swim_workouts_owned_session_fk",
  "sessions_user_id_id_key", "swim_plans_one_active_per_user", "swim_plans_owner_status_idx",
  "swim_workouts_owner_date_idx", "swim_workouts_plan_idx", "cardio_logs_one_swim_result_per_session",
  "swim_plans_owner", "swim_workouts_owner",
  // RPCs and helpers: 0145:7,57,78,87-1369 (function definitions and calls).
  ...rpcNames, "swim_validate_plan", "swim_validate_workout", "swim_validate_plan_binding",
  "uid", "set_updated_at", "complete_training_session_with_transition",
  "swim_bounded_integer", "swim_local_today", "swim_array_append_only", "swim_validate_course",
  "swim_validate_labels", "swim_validate_snapshot", "swim_validate_prescription",
  "swim_validate_observation", "swim_validate_verified_calibration", "swim_validate_state_append",
  "swim_validate_workout_append", "swim_validate_result", "swim_result_summary",
  "swim_validate_result_course", "swim_forget_purged_actuals", "swim_guard_cardio",
  "swim_guard_session", "swim_invalidate_session_source", "swim_guard_strength",
  "swim_prescription_regions", "swim_serialize_limitation_change", "swim_assert_start_safety",
  // Triggers: 0145:56-59,584,653,678,714-721,744-749,810.
  "swim_plans_set_updated_at", "swim_workouts_set_updated_at", "swim_workouts_purge_actuals",
  "cardio_logs_swim_guard", "sessions_swim_guard", "sessions_swim_source_revision",
  "sessions_swim_purge_revision", "set_logs_swim_guard", "session_movements_swim_guard",
  "limitations_swim_serialization",
  // Builtins: 0145:10-46,94-163,230-269,398,492,529,607,668,805,962-964,1048,1085.
  "gen_random_uuid", "now", "format", "jsonb_typeof", "trunc", "jsonb_array_length",
  "cardinality", "jsonb_array_elements", "count", "array_position", "array_append",
  "jsonb_build_array", "jsonb_array_elements_text", "array_agg", "unnest", "btrim", "round",
  "jsonb_build_object", "to_jsonb", "pg_advisory_xact_lock", "hashtextextended", "jsonb_agg",
  "jsonb_set", "length",
  // Types used by the creation/validation path: 0145:17-46,87-98,119-135.
  "uuid", "text", "date", "integer", "jsonb", "timestamptz", "bigint", "numeric", "boolean", "void",
] as const;
const domainMessages = {
  "not-signed-in": "Not signed in.",
  "invalid-plan-state": "Invalid swimming plan or state version.",
  "invalid-setup": "Invalid swimming setup.",
  "invalid-schedule": "Invalid swimming schedule.",
  "invalid-prescription": "Invalid swimming prescription.",
  "plan-binding-mismatch": "The swimming prescription does not match its plan setup.",
  "new-plan-lifecycle": "A new swimming plan has no previous lifecycle.",
  "new-workout-prescription": "A new swimming workout starts with its original prescription.",
  "workout-outside-dates": "Swimming workout is outside the plan dates.",
} as const;
const reasons = [
  "collected", "collector-failure", "cause-limit", "cycle", "task-limit", "record-limit",
  "message-limit", "identity-limit", "sidecar-unavailable", "sidecar-invalid", "sidecar-stale",
  "sidecar-size", "invalid-records", "canonical-cases-unavailable", "case-unverified",
] as const;
type Reason = typeof reasons[number];
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const sha = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const code = z.string().regex(/^(?:[A-Z0-9]{5}|PGRST[0-9]{3})(?![\s\S])/);
const recordSchema = z.object({
  kind: z.literal("error"), phase: z.enum(["test", "hook", "collection"]),
  caseHash: sha.optional(), errorClass: z.enum(errorClasses), hasCause: z.boolean(),
  code: code.optional(), category: z.enum(categories), rpc: z.enum(rpcNames).optional(),
  deniedKind: z.enum(deniedKinds).optional(),
  fingerprint: sha, identifiers: z.array(z.enum(identifiers)).max(identifiers.length),
  domainMessageId: z.enum(Object.keys(domainMessages) as [keyof typeof domainMessages, ...Array<keyof typeof domainMessages>]).optional(),
}).strict().refine((record) => (record.code === "42501") === (record.deniedKind !== undefined));
type Diagnostic = z.infer<typeof recordSchema>;
const statusSchema = z.object({
  kind: z.literal("collector"), status: z.enum(["complete", "partial", "unavailable"]),
  reason: z.enum(reasons), records: z.number().int().min(0).max(DIAGNOSTICS_LIMITS.records),
}).strict();
type Collection = { status: z.infer<typeof statusSchema>; records: Diagnostic[] };
type Ledger = ReturnType<typeof readSwimRpcReport>;
type Files = Parameters<NonNullable<Reporter["onFinished"]>>[0];
const categoryFor = (value?: string) =>
  value && Object.hasOwn(codeCategories, value) ? codeCategories[value]! : "unclassified";
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const member = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" ? values.find((allowed) => allowed === value) : undefined;
const denialKindFor = (text: string): DeniedKind =>
  denialPrefixes.find(([, prefix]) => text.startsWith(prefix) && text.slice(prefix.length).trim().length > 0)?.[0] ?? "unknown";

function normalizedMessage(text: string) {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*"|`(?:[^`\\]|\\.)*`/g, "<literal>")
    .replace(/[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi, "<number>")
    .replace(/\s+/g, " ").trim();
}

export function collectSwimRpcDiagnostics(files: Files = [], errors: unknown[] = []): Collection {
  const records: Diagnostic[] = [];
  let reason: Reason = "collected";
  const partial = (value: Reason) => { if (reason === "collected") reason = value; };
  const add = (error: unknown, phase: Diagnostic["phase"], caseHash?: string) => {
    if (records.length >= DIAGNOSTICS_LIMITS.records) { partial("record-limit"); return; }
    const seen = new Set<unknown>();
    const record: Diagnostic = {
      kind: "error", phase, ...(caseHash ? { caseHash } : {}),
      errorClass: member(errorClasses, object(error).name) ?? "Other",
      hasCause: object(error).cause != null, category: "unclassified",
      fingerprint: digest(""), identifiers: [],
    };
    let current: unknown = error;
    let message = "";
    let incomplete = false;
    for (let depth = 0; current != null; depth++) {
      if (seen.has(current) || depth === DIAGNOSTICS_LIMITS.causes) {
        partial(seen.has(current) ? "cycle" : "cause-limit"); incomplete = true; break;
      }
      seen.add(current);
      const value = object(current);
      const text = typeof value.message === "string" ? value.message : typeof current === "string" ? current : "";
      if (Buffer.byteLength(text) > DIAGNOSTICS_LIMITS.messageBytes) {
        partial("message-limit"); incomplete = true;
      } else if (text) {
        message = text;
        const prefix = text.split(": ", 1)[0];
        const rpc = member(rpcNames, prefix);
        if (rpc) record.rpc ??= rpc;
        // Tokenize the complete bounded message, never publish a regex capture.
        const tokens = new Set((text.match(/"(?:[^"]|"")*"|[\p{L}\p{N}\p{M}_$]+/gu) ?? [])
          .map((token) => token.startsWith('"') ? token.slice(1, -1).replaceAll('""', '"') : token));
        record.identifiers = identifiers.filter((id) => record.identifiers.includes(id) || tokens.has(id));
        for (const [id, literal] of Object.entries(domainMessages)) {
          if (text === literal) record.domainMessageId = id as keyof typeof domainMessages;
        }
      }
      const parsedCode = code.safeParse(value.code);
      if (parsedCode.success) {
        record.code = parsedCode.data;
        // Follow the selected code's own bounded message, never a wrapper or another cause.
        if (record.code === "42501") {
          record.deniedKind = Buffer.byteLength(text) <= DIAGNOSTICS_LIMITS.messageBytes ? denialKindFor(text) : "unknown";
        } else delete record.deniedKind;
      }
      current = value.cause;
    }
    record.category = incomplete ? "unclassified" : categoryFor(record.code);
    if (incomplete && record.code === "42501") record.deniedKind = "unknown";
    // Incomplete chains must not masquerade as a fully observed message.
    record.fingerprint = digest(incomplete ? "<incomplete>" : normalizedMessage(message));
    records.push(record);
  };
  try {
    const seen = new Set<unknown>();
    let tasks = 0;
    const visit = (task: Files[number] | Files[number]["tasks"][number], names: string[], depth: number) => {
      if (seen.has(task)) { partial("cycle"); return; }
      if (++tasks > DIAGNOSTICS_LIMITS.tasks || depth > DIAGNOSTICS_LIMITS.taskDepth) {
        partial("task-limit"); return;
      }
      seen.add(task);
      const isFile = "filepath" in task;
      const nameParts = [...names, ...(isFile || !task.name ? [] : [task.name])];
      const boundedName = nameParts.every((name) => name.length <= DIAGNOSTICS_LIMITS.messageBytes) &&
        nameParts.reduce((length, name) => length + name.length + 1, 0) <= DIAGNOSTICS_LIMITS.messageBytes;
      let caseHash: string | undefined;
      if (task.type === "test") {
        if (boundedName && Buffer.byteLength(nameParts.join(" ")) <= DIAGNOSTICS_LIMITS.messageBytes) {
          caseHash = digest(nameParts.join(" "));
        }
        else partial("identity-limit");
      }
      const hookFailed = Object.values(task.result?.hooks ?? {}).some((state) => state === "run" || state === "fail");
      const phase = hookFailed ? "hook" : task.type === "test" ? "test" :
        task.result?.startTime !== undefined ? "hook" : "collection";
      for (const error of task.result?.errors ?? []) {
        if (records.length === DIAGNOSTICS_LIMITS.records) { partial("record-limit"); break; }
        add(error, phase, phase === "test" ? caseHash : undefined);
      }
      if (task.type === "suite") {
        for (const child of task.tasks) {
          if (tasks >= DIAGNOSTICS_LIMITS.tasks) { partial("task-limit"); break; }
          visit(child, isFile ? [] : [...names, task.name], depth + 1);
        }
      }
    };
    for (const file of files) {
      if (tasks >= DIAGNOSTICS_LIMITS.tasks) { partial("task-limit"); break; }
      visit(file, [], 0);
    }
    for (const error of errors) {
      if (records.length === DIAGNOSTICS_LIMITS.records) { partial("record-limit"); break; }
      add(error, "collection");
    }
    return { status: { kind: "collector", status: reason === "collected" ? "complete" : "partial",
      reason, records: records.length }, records };
  } catch {
    return { status: { kind: "collector", status: "unavailable", reason: "collector-failure", records: 0 }, records: [] };
  }
}

function privateDirectory(directory: string) {
  const info = lstatSync(directory);
  return info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700 &&
    realpathSync(directory) === directory;
}

export function writeSwimRpcDiagnostics(directory: string, path: string, files: Files, errors: unknown[]) {
  let fd: number | undefined;
  try {
    if (path !== join(directory, DIAGNOSTICS_FILE) || !privateDirectory(directory)) return false;
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw new Error();
    const collection = collectSwimRpcDiagnostics(files, errors);
    const lines = [collection.status, ...collection.records].map((record) => JSON.stringify(record));
    if (lines.some((line) => Buffer.byteLength(line) > DIAGNOSTICS_LIMITS.recordBytes)) throw new Error();
    const text = `${lines.join("\n")}\n`;
    if (Buffer.byteLength(text) > DIAGNOSTICS_LIMITS.fileBytes) throw new Error();
    writeFileSync(fd, text);
    return true;
  } catch {
    if (fd !== undefined) {
      try {
        ftruncateSync(fd, 0);
        writeSync(fd, '{"kind":"collector","status":"unavailable","reason":"collector-failure","records":0}\n', 0);
      } catch { /* Missing/invalid marker is explicit unavailable evidence in the reader. */ }
    }
    return false;
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* The reader independently checks the completed sidecar. */ }
    }
  }
}

export default class SwimRpcDiagnosticsReporter implements Reporter {
  onFinished(files: Files = [], errors: unknown[] = []) {
    // HOME and the sole output path are supplied by the runner, never inherited by its child.
    const home = process.env.HOME;
    const path = process.env[DIAGNOSTICS_ENV];
    if (home && path && home === join(dirname(home), "home")) {
      writeSwimRpcDiagnostics(dirname(home), path, files, errors);
    }
  }
}

type Association = Omit<Diagnostic, "kind" | "caseHash" | "code" | "category" | "fingerprint"> & {
  suite: typeof DIAGNOSTICS_SUITE; case?: string; count: number;
};
type Group = Pick<Diagnostic, "code" | "category" | "fingerprint"> & { count: number; associations: Association[] };
type Evidence = {
  status: "complete" | "partial" | "unavailable"; reason: Reason; invalidRecords: number;
  unknownPermissionKinds: number; groups: Group[];
};
const unavailable = (reason: Reason, invalidRecords = 0): Evidence =>
  ({ status: "unavailable", reason, invalidRecords, unknownPermissionKinds: 0, groups: [] });

export function projectSwimRpcDiagnostics(text: string, ledger?: Ledger): Evidence {
  try {
    if (!text || Buffer.byteLength(text) > DIAGNOSTICS_LIMITS.fileBytes) return unavailable("sidecar-size");
    const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
    if (lines.length > DIAGNOSTICS_LIMITS.records + 1) return unavailable("record-limit");
    const parse = (line: string): unknown => {
      if (Buffer.byteLength(line) > DIAGNOSTICS_LIMITS.recordBytes) return null;
      try { return JSON.parse(line); } catch { return null; }
    };
    const header = statusSchema.safeParse(parse(lines[0]!));
    if (!header.success) return unavailable("sidecar-invalid", 1);
    const { status, reason, records } = header.data;
    if ((status === "complete") !== (reason === "collected") ||
      (status === "unavailable" && (reason !== "collector-failure" || records !== 0)) ||
      records !== lines.length - 1) return unavailable("sidecar-invalid", 1);
    if (status === "unavailable") return unavailable(reason);
    const names = ledger?.suites.length === 1 && ledger.suites[0]!.name === RPC_SUITE
      ? ledger.suites[0]!.cases.map((test) => test.name) : [];
    const canonical = new Map(names.filter((name) => Buffer.byteLength(name) <= DIAGNOSTICS_LIMITS.messageBytes)
      .slice(0, DIAGNOSTICS_LIMITS.tasks).map((name) => [digest(name), name]));
    const evidence: Evidence = { status, reason, invalidRecords: 0, unknownPermissionKinds: 0, groups: [] };
    const partial = (value: Reason) => {
      evidence.status = "partial";
      if (evidence.reason === "collected") evidence.reason = value;
    };
    if (!canonical.size) partial("canonical-cases-unavailable");
    for (const line of lines.slice(1)) {
      const parsed = recordSchema.safeParse(parse(line));
      if (!parsed.success || (parsed.data.phase !== "test" && parsed.data.caseHash !== undefined) ||
        (parsed.data.category !== categoryFor(parsed.data.code) && parsed.data.category !== "unclassified")) {
        evidence.invalidRecords++; partial("invalid-records"); continue;
      }
      const { caseHash, code, category, fingerprint, phase, errorClass, hasCause, identifiers, rpc, domainMessageId, deniedKind } = parsed.data;
      if (deniedKind === "unknown") evidence.unknownPermissionKinds++;
      const safe = { phase, errorClass, hasCause, identifiers, ...(rpc ? { rpc } : {}),
        ...(domainMessageId ? { domainMessageId } : {}), ...(deniedKind ? { deniedKind } : {}) };
      const name = caseHash ? canonical.get(caseHash) : undefined;
      if (safe.phase === "test" && !name) { evidence.invalidRecords++; partial("case-unverified"); }
      let group = evidence.groups.find((group) =>
        group.code === code && group.category === category && group.fingerprint === fingerprint);
      if (!group) {
        group = { ...(code ? { code } : {}), category, fingerprint, count: 0, associations: [] };
        evidence.groups.push(group);
      }
      group.count++;
      const association: Omit<Association, "count"> = {
        ...safe, suite: DIAGNOSTICS_SUITE, ...(name ? { case: name } : {}),
      };
      const existing = group.associations.find((item) =>
        JSON.stringify({ ...item, count: undefined }) === JSON.stringify(association));
      if (existing) existing.count++;
      else group.associations.push({ ...association, count: 1 });
    }
    return evidence;
  } catch {
    return unavailable("collector-failure");
  }
}

export function readSwimRpcDiagnostics(directory: string, started: number, ledger?: Ledger): Evidence {
  let fd: number | undefined;
  try {
    if (!privateDirectory(directory)) return unavailable("sidecar-invalid");
    const path = join(directory, DIAGNOSTICS_FILE);
    const link = lstatSync(path);
    if (!link.isFile() || link.isSymbolicLink()) return unavailable("sidecar-invalid");
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = fstatSync(fd);
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600 ||
      info.ino !== link.ino || info.dev !== link.dev) return unavailable("sidecar-invalid");
    if (info.mtimeMs < started || Math.floor(info.mtimeMs) > Date.now() || info.ctimeMs < started) return unavailable("sidecar-stale");
    if (!info.size || info.size > DIAGNOSTICS_LIMITS.fileBytes) return unavailable("sidecar-size");
    const buffer = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const bytes = readSync(fd, buffer, size, buffer.length - size, null);
      if (!bytes) break;
      size += bytes;
    }
    const after = fstatSync(fd);
    if (size !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs) return unavailable("sidecar-invalid");
    return projectSwimRpcDiagnostics(buffer.subarray(0, size).toString("utf8"), ledger);
  } catch {
    return unavailable("sidecar-unavailable");
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* No diagnostic failure may replace canonical acceptance. */ }
    }
  }
}
