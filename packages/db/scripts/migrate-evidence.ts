import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync,
  realpathSync, writeSync, type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { types } from "node:util";
import { z } from "zod";

export const MIGRATION_EVIDENCE_ENV = "HTA_MIGRATION_EVIDENCE_PATH";
export const MIGRATION_EVIDENCE_FILE = "migration-evidence.jsonl";
export const MIGRATION_EVIDENCE_MAX_BYTES = 8192;

// Version 1 codebook, in SQL vector order. t/f/u mean true/false/unknown.
// Attribute and privilege bits are expected-condition matches, not raw values.
export const MIGRATION_DIAGNOSTIC_FIELDS = {
  roles: ["actor", "postgresPresent", "authenticatedPresent", "servicePresent", "writerPresent", "anonPresent"],
  attributes: [
    "sharedPresent", "helperPresent",
    "sharedBody", "sharedOwner", "sharedLanguage", "sharedKind", "sharedVolatility",
    "sharedSecurity", "sharedLeakproof", "sharedStrict", "sharedParallel", "sharedConfig",
    "sharedArity", "sharedDefaultCount", "sharedDefault", "sharedArgTypes", "sharedAllArgTypes",
    "sharedArgModes", "sharedArgNames", "sharedReturnType", "sharedReturnsSet", "sharedVariadic",
    "sharedSupport", "sharedBinAbsent", "sharedSqlBodyAbsent",
    "helperBody", "helperOwner", "helperLanguage", "helperKind", "helperVolatility",
    "helperSecurity", "helperLeakproof", "helperStrict", "helperParallel", "helperConfig",
    "helperArity", "helperDefaultCount", "helperDefaultAbsent", "helperArgTypes",
    "helperAllArgTypesAbsent", "helperArgModesAbsent", "helperArgNamesAbsent",
    "helperReturnType", "helperReturnsSet", "helperVariadic", "helperSupport",
    "helperBinAbsent", "helperSqlBodyAbsent",
  ],
  // First two use normalized ACLs; direct membership uses the stored ACL.
  acl: [
    "exactMembership", "exactGrantorPrivilegeOptions", "defaultAcl",
    "directAnon", "directPublic", "allExpectedGrantors", "allExecute", "noGrantOptions",
  ],
  privileges: [
    "sharedAuthenticated", "sharedService", "sharedWriter", "sharedOwner", "sharedAnon",
    "helperAuthenticated", "helperService", "helperWriter", "helperOwner", "helperAnon",
  ],
} as const;

export type MigrationDiagnostic = {
  version: 1;
  guard: keyof typeof MIGRATION_DIAGNOSTIC_FIELDS;
  phase: "pre" | "post";
  object: "roles" | "both" | "shared" | "helper";
  bits: string;
};

export function parseMigrationScid(message: unknown): MigrationDiagnostic | undefined {
  if (typeof message !== "string" || message.length > 100) return;
  const match = /^SCID\/1\/(roles|attributes|acl|privileges)\/(pre|post)\/(roles|both|shared|helper)\/([tfu]{1,48})$/.exec(message);
  if (!match) return;
  const guard = match[1] as MigrationDiagnostic["guard"];
  const phase = match[2] as MigrationDiagnostic["phase"];
  const object = match[3] as MigrationDiagnostic["object"];
  const bits = match[4]!;
  if (bits.length !== MIGRATION_DIAGNOSTIC_FIELDS[guard].length ||
      (guard === "roles" ? object !== "roles" || phase !== "pre" :
        guard === "acl" ? object !== "shared" && object !== "helper" : object !== "both")) return;
  return { version: 1, guard, phase, object, bits };
}

