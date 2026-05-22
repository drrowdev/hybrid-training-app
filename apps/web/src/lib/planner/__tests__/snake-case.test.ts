/**
 * Regression-prevention test for the snake_case-vs-camelCase bug
 * introduced in commit 520b8d0c and fixed in fix/createblock-snake-case.
 *
 * Symptom (PGRST204):
 *   `Could not find the 'blockId' column of 'planned_sessions' in the
 *    schema cache`
 *
 * Root cause:
 *   `createBlock` / `createCustomBlock` pushed `planned_sessions` rows
 *   using the Drizzle property names (`blockId`, `userId`, `weekIndex`,
 *   `dayIndex`) instead of the actual snake_case DB column names. The
 *   Supabase REST client does NOT translate — it sends whatever keys
 *   you give it as column names, so PostgREST rejected the insert and
 *   "Start this block" silently failed.
 *
 * This test parses actions.ts as text and asserts that *every* object
 * literal pushed into the `planned_sessions` insert array uses only
 * snake_case keys. It's intentionally text-based + static so we don't
 * depend on a live Supabase, and so an accidental rename to camelCase
 * trips the test at unit-test speed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ACTIONS_PATH = join(__dirname, "..", "actions.ts");
const SOURCE = readFileSync(ACTIONS_PATH, "utf8");

// Columns that previously drifted to camelCase. If anyone reintroduces
// one of these spellings in actions.ts we want the test to fail loudly.
const FORBIDDEN_CAMEL_KEYS = [
  "blockId",
  "userId",
  "weekIndex",
  "dayIndex",
  "plannedAt",
  "completedSessionId",
  "skippedAt",
  "startedOn",
  "daysPerWeek",
  "dayIndexOverrides",
  "movementId",
  "sessionId",
  "setKind",
  "weightKg",
  "durationSec",
] as const;

/**
 * Locate every `.from("<table>").insert({ ... })` / `.update({ ... })`
 * literal in the source and return the body of each `{}` so we can
 * assert on the keys inside.
 */
function extractInlineObjectLiterals(
  source: string,
  method: "insert" | "update",
): string[] {
  const literals: string[] = [];
  const re = new RegExp(`\\.${method}\\(\\s*\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    // Walk forward from the `{` we just matched, balancing braces, so
    // nested objects (e.g. JSONB prescriptions) don't confuse us.
    const start = match.index + match[0].length - 1;
    let depth = 0;
    let i = start;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth === 0) {
      literals.push(source.slice(start + 1, i));
    }
  }
  return literals;
}

/**
 * `key:` patterns at the top of an object literal. We ignore nested
 * objects by tracking brace/bracket/paren depth as we scan, so a
 * `notes: parsed.data.notes ?? null` inside a parent literal counts
 * but `weekProfiles.find((w) => w.weekIndex === ...)` inside a value
 * does not.
 */
function topLevelKeys(literal: string): string[] {
  // A top-level key appears either at the start of the literal or
  // immediately after a `,` at brace-depth 0. We scan once, track
  // depth, and at each "key position" greedily read an identifier
  // followed by either `:` (long form) or `,`/`}` (shorthand) — also
  // at depth 0.
  const keys: string[] = [];
  const isIdentStart = (ch: string | undefined) =>
    !!ch && /[A-Za-z_$]/.test(ch);
  const isIdentCont = (ch: string | undefined) =>
    !!ch && /[A-Za-z0-9_$]/.test(ch);

  const tryReadKeyAt = (startIdx: number): number => {
    let i = startIdx;
    while (i < literal.length && /\s/.test(literal[i])) i++;
    if (!isIdentStart(literal[i])) return startIdx;
    let j = i + 1;
    while (j < literal.length && isIdentCont(literal[j])) j++;
    const ident = literal.slice(i, j);
    let k = j;
    while (k < literal.length && /\s/.test(literal[k])) k++;
    const next = literal[k];
    if (next === ":" || next === "," || next === "}") {
      keys.push(ident);
      return next === ":" ? k + 1 : k;
    }
    return startIdx;
  };

  let i = tryReadKeyAt(0);
  let depth = 0;
  while (i < literal.length) {
    const c = literal[i];
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      i++;
      continue;
    }
    if (c === "," && depth === 0) {
      i = tryReadKeyAt(i + 1);
      continue;
    }
    i++;
  }
  return keys;
}

describe("planner/actions.ts — Supabase column casing (regression for PGRST204)", () => {
  it("never uses Drizzle camelCase keys in inline insert/update literals", () => {
    const literals = [
      ...extractInlineObjectLiterals(SOURCE, "insert"),
      ...extractInlineObjectLiterals(SOURCE, "update"),
    ];
    expect(literals.length).toBeGreaterThan(0); // sanity: parser found something

    const offenders: { key: string; literal: string }[] = [];
    for (const lit of literals) {
      const keys = topLevelKeys(lit);
      for (const k of keys) {
        if ((FORBIDDEN_CAMEL_KEYS as readonly string[]).includes(k)) {
          offenders.push({ key: k, literal: lit.trim().slice(0, 200) });
        }
      }
    }

    expect(
      offenders,
      `Found camelCase keys in supabase insert/update literals in actions.ts. ` +
        `PostgREST expects snake_case DB column names. Offenders: ` +
        JSON.stringify(offenders, null, 2),
    ).toEqual([]);
  });

  it("every rows.push({…}) into planned_sessions uses snake_case columns", () => {
    // Both createBlock and createCustomBlock build a `rows` array then
    // call `.from("planned_sessions").insert(rows)`. The compiler can't
    // catch a drift back to camelCase (the row type lives in this file),
    // so we lint the literals directly.
    const re = /rows\.push\(\s*\{/g;
    const literals: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(SOURCE)) !== null) {
      const start = match.index + match[0].length - 1;
      let depth = 0;
      let i = start;
      for (; i < SOURCE.length; i++) {
        const c = SOURCE[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (depth === 0) literals.push(SOURCE.slice(start + 1, i));
    }

    // We expect at least 2 push-sites (createBlock + createCustomBlock).
    expect(literals.length).toBeGreaterThanOrEqual(2);

    // Required snake_case columns we know the table demands.
    const required = [
      "block_id",
      "user_id",
      "week_index",
      "day_index",
      "slot",
      "title",
      "role",
      "prescription",
    ];

    for (const lit of literals) {
      const keys = topLevelKeys(lit);
      for (const r of required) {
        expect(
          keys.includes(r),
          `rows.push literal is missing required column "${r}". Keys: ${JSON.stringify(keys)}`,
        ).toBe(true);
      }
      // And reject the legacy camelCase spellings explicitly.
      for (const bad of ["blockId", "userId", "weekIndex", "dayIndex"]) {
        expect(
          keys.includes(bad),
          `rows.push literal uses forbidden camelCase key "${bad}". Keys: ${JSON.stringify(keys)}`,
        ).toBe(false);
      }
    }
  });
});
