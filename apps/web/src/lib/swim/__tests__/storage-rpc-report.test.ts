import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MIN_RPC_CASES, RPC_CONFIG, RPC_SUITE, readSwimRpcReport, validateSwimRpcReport } from "./storage-rpc-report";

const sha = "a".repeat(40);
const configHash = "b".repeat(64);
function fixture(count = MIN_RPC_CASES) {
  return {
    success: true,
    numTotalTests: count, numPassedTests: count, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0,
    numTotalTestSuites: 2, numPassedTestSuites: 2, numFailedTestSuites: 0, numPendingTestSuites: 0,
    testResults: [{
      name: RPC_SUITE, status: "passed",
      assertionResults: Array.from({ length: count }, (_, index) => ({
        fullName: `RPC case ${index + 1}`, status: "passed", failureMessages: [] as string[],
      })),
    }],
  };
}
const validate = (report: unknown) => validateSwimRpcReport(JSON.stringify(report), sha, configHash);

describe("fail-closed swim RPC JSON ledger", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

  it("reads a report and preserves SHA, config, suite, actual counters and each case", () => {
    const directory = mkdtempSync(join(tmpdir(), "swim-report-"));
    directories.push(directory);
    const path = join(directory, "rpc.json");
    writeFileSync(path, JSON.stringify(fixture()));
    const ledger = readSwimRpcReport(path, sha, configHash);
    expect(ledger).toMatchObject({ success: true, testedSha: sha, config: RPC_CONFIG, configSha256: configHash });
    expect(ledger.totals.numTotalTestSuites).toBe(2);
    expect(ledger.suites[0]).toEqual({
      name: RPC_SUITE, status: "passed",
      cases: fixture().testResults[0]!.assertionResults.map(({ fullName, status }) => ({ name: fullName, status })),
    });
  });

  it("rejects a missing report", () => {
    const directory = mkdtempSync(join(tmpdir(), "swim-report-"));
    directories.push(directory);
    expect(() => readSwimRpcReport(join(directory, "missing.json"), sha, configHash)).toThrow();
  });

  it.each(["", " ", "{", "null", "[]", "{}"])("rejects empty/malformed JSON or schema: %j", (text) => {
    expect(() => validateSwimRpcReport(text, sha, configHash)).toThrow();
  });

  it.each([0, 1, 29])("rejects only %i collected cases", (count) => {
    expect(validate(fixture(count)).success).toBe(false);
  });

  it("accepts additional passing cases without inventing a skipped counter", () => {
    expect(validate(fixture(31)).success).toBe(true);
    expect(validate(fixture()).totals).not.toHaveProperty("numSkippedTests");
  });

  it("rejects no files and a wrong or additional file", () => {
    const report = fixture();
    report.testResults = [];
    expect(validate(report).success).toBe(false);
    report.testResults = fixture().testResults;
    report.testResults[0]!.name = RPC_SUITE.replace("storage-rpc.smoke", "storage-rpc-config");
    expect(validate(report).success).toBe(false);
    report.testResults = [...fixture().testResults, ...fixture().testResults];
    expect(validate(report).success).toBe(false);
  });

  it.each(["failed", "skipped", "pending", "todo", "disabled"])("rejects any %s assertion even with green counters", (status) => {
    const report = fixture();
    report.testResults[0]!.assertionResults[4]!.status = status;
    const ledger = validate(report);
    expect(ledger.success).toBe(false);
    expect(ledger.suites[0]!.cases[4]!.status).toBe(status);
  });

  it("rejects partial failure and retains its case status without raw failure messages", () => {
    const report = fixture();
    report.success = false;
    report.numPassedTests--;
    report.numFailedTests++;
    report.testResults[0]!.status = "failed";
    report.testResults[0]!.assertionResults[0]!.status = "failed";
    report.testResults[0]!.assertionResults[0]!.failureMessages = ["private diagnostic"];
    const ledger = validate(report);
    expect(ledger.success).toBe(false);
    expect(ledger.suites[0]!.cases[0]!.status).toBe("failed");
    expect(JSON.stringify(ledger)).not.toContain("private diagnostic");
  });

  it.each(["numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests",
    "numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites"] as const)(
    "requires an explicit nonnegative integer %s", (key) => {
      for (const value of [undefined, null, "0", -1, 0.5]) {
        expect(() => validate({ ...fixture(), [key]: value })).toThrow();
      }
    },
  );

  it("rejects inconsistent totals, unsuccessful reports and suite-level failures", () => {
    for (const change of [
      { success: false }, { numTotalTests: 31 }, { numPassedTests: 29 },
      { numPendingTests: 1 }, { numTodoTests: 1 }, { numTotalTestSuites: 3 },
      { numPassedTestSuites: 1, numFailedTestSuites: 1 },
      { numPassedTestSuites: 1, numPendingTestSuites: 1 },
    ]) expect(validate({ ...fixture(), ...change }).success).toBe(false);
    const report = fixture();
    report.testResults[0]!.status = "failed";
    expect(validate(report).success).toBe(false);
  });

  it("rejects duplicate identities, missing status and contradictory failure messages", () => {
    const report = fixture();
    report.testResults[0]!.assertionResults[1] = report.testResults[0]!.assertionResults[0]!;
    expect(validate(report).success).toBe(false);
    report.testResults[0]!.assertionResults[0]!.status = "";
    expect(() => validate(report)).toThrow();
    const passed = fixture();
    passed.testResults[0]!.assertionResults[0]!.failureMessages = ["failure"];
    expect(validate(passed).success).toBe(false);
  });

  it("requires tested SHA and config hash", () => {
    expect(() => validateSwimRpcReport(JSON.stringify(fixture()), "", configHash)).toThrow();
    expect(() => validateSwimRpcReport(JSON.stringify(fixture()), sha, "")).toThrow();
  });
});