const diagnosticSchema = z.object({
  version: z.literal(1), guard: z.enum(["roles", "attributes", "acl", "privileges"]),
  phase: z.enum(["pre", "post"]), object: z.enum(["roles", "both", "shared", "helper"]),
  bits: z.string().max(48),
}).strict().refine((v) => !!parseMigrationScid(`SCID/1/${v.guard}/${v.phase}/${v.object}/${v.bits}`));
const classSchema = z.enum(["Error", "TypeError", "SyntaxError", "RangeError", "DrizzleError", "DrizzleQueryError", "PostgresError", "unknown"]);
const driverSchema = z.enum([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE",
  "ENOENT", "EACCES", "EPERM", "CONNECTION_CLOSED", "CONNECTION_ENDED",
  "CONNECTION_DESTROYED", "CONNECT_TIMEOUT", "UNDEFINED_VALUE", "MESSAGE_NOT_SUPPORTED",
]);
const severitySchema = z.enum(["ERROR", "FATAL", "PANIC", "WARNING", "NOTICE", "DEBUG", "INFO", "LOG"]);
const errorSchema = z.object({
  classification: classSchema,
  driverCode: driverSchema.nullable(),
  sqlstate: z.string().regex(/^[0-9A-Z]{5}$/).nullable(),
  severity: severitySchema.nullable(),
  scid: diagnosticSchema.nullable(),
  projection: z.enum(["complete", "rejected"]),
}).strict();
const positionSchema = z.union([
  z.object({ status: z.literal("unmatched") }).strict(),
  z.object({
    status: z.literal("matched"),
    migrationIndex: z.number().int().min(0).max(147),
    statementIndex: z.number().int().min(0).max(9999),
  }).strict(),
]);
const phaseSchema = z.enum(["config", "dependencies", "client", "migrate"]);
const terminalSchema = z.object({
  event: z.literal("terminal"), status: z.enum(["success", "failure"]), phase: phaseSchema,
  error: errorSchema.nullable(), position: positionSchema,
}).strict().refine((v) => v.status === "failure" ? v.error !== null : v.error === null && v.phase === "migrate");
const startSchema = z.object({ event: z.literal("started"), version: z.literal(1) }).strict();
const shutdownSchema = z.object({
  event: z.literal("shutdown"), status: z.enum(["closed", "failed", "timed-out", "not-created"]),
  error: errorSchema.nullable(),
}).strict().refine((v) => v.status === "failed" ? v.error !== null : v.error === null);
export type MigrationTerminal = z.infer<typeof terminalSchema>;
export type MigrationShutdown = z.infer<typeof shutdownSchema>;
export type MigrationPhase = z.infer<typeof phaseSchema>;
export type CanonicalMigrations = readonly { sql: readonly string[] }[];
type ProjectedError = z.infer<typeof errorSchema>;

// Only these own data fields may be inspected. Never enumerate an exception.
function own(value: object, key: "name" | "code" | "severity" | "message" | "cause" | "query") {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !Object.hasOwn(descriptor, "value")) throw new Error("Rejected accessor");
  return descriptor?.value as unknown;
}

export function projectMigrationError(error: unknown, canonical?: () => CanonicalMigrations): {
  error: ProjectedError; position: z.infer<typeof positionSchema>;
} {
  const projected: ProjectedError = {
    classification: "unknown", driverCode: null, sqlstate: null, severity: null, scid: null, projection: "complete",
  };
  let position: z.infer<typeof positionSchema> = { status: "unmatched" };
  try {
    const seen = new Set<object>();
    let current = error;
    let query: string | undefined;
    let postgresSeen = false;
    for (let depth = 0; current !== undefined && current !== null; depth++) {
      if (depth === 8 || typeof current !== "object" || types.isProxy(current) || seen.has(current)) {
        throw new Error("Rejected cause");
      }
      seen.add(current);
      const name = own(current, "name");
      const code = own(current, "code");
      const severity = own(current, "severity");
      const classification = classSchema.safeParse(name);
      if (depth === 0) projected.classification = classification.success ? classification.data :
        types.isNativeError(current) ? "Error" : "unknown";
      const driver = driverSchema.safeParse(code);
      if (driver.success) {
        if (projected.driverCode && projected.driverCode !== driver.data) throw new Error("Ambiguous code");
        projected.driverCode = driver.data;
      }
      if (types.isNativeError(current) && name === "PostgresError" &&
          severitySchema.safeParse(severity).success && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
        if (postgresSeen) throw new Error("Ambiguous postgres cause");
        postgresSeen = true;
        projected.sqlstate = code;
        projected.severity = severity as ProjectedError["severity"];
        projected.scid = parseMigrationScid(own(current, "message")) ?? null;
      }
      const statement = own(current, "query");
      if (statement !== undefined) {
        if (typeof statement !== "string" || statement.length > 2 * 1024 * 1024 ||
            (query !== undefined && query !== statement)) {
          throw new Error("Ambiguous query");
        }
        query = statement;
      }
      current = own(current, "cause");
    }
    if (query !== undefined && canonical) {
      // Attribution failure is a complete unmatched outcome, never a replacement error.
      try {
        const migrations = canonical();
        let matches = 0;
        if (migrations.length <= 148) {
          migrations.forEach((migration, migrationIndex) => {
            if (migration.sql.length > 10000) throw new Error("Attribution bound");
            migration.sql.forEach((sql, statementIndex) => {
              if (sql === query) { matches++; position = { status: "matched", migrationIndex, statementIndex }; }
            });
          });
        }
        if (matches !== 1) position = { status: "unmatched" };
      } catch { position = { status: "unmatched" }; }
    }
    return { error: projected, position };
  } catch {
    return { error: { classification: "unknown", driverCode: null, sqlstate: null, severity: null, scid: null, projection: "rejected" },
      position: { status: "unmatched" } };
  }
}

