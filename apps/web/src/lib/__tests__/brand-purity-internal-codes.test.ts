/**
 * Brand-purity guard for internal DC-* / OC-* codes.
 *
 * Per project conventions (DC-Q6): internal design-constraint codes
 * may appear in code comments, test names, PR descriptions, and
 * `cite:` / `data-cite=` attributes — but NEVER in user-visible
 * strings (JSX text, tooltip popovers, error copy, banner labels).
 *
 * This test reads a curated set of files known to render user copy
 * and asserts that no `DC-*` token appears outside of a comment,
 * import statement, or `cite` / `data-cite` attribute. The list is
 * deliberately narrow so it catches regressions on the surfaces we
 * just cleaned (plan page, engine internals, planner wizard
 * tooltips, engine derivations) without being a moving target.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC_ROOT = resolve(__dirname, "..", "..");

const USER_FACING_FILES = [
  "app/app/plan/page.tsx",
  "app/app/stats/engine/page.tsx",
  "lib/stats/engine.ts",
  "lib/stats/tissue-stack-queries.ts",
];

const DC_TOKEN = /\bDC-[A-Z]?\d+/g;

function stripLineComments(line: string): string {
  // Drop // line comments. Crude but sufficient — we don't have any
  // // tokens embedded inside string literals on these files.
  const idx = line.indexOf("//");
  return idx === -1 ? line : line.slice(0, idx);
}

function isInsideBlockComment(file: string, charIndex: number): boolean {
  // Walk back from charIndex; if the most recent of /* and */ is /*,
  // we're inside a block comment.
  const before = file.slice(0, charIndex);
  const lastOpen = before.lastIndexOf("/*");
  const lastClose = before.lastIndexOf("*/");
  return lastOpen > lastClose;
}

function isInsideAllowedAttribute(file: string, charIndex: number): boolean {
  // Allow `cite: "DC-..."`, `cite="DC-..."`, `data-cite="DC-..."`,
  // `data-cite={... "DC-..."}` etc. Look back at most 64 chars for
  // one of those keys followed by `=`, `:`, or `({`.
  const window = file.slice(Math.max(0, charIndex - 80), charIndex);
  return /\b(?:data-cite|cite)\s*[:=]\s*[{"'`]?[^"'`}]*$/.test(window);
}

describe("brand purity — internal DC-* codes never leak into user copy", () => {
  for (const rel of USER_FACING_FILES) {
    it(`${rel} has no user-visible DC-* tokens`, () => {
      const path = resolve(SRC_ROOT, rel);
      const src = readFileSync(path, "utf8");

      const leaks: { token: string; line: number; context: string }[] = [];
      DC_TOKEN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = DC_TOKEN.exec(src)) != null) {
        const idx = m.index;
        if (isInsideBlockComment(src, idx)) continue;

        // Per-line check: skip if the token sits inside a // comment.
        const lineStart = src.lastIndexOf("\n", idx) + 1;
        const lineEnd = src.indexOf("\n", idx);
        const line = src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        const tokenColInLine = idx - lineStart;
        const stripped = stripLineComments(line);
        if (tokenColInLine >= stripped.length) continue;

        if (isInsideAllowedAttribute(src, idx)) continue;

        const lineNumber = src.slice(0, idx).split("\n").length;
        leaks.push({ token: m[0], line: lineNumber, context: line.trim() });
      }

      if (leaks.length > 0) {
        const detail = leaks
          .map((l) => `  L${l.line}: ${l.token}  ←  ${l.context}`)
          .join("\n");
        throw new Error(
          `User-visible DC-* token(s) found in ${rel}:\n${detail}`,
        );
      }
      expect(leaks).toEqual([]);
    });
  }
});
