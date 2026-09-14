import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonTestResults } from "vitest/reporters";

const directory = dirname(fileURLToPath(import.meta.url));
export const RPC_SUITE = resolve(directory, "storage-rpc.smoke.test.ts");
export const RPC_CONFIG = resolve(directory, "../../../../vitest.config.ts");
export const MIN_RPC_CASES = 30;

const counters = [
  "numTotalTests", "numPassedTests", "numFailedTests", "numPendingTests", "numTodoTests",
  "numTotalTestSuites", "numPassedTestSuites", "numFailedTestSuites", "numPendingTestSuites",
] as const;

export function validateSwimRpcReport(text: string, testedSha: string, configSha256: string) {
  assert.match(testedSha, /^[a-f0-9]{40}$/, "Missing or invalid tested SHA");
  assert.match(configSha256, /^[a-f0-9]{64}$/, "Missing or invalid config SHA-256");
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error("Missing, empty or malformed RPC JSON report"); }
  assert(parsed && typeof parsed === "object", "Invalid RPC report object");
  const report = parsed as JsonTestResults;
  for (const key of counters) {
    assert(Number.isSafeInteger(report[key]) && report[key] >= 0, `Missing or invalid ${key}`);
  }
  assert(typeof report.success === "boolean", "Missing report success");
  assert(Array.isArray(report.testResults), "Missing testResults");
  const issues: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) issues.push(message); };
  check(report.testResults.length === 1, "Expected exactly one RPC test file");
  const suites = report.testResults.map((suite) => {
    assert(suite && typeof suite === "object", "Invalid suite");
    assert(typeof suite.name === "string", "Missing suite identity");
    check(suite.name === RPC_SUITE, "Wrong RPC suite identity");
    assert(suite.status === "passed" || suite.status === "failed", "Invalid suite status");
    check(suite.status === "passed", "Failed RPC suite");
    assert(Array.isArray(suite.assertionResults), "Missing assertionResults");
    const cases = suite.assertionResults.map((test) => {
      assert(test && typeof test === "object", "Invalid assertion");
      assert(typeof test.fullName === "string" && test.fullName.trim(), "Missing case identity");
      assert(["passed", "failed", "skipped", "pending", "todo", "disabled"].includes(test.status),
        "Invalid assertion status");
      assert(Array.isArray(test.failureMessages) &&
        test.failureMessages.every((message) => typeof message === "string"), "Invalid failureMessages");
      check(test.status === "passed" && test.failureMessages.length === 0, "Non-passed RPC assertion");
      return { name: test.fullName, status: test.status };
    });
    return { name: suite.name, status: suite.status, cases };
  });
  const cases = suites.flatMap((suite) => suite.cases);
  check(cases.length >= MIN_RPC_CASES, `Expected at least ${MIN_RPC_CASES} RPC cases`);
  check(new Set(cases.map((test) => test.name)).size === cases.length, "Duplicate case identity");
  check(report.success, "Unsuccessful RPC report");
  check(report.numTotalTests === cases.length, "Total test count does not match assertions");
  check(report.numPassedTests === cases.filter((test) => test.status === "passed").length,
    "Passed test count does not match assertions");
  check(report.numFailedTests === cases.filter((test) => test.status === "failed").length,
    "Failed test count does not match assertions");
  check(report.numFailedTests === 0 && report.numPendingTests === 0 && report.numTodoTests === 0 &&
    report.numPassedTests === report.numTotalTests, "Not all counted tests passed");
  // Vitest counts nested describe suites, not just testResults (one entry per file).
  check(report.numTotalTestSuites >= suites.length &&
    report.numTotalTestSuites === report.numPassedTestSuites + report.numFailedTestSuites + report.numPendingTestSuites,
  "Inconsistent suite counts");
  check(report.numFailedTestSuites === 0 && report.numPendingTestSuites === 0, "Non-passed suite count");
  return {
    success: issues.length === 0, issues: [...new Set(issues)],
    testedSha, config: RPC_CONFIG, configSha256, expectedSuite: RPC_SUITE,
    minimumCases: MIN_RPC_CASES,
    totals: Object.fromEntries(counters.map((key) => [key, report[key]])),
    suites,
  };
}

export function readSwimRpcReport(path: string, testedSha: string, configSha256: string) {
  let text: string;
  try { text = readFileSync(path, "utf8"); }
  catch { throw new Error("Missing or unreadable RPC JSON report"); }
  return validateSwimRpcReport(text, testedSha, configSha256);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , path, testedSha, configSha256] = process.argv;
    assert(path && testedSha && configSha256, "Usage: storage-rpc-report.ts REPORT TESTED_SHA CONFIG_SHA256");
    const ledger = readSwimRpcReport(path, testedSha, configSha256);
    console.log(JSON.stringify(ledger, null, 2));
    if (!ledger.success) process.exitCode = 1;
  } catch {
    // Never echo raw JSON, parse errors or filesystem errors from private reports.
    console.error(JSON.stringify({ success: false, issues: ["RPC report missing, malformed or invalid; inspect private diagnostics"] }));
    process.exitCode = 1;
  }
}
