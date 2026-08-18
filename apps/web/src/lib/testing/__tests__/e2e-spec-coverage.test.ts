/**
 * Guard: every Playwright spec must be claimed by at least one project.
 *
 * `playwright.config.ts` selects specs per project with a filename regex
 * (`*-desktop.spec.ts` / `*-mobile.spec.ts`). A spec matching neither was
 * silently dropped — not run, not skipped, not reported — so the e2e job went
 * green while never executing it. Twelve specs (14 tests) were invisible this
 * way before the catch-all project was added.
 *
 * This runs in the standard unit-test job, which executes on every PR, so the
 * gap is caught even when the e2e job itself self-skips.
 */
import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import path from "node:path";
import config from "../../../../playwright.config";

type Matcher = RegExp | string | (RegExp | string)[] | undefined;

function matches(matcher: Matcher, file: string): boolean {
  if (matcher == null) return false;
  const list = Array.isArray(matcher) ? matcher : [matcher];
  return list.some((m) =>
    typeof m === "string" ? file.includes(m) : m.test(file),
  );
}

function claimedBy(file: string) {
  return (config.projects ?? []).filter(
    (project) =>
      matches(project.testMatch as Matcher, file) &&
      !matches(project.testIgnore as Matcher, file),
  );
}

const specFiles = readdirSync(path.join(process.cwd(), "e2e"))
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

describe("playwright project coverage", () => {
  it("has spec files to check", () => {
    expect(specFiles.length).toBeGreaterThan(0);
    expect(config.projects?.length ?? 0).toBeGreaterThan(0);
  });

  it("claims every spec file with at least one project", () => {
    const orphans = specFiles.filter((file) => claimedBy(file).length === 0);
    expect(
      orphans,
      `these specs match no Playwright project and would never run:\n  ${orphans.join("\n  ")}`,
    ).toEqual([]);
  });

  it("never assigns the same spec to two projects", () => {
    // Double-matching silently doubles CI time and produces confusing
    // duplicate failures at two different viewports.
    const doubled = specFiles.filter((file) => claimedBy(file).length > 1);
    expect(
      doubled,
      `these specs are claimed by more than one project:\n  ${doubled.join("\n  ")}`,
    ).toEqual([]);
  });
});