function same(a: Stats, b: Stats) { return a.dev === b.dev && a.ino === b.ino; }
function privateStat(stat: Stats, directory: boolean) {
  if (typeof process.getuid !== "function" || stat.uid !== process.getuid() ||
      (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600) ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) {
    throw new Error("Invalid private evidence identity");
  }
}

function evidenceDirectory(path: string) {
  if (!isAbsolute(path) || resolve(path) !== path || basename(path) !== MIGRATION_EVIDENCE_FILE) {
    throw new Error("Invalid evidence path");
  }
  const directory = dirname(path);
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  if (!/^swim-acceptance-pr802-[1-9][0-9]*-[1-9][0-9]*$/.test(basename(directory)) ||
      directory === checkout || directory.startsWith(checkout + sep) || realpathSync(directory) !== directory) {
    throw new Error("Invalid evidence directory");
  }
  const stat = lstatSync(directory);
  privateStat(stat, true);
  return stat;
}

export type EvidenceIdentity = { file: Stats; directory: Stats };
function verify(path: string, fd: number, identity: EvidenceIdentity) {
  if (!same(evidenceDirectory(path), identity.directory)) throw new Error("Changed evidence directory");
  const stat = fstatSync(fd);
  privateStat(stat, false);
  const current = lstatSync(path);
  privateStat(current, false);
  if (!same(stat, identity.file) || !same(stat, current) || stat.size > MIGRATION_EVIDENCE_MAX_BYTES) {
    throw new Error("Changed evidence file");
  }
}
function writeRecord(fd: number, record: unknown) {
  const bytes = Buffer.from(JSON.stringify(record) + "\n");
  if (fstatSync(fd).size + bytes.length > MIGRATION_EVIDENCE_MAX_BYTES) throw new Error("Evidence bound");
  let offset = 0;
  while (offset < bytes.length) {
    const count = writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Evidence write failed");
    offset += count;
  }
  fsyncSync(fd);
}

export function openMigrationEvidence(path: string) {
  const directory = evidenceDirectory(path);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const identity = { directory, file: fstatSync(fd) };
  let closed = false;
  try {
    verify(path, fd, identity);
    writeRecord(fd, { event: "started", version: 1 });
  } catch (error) { closeSync(fd); throw error; }
  return {
    identity,
    terminal(value: MigrationTerminal) {
      if (closed) throw new Error("Evidence already closed");
      try {
        verify(path, fd, identity);
        writeRecord(fd, terminalSchema.parse(value));
      } finally { closed = true; closeSync(fd); }
    },
  };
}

export function appendMigrationShutdown(path: string, identity: EvidenceIdentity, value: MigrationShutdown) {
  // Reopen only the already-durable file; never create or replace it.
  const existing = readMigrationEvidence(path, identity);
  if (existing.status !== "complete" || existing.shutdown !== null) throw new Error("Invalid terminal evidence");
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { verify(path, fd, identity); writeRecord(fd, shutdownSchema.parse(value)); }
  finally { closeSync(fd); }
}

export function readMigrationEvidence(path: string, expected?: EvidenceIdentity):
  | { status: "incomplete" }
  | { status: "complete"; terminal: MigrationTerminal; shutdown: MigrationShutdown | null } {
  try {
    const directory = evidenceDirectory(path);
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd);
      const identity = expected ?? { directory, file: before };
      verify(path, fd, identity);
      if (before.size < 1) return { status: "incomplete" };
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = readSync(fd, bytes, offset, bytes.length - offset, offset);
        if (!count) return { status: "incomplete" };
        offset += count;
      }
      verify(path, fd, identity);
      if (fstatSync(fd).size !== before.size) return { status: "incomplete" };
      const lines = bytes.toString("utf8").split("\n");
      if (lines.pop() !== "" || (lines.length !== 2 && lines.length !== 3)) return { status: "incomplete" };
      startSchema.parse(JSON.parse(lines[0]!));
      const terminal = terminalSchema.parse(JSON.parse(lines[1]!));
      const shutdown = lines.length === 3 ? shutdownSchema.parse(JSON.parse(lines[2]!)) : null;
      return { status: "complete", terminal, shutdown };
    } finally { closeSync(fd); }
  } catch { return { status: "incomplete" }; }
}
