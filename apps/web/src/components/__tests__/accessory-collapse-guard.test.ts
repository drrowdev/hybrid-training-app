/**
 * Drift guard — accessory set-collapse.
 *
 * The planner expands an accessory's sets into multiple one-set items
 * (`{ sets: 1, reps: 14 }` ×2). Any UI that renders a movement row's `items`
 * by formatting each one MUST collapse them first (`collapseIdenticalSetItems`)
 * or the row reads "1 × 14 · 1 × 14" instead of "2 × 14". This bug shipped twice
 * (drawer fixed in #370; the Today hero + Preview were missed until later).
 *
 * This test forces the invariant structurally: every component that calls
 * `formatPrescriptionItem` must also reference `collapseIdenticalSetItems`, so a
 * NEW surface that lists prescription rows can't silently reintroduce the
 * uncollapsed render. If you add a component that legitimately only ever formats
 * a SINGLE item (never a multi-set row), add it to `ALLOWLIST` with a reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const COMPONENTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Components that format prescription items but never render a multi-set row. */
const ALLOWLIST = new Set<string>([
  // (none today — both known surfaces collapse)
]);

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...walkTsx(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("accessory set-collapse drift guard", () => {
  it("every component that formats prescription items also collapses set-expanded ones", () => {
    const offenders: string[] = [];
    for (const file of walkTsx(COMPONENTS_ROOT)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("formatPrescriptionItem")) continue;
      const rel = path.relative(COMPONENTS_ROOT, file).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      if (!src.includes("collapseIdenticalSetItems")) offenders.push(rel);
    }
    expect(
      offenders,
      `These components format prescription rows without collapsing set-expanded ` +
        `items, so a 2×14 accessory will render as "1 × 14 · 1 × 14". Wrap the ` +
        `row's items in collapseIdenticalSetItems() before formatting (see ` +
        `SessionPreviewBody / PlanRedesign), or allowlist if it only formats a ` +
        `single item:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
