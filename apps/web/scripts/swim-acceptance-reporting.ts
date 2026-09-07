import nodeAssert, { AssertionError } from "node:assert/strict";
import { appendFileSync, closeSync, constants as fsConstants, fstatSync, openSync, readSync } from "node:fs";
import { constants } from "node:os";
import type { ProcessResult } from "./swim-acceptance-guards";
import {
  parseMigrationScid, type MigrationDiagnostic, type readMigrationEvidence,
} from "../../../packages/db/scripts/migrate-evidence";
export { MIGRATION_DIAGNOSTIC_FIELDS } from "../../../packages/db/scripts/migrate-evidence";

type FailureCause = {
  classification: "guard" | "process" | "assertion" | "parser" | "unexpected";
  message: string;
  result?: ProcessResult;
};
type Failure = { stage: string; cause: FailureCause };
type Stage = { name: string; status: string; at: string; failure?: FailureCause };
const authoredCauses = new WeakMap<object, FailureCause>();

// Only messages supplied by local call sites are public, never Node's assertion diffs.
function authoredAssertion(action: () => void, message?: string) {
  try { action(); } catch (error) {
    if (error instanceof AssertionError && message) {
      authoredCauses.set(error, { classification: "guard", message });
    }
    throw error;
  }
}

export const acceptanceAssert: {
  (value: unknown, message?: string): asserts value;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  match(value: string, regexp: RegExp, message?: string): void;
} = Object.assign(
  (value: unknown, message?: string) => authoredAssertion(() => nodeAssert(value, message), message),
  {
    deepEqual: (actual: unknown, expected: unknown, message?: string) =>
      authoredAssertion(() => nodeAssert.deepEqual(actual, expected, message), message),
    match: (value: string, regexp: RegExp, message?: string) =>
      authoredAssertion(() => nodeAssert.match(value, regexp, message), message),
  },
);

export function processFailure(result: ProcessResult) {
  const error = new Error("Process failed or timed out");
  authoredCauses.set(error, {
    classification: "process", message: error.message,
    result: {
      code: Number.isSafeInteger(result.code) ? result.code : null,
      signal: result.signal === null || result.signal === "spawn-error" ||
        Object.hasOwn(constants.signals, result.signal) ? result.signal : "unknown-signal",
      timedOut: result.timedOut === true,
    },
  });
  return error;
}

export function safeFailureCause(error: unknown): FailureCause {
  if (error instanceof Error) {
    const authored = authoredCauses.get(error);
    if (authored) return authored;
    if (error instanceof AssertionError) {
      return { classification: "assertion", message: "Acceptance assertion failed; generated details withheld" };
    }
    if (error instanceof SyntaxError) {
      return { classification: "parser", message: "Acceptance data could not be parsed; raw data withheld" };
    }
  }
  return { classification: "unexpected", message: "Unexpected acceptance error; details withheld" };
}

export class AcceptanceReporting {
  readonly stages: Stage[] = [];
  readonly failures: { primary: Failure | null; secondary: Failure[]; cleanup: Failure[] } =
    { primary: null, secondary: [], cleanup: [] };

  recordFailure(stage: string, error: unknown, cleanup = false) {
    const failure = { stage, cause: safeFailureCause(error) };
    if (cleanup) this.failures.cleanup.push(failure);
    else if (!this.failures.primary) this.failures.primary = failure;
    else this.failures.secondary.push(failure);
  }

  async stage<T>(name: string, action: () => Promise<T>, onStart: (stage: Stage) => void): Promise<T> {
    const entry: Stage = { name, status: "running", at: new Date().toISOString() };
    this.stages.push(entry);
    try {
      onStart(entry);
      const value = await action();
      entry.status = "passed";
      return value;
    } catch (error) {
      entry.status = "failed";
      entry.failure = safeFailureCause(error);
      this.recordFailure(name, error);
      throw error;
    }
  }
}

export function finishMigrationEvidenceAttempt(
  result: ProcessResult, evidence: ReturnType<typeof readMigrationEvidence>,
  manifest: Record<string, unknown>, reporting: AcceptanceReporting,
): never {
  manifest.qualifying = false;
  manifest.migrationEvidence = evidence;
  const secondary = (message: string) => reporting.failures.secondary.push({
    stage: "migration evidence", cause: { classification: "guard", message },
  });
  if (evidence.status === "incomplete") secondary("Migration evidence incomplete");
  else if (!evidence.shutdown) secondary("Migration shutdown evidence unavailable");
  else if (evidence.shutdown.status === "failed" || evidence.shutdown.status === "timed-out") {
    secondary("Migration shutdown failed or timed out");
  }
  // A failed child remains primary; evidence collection never changes its process result.
  if (result.code !== 0 || result.signal !== null || result.timedOut) throw processFailure(result);
  acceptanceAssert(false, "NON-QUALIFYING: normal-migration-still-required");
}

