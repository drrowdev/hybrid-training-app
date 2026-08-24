/**
 * Mobile-layout guards for `/app/settings/training-maxes`.
 *
 * The page laid its sections out in an `auto` grid track. An auto track takes
 * its floor from the widest child's min-content width, and a lift row (role
 * label + variant `<select>` + Estimate + numeric input) is wider than a phone
 * viewport — so the track, and with it every sibling, stretched past the
 * screen: the intro copy ran off-screen and the 1RM inputs sat beyond the right
 * edge. Measured in Chromium at 390px before the fix: 68px of document
 * overflow (98px at 360px).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { TmRow } from "@/lib/training-maxes/queries";
import { TmSection, type RoleGroupInput } from "../TmSection";
import { TmAutoForm } from "../TmAutoForm";

const noop = async () => ({ ok: true as const });

const setRow: TmRow = {
  id: "row-1",
  movementId: "ohp",
  movementName: "Standing Overhead Press",
  movementSlug: "ohp-standing",
  oneRmKg: 60,
  tmPercentOverride: null,
  effectivePercent: 90,
  tmKg: 54,
  updatedAt: "2026-08-16T00:00:00.000Z",
  systemLoad: false,
  source: "entered",
  derivedFromSessionId: null,
  derivedFromSetLogId: null,
  derivedFormula: null,
  derivedAt: null,
};

const requiredGroups: RoleGroupInput[] = [
  {
    role: "vertical_press",
    label: "Vertical press (overhead)",
    candidates: [
      { id: "ohp", slug: "ohp-standing", display_name: "Standing Overhead Press" },
      {
        id: "seated-ohp",
        slug: "ohp-seated",
        display_name: "Seated Barbell Overhead Press",
      },
    ],
    setRow,
  },
];

const read = (relative: string) =>
  readFileSync(path.join(process.cwd(), relative), "utf8");

describe("1-rep maxes — mobile layout", () => {
  it("caps the section grid track so a lift row can't stretch the page", () => {
    const html = renderToStaticMarkup(
      <TmSection
        units="metric"
        requiredGroups={requiredGroups}
        otherRows={[]}
        pickerGroups={[]}
        hasActiveBlock={false}
        upsertAction={noop}
        moveAction={noop}
        deleteAction={async () => {}}
        lockAction={noop}
      />,
    );
    expect(html).toContain("grid-template-columns:minmax(0, 1fr)");
  });

  it("caps the page grid track too", () => {
    expect(read("src/app/app/settings/training-maxes/page.tsx")).toContain(
      'gridTemplateColumns: "minmax(0, 1fr)"',
    );
  });

  it("wraps the lift row on phone widths so the inputs stay on screen", () => {
    const css = read("src/components/training-maxes/TmSection.module.css");
    const mobileBlock = css.match(/@media \(max-width: 480px\) \{[\s\S]*?\r?\n\}/)?.[0];
    expect(mobileBlock).toBeTruthy();
    expect(mobileBlock).toMatch(/\.lift\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(mobileBlock).toMatch(/\.linfo\s*\{[^}]*flex:\s*1 1 100%/);
    // A <select> is intrinsically as wide as its widest option.
    expect(css).toMatch(/\.variantSel\s*\{[\s\S]*?min-width:\s*0/);
  });

  it("keeps the catalog picker inside its column", () => {
    const html = renderToStaticMarkup(
      <TmAutoForm
        mode="new"
        units="metric"
        candidateGroups={[
          {
            label: "Squat",
            items: [
              {
                id: "bss",
                display_name: "Barbell Bulgarian Split Squat (Rear Foot Elevated)",
              },
            ],
          },
        ]}
        action={noop}
      />,
    );
    expect(html).toMatch(/<select[^>]+style="[^"]*min-width:0[^"]*"/);
    expect(html).toMatch(/<select[^>]+style="[^"]*max-width:100%[^"]*"/);
  });
});
