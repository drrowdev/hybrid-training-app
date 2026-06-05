import { readSeedConfig, SKIP_MESSAGE } from "./fixtures/seed";
import { appendFileSync } from "fs";

/**
 * Playwright global setup — coverage-gap guard.
 *
 * Most of this repo's E2E specs seed a real Supabase project (see
 * `fixtures/seed.ts`). When no seed credentials are configured they
 * silently `test.skip`, so the e2e job can pass fully GREEN while large
 * swaths of coverage never actually run — exactly the trap that let the
 * session-log / program-run specs drift out of sync with the app.
 *
 * This setup makes that skip LOUD rather than silent:
 *   - Emits a GitHub Actions `::warning::` annotation (visible on the PR
 *     checks page + the job log) when seed creds are absent.
 *   - Writes a prominent note to the job summary.
 *   - Optionally HARD-FAILS the run when `E2E_REQUIRE_SEED=1` is set, so a
 *     pipeline that DOES wire credentials can enforce that the seeded
 *     suites actually executed.
 *
 * It never fails by default — forks / PRs without secrets (and this
 * project's deliberate choice not to store prod DB creds in CI) keep a
 * green-but-honest run.
 */
export default function globalSetup(): void {
  const cfg = readSeedConfig();
  if (cfg) return; // creds present — seeded specs will run; nothing to flag.

  const requireSeed = process.env.E2E_REQUIRE_SEED === "1";
  const headline =
    "E2E seed credentials are NOT configured — every seeded spec " +
    "(session-log, program-run, today-page, onboarding, etc.) will SKIP. " +
    "Their coverage is NOT exercised in this run.";

  // GitHub Actions annotation — surfaces on the checks page, not just the log.
  if (process.env.GITHUB_ACTIONS === "true") {
    // eslint-disable-next-line no-console
    console.log(`::warning title=E2E coverage gap::${headline}`);
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      try {
        appendFileSync(
          summaryPath,
          [
            "## ⚠️ E2E seeded coverage SKIPPED",
            "",
            headline,
            "",
            "Set `E2E_SUPABASE_URL` / `E2E_SUPABASE_SERVICE_ROLE_KEY` / " +
              "`E2E_SUPABASE_ANON_KEY` (or the `NEXT_PUBLIC_*` fallbacks) to " +
              "actually run them. See `apps/web/e2e/README.md`.",
            "",
          ].join("\n"),
        );
      } catch {
        // Job summary is best-effort — never fail setup over it.
      }
    }
  }

  // Always log to the console so a local run surfaces it too.
  // eslint-disable-next-line no-console
  console.warn(`\n[e2e] ⚠️  ${headline}\n${SKIP_MESSAGE}\n`);

  if (requireSeed) {
    throw new Error(
      "E2E_REQUIRE_SEED=1 but no seed credentials are configured — " +
        "refusing to run with the seeded suites skipped.",
    );
  }
}