export function formatAcceptanceSummary(data: unknown, secrets: Iterable<string> = []) {
  let text = JSON.stringify(data, null, 2);
  for (const secret of secrets) {
    if (secret) text = text.replaceAll(JSON.stringify(secret).slice(1, -1), "[redacted]");
  }
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function publishAcceptanceSummary(
  path: string, heading: string, data: unknown, secrets: Iterable<string> = [],
) {
  const text = formatAcceptanceSummary(data, secrets);
  const summary = `\n### ${heading}\n<pre>${text}</pre>\n`;
  console.log(`[swim-acceptance-summary]${summary}`);
  appendFileSync(path, summary);
}

export function openPrivateCommandLog(path: string) {
  const fd = openSync(path, "ax", 0o600);
  return { fd, append: (chunk: Buffer) => appendFileSync(path, chunk) };
}

export function commandStdout(
  log: ReturnType<typeof openPrivateCommandLog>,
  options: { capture?: boolean; separateStdout?: boolean },
  onLimit: () => void,
) {
  let text = "";
  return {
    stdio: options.capture || options.separateStdout ? "pipe" as const : log.fd,
    get text() { return text; },
    onData(chunk: Buffer) {
      if (!options.separateStdout) log.append(chunk);
      text += chunk.toString("utf8");
      if (text.length > 8 * 1024 * 1024) onLimit();
    },
  };
}

export const MIGRATION_DIAGNOSTIC_MAX_BYTES = 256 * 1024;

type MigrationEvidence = MigrationDiagnostic | "unavailable";

export function decodeMigrationDiagnostic(text: string): MigrationEvidence {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > MIGRATION_DIAGNOSTIC_MAX_BYTES) {
    return "unavailable";
  }
  let found: MigrationDiagnostic | undefined;
  let inQuery = false;
  for (const line of text.split("\n")) {
    if (line.includes("DrizzleQueryError: Failed query:") || /^ *query:/.test(line) ||
        /^ *(?:DO |RAISE |SELECT |CONTEXT:|STATEMENT:|QUERY:)/.test(line)) inQuery = true;
    if (!line.includes("SCID/")) continue;
    // Runtime concatenation leaves this incomplete fragment in SQL/query echoes.
    // It can never supply evidence, even if the actual exception is absent.
    if (line.includes("'SCID/'") && !/SCID\/[^'"]/.test(line)) continue;
    // Do not strip controls, unquote source, or search inside arbitrary messages.
    const match = /^ {0,8}(\[cause\]: )?(?:PostgresError|error): SCID\/(1)\/(roles|attributes|acl|privileges)\/(pre|post)\/(roles|both|shared|helper)\/([tfu]{1,48})$/.exec(line);
    if (!match || (inQuery && !match[1])) return "unavailable";
    const value = parseMigrationScid(`SCID/${match[2]}/${match[3]}/${match[4]}/${match[5]}/${match[6]}`);
    if (!value) return "unavailable";
    if (found && JSON.stringify(found) !== JSON.stringify(value)) return "unavailable";
    found = value;
  }
  return found ?? "unavailable";
}

// Only the completed migration command's own exclusive 0600 log is passed here.
export function readMigrationDiagnostic(path: string): MigrationEvidence {
  const fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) return "unavailable";
    const length = Math.min(stat.size, MIGRATION_DIAGNOSTIC_MAX_BYTES);
    const start = stat.size - length;
    const tail = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = readSync(fd, tail, read, length - read, start + read);
      if (!count) return "unavailable";
      read += count;
    }
    if (fstatSync(fd).size !== stat.size) return "unavailable";
    // Never interpret a line whose prefix fell outside the bounded tail.
    const boundary = start > 0 ? tail.indexOf(10) : -1;
    if (start > 0 && boundary === -1) return "unavailable";
    return decodeMigrationDiagnostic(tail.subarray(boundary + 1).toString("utf8"));
  } finally { closeSync(fd); }
}
