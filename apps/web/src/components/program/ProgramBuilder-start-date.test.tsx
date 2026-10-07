import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuthoredProgramDefinitionV2 } from "@hta/domain";
import { ProgramBuilder } from "./ProgramBuilder";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/programs/authored/actions", () => ({
  previewAuthoredProgram: vi.fn(), saveAuthoredProgram: vi.fn(), reloadAuthoredProgram: vi.fn(),
}));

const initial: AuthoredProgramDefinitionV2 = {
  version: 2, activity: "strength", name: "Saved program",
  weeks: [{ type: "Build", sets: "3", reps: "5", pct: 75 }], workouts: [],
};
function dateInput(props: Partial<Parameters<typeof ProgramBuilder>[0]> = {}) {
  const html = renderToStaticMarkup(<ProgramBuilder catalog={[]} today="2026-10-07" commitments={[]} {...props} />);
  const input = html.match(/<input[^>]*type="date"[^>]*>/)?.[0];
  expect(input).toBeDefined();
  return input!;
}
describe("DC-R5 saved program start-date control", () => {
  it("keeps the native creation field editable with today's minimum", () => {
    const input = dateInput();
    expect(input).not.toContain("disabled");
    expect(input).toContain('min="2026-10-07"');
  });
  it.each([undefined, false, true])("requires explicit saved-program eligibility (%s)", (canChangeStartDate) => {
    const input = dateInput({ initial, editBlockId: "program", initialStartDate: "2026-10-05", canChangeStartDate });
    expect(input.includes("disabled")).toBe(canChangeStartDate !== true);
    expect(input).toContain('value="2026-10-05"');
    expect(input).not.toContain("min=");
  });
  it("keeps the date fixed in the single-workout editor even for an unused program", () => {
    expect(dateInput({ initial, editBlockId: "program", initialStartDate: "2026-10-12",
      workoutId: "workout", canChangeStartDate: true })).toContain("disabled");
  });
});
