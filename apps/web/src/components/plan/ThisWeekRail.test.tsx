import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanSessionInput } from "./PlanRedesign";
import { buildWeekRailRows, RailList } from "./ThisWeekRail";

function session(
  id: string,
  overrides: Partial<PlanSessionInput>,
): PlanSessionInput {
  return {
    id,
    weekIndex: 1,
    dayIndex: 0,
    date: "2026-08-10",
    title: id,
    isCardio: false,
    isStrength: true,
    isRehab: false,
    done: false,
    inProgress: false,
    skipped: false,
    slot: "single",
    items: [],
    estDurationMin: 30,
    notes: null,
    completedSessionId: null,
    ...overrides,
  };
}

describe("ThisWeekRail", () => {
  it("keeps every same-day session in deterministic slot order", () => {
    const rehab = session("rehab", {
      title: "Rehab",
      isStrength: false,
      isRehab: true,
      slot: "pm",
    });
    const strength = session("strength", {
      title: "Armor B1 · 80%",
    });

    const rows = buildWeekRailRows([rehab, strength], 1);
    expect(rows).toHaveLength(8);
    expect(
      rows
        .filter((row) => row.dayIndex === 0)
        .map((row) => row.session?.title),
    ).toEqual(["Armor B1 · 80%", "Rehab"]);
  });

  it("labels a rehab row as rehab instead of strength", () => {
    const rows = buildWeekRailRows(
      [
        session("rehab", {
          title: "Rehab",
          isStrength: false,
          isRehab: true,
          slot: "pm",
        }),
      ],
      1,
    );
    const html = renderToStaticMarkup(
      <RailList
        rail={rows}
        today="2026-08-10"
        onOpen={() => undefined}
      />,
    );

    expect(html).toContain(">Rehab</span>");
    expect(html).not.toContain(">Strength</span>");
  });
});
