/**
 * ArchetypePicker — bodyweight-only mode.
 *
 * Verifies the two BW-specific behaviours added in
 * `fix/bw-wizard-copy-and-min-days`:
 *   1. The per-card "needs N+ d/wk" pill uses the BW floor (2) instead of
 *      the archetype's anchor-day count when `isBodyweightOnly` is set.
 *   2. The selected-archetype hint text swaps to BW-aware copy when the
 *      chosen day-count is below the floor.
 *
 * Static-markup rendering only — same approach as
 * `wizard-bw-routing.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchetypePicker, type ArchetypeOption } from "../ArchetypePicker";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

const STRENGTH_OPT: ArchetypeOption = {
  id: "strength_anchor",
  name: "Strength Focus",
  oneLiner: "Heavy main lifts, four-week wave.",
  weeks: 4,
  minDays: 4,
  maxDays: 6,
  twoADay: false,
  hasTwoADayVariant: false,
  weekLabels: ["Ramp", "Build", "Push", "Recover"],
  tmReady: true,
  missingRoles: [],
  chosenLifts: [],
};

function render(props: Partial<Parameters<typeof ArchetypePicker>[0]>): string {
  return renderToStaticMarkup(
    <ArchetypePicker
      options={[STRENGTH_OPT]}
      defaultStartedOn="2026-01-05"
      defaultDaysPerWeek={3}
      dayPreviewByArchetype={{ strength_anchor: { 3: { strength: 3, cardio: 0 } } }}
      amWindowStart="07:00"
      pmWindowStart="17:00"
      action={async () => ({ ok: true })}
      {...props}
    />,
  );
}

describe("ArchetypePicker — isBodyweightOnly", () => {
  it("non-BW: 3 d/wk + Strength Anchor shows 'needs 4+ d/wk' pill", () => {
    const html = render({ isBodyweightOnly: false });
    expect(html).toMatch(/needs 4\+ d\/wk/);
    expect(html).toMatch(/needs at least 4 training days\/week/);
  });

  it("BW: 3 d/wk + Strength Anchor fits (no 'needs N+' pill)", () => {
    // 3 days ≥ BW floor of 2, so the card should fit and render the
    // preview pill (`4 wk · 3S + 0C`) instead of the danger pill.
    const html = render({ isBodyweightOnly: true });
    expect(html).not.toMatch(/needs \d+\+ d\/wk/);
    expect(html).toMatch(/4 wk · 3S \+ 0C/);
  });

  it("BW: 1 d/wk surfaces BW-aware hint copy (not the per-archetype name)", () => {
    const html = render({ isBodyweightOnly: true, defaultDaysPerWeek: 1 });
    expect(html).toMatch(
      /Bodyweight blocks run at any frequency — the engine rotates families per session\./,
    );
    expect(html).not.toMatch(/Strength Focus<\/strong> needs at least/);
  });
});
