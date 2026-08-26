/**
 * The plan drawer's cardio block for a day the program reserves but does not
 * prescribe.
 *
 * This surface had no test, and it re-printed the placeholder prose the Today
 * hero suppressed — under a "Detail" label, via a one-line formatter that
 * reads `protocolNote` raw. With producers no longer writing that prose the
 * same formatter fell through to the literal "cardio", so a reserved day read
 * "Detail: cardio".
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

import { SessionDrawer } from "../PlanRedesign";

const noop = () => {};
const noopNotes = async () => ({ ok: true as const });

/** What `openCardioItem` writes today. */
const OPEN_DAY = {
  movementId: "",
  kind: "cardio_external",
  intensityLabel: "Conditioning",
} as unknown as PrescriptionItem;

/** What plans materialised before the boilerplate was removed still carry. */
const LEGACY_OPEN_DAY = {
  ...OPEN_DAY,
  protocolNote:
    "Open conditioning — log any run, row, ride or other cardio. Log it here, or link an activity you already recorded externally.",
} as unknown as PrescriptionItem;

const PRESCRIBED = {
  movementId: "mv-vo2",
  movementName: "VO2 intervals",
  kind: "cardio_vo2",
  durationMin: 35,
  protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
} as unknown as PrescriptionItem;

function drawer(items: PrescriptionItem[]) {
  return renderToStaticMarkup(
    <SessionDrawer
      session={{
        id: "00000000-0000-0000-0000-0000000000aa",
        weekIndex: 1,
        dayIndex: 2,
        date: "2026-08-16",
        title: "Conditioning",
        isCardio: true,
        isStrength: false,
        done: false,
        skipped: false,
        slot: "single",
        items,
        estDurationMin: 60,
        notes: null,
      }}
      today="2026-08-16"
      weeks={4}
      logHrefBase="/app/sessions/start"
      onClose={noop}
      moveAction={noop}
      skipAction={noop}
      unskipAction={noop}
      updateNotesAction={noopNotes}
      startSessionAction={noop}
    />,
  );
}

describe("SessionDrawer — a reserved conditioning day", () => {
  it("adds no detail line for a day with nothing to detail", () => {
    const html = drawer([OPEN_DAY]);
    expect(html).toContain('data-testid="plan-drawer-cardio-0"');
    expect(html).not.toContain("Detail");
    expect(html).not.toMatch(/>cardio</);
  });

  it("does not re-print the legacy placeholder under another label", () => {
    const html = drawer([LEGACY_OPEN_DAY]);
    expect(html).not.toMatch(/log any run, row, ride/i);
    expect(html).not.toMatch(/recorded externally/i);
    expect(html).not.toContain("Detail");
  });

  it("still shows a real protocol and duration", () => {
    const html = drawer([PRESCRIBED]);
    expect(html).toContain("Protocol");
    expect(html).toContain("4 × 4 min @ 90–95% HRmax, 3 min easy recovery");
    expect(html).toContain('data-testid="plan-drawer-cardio-duration"');
    expect(html).toContain("35 min");
  });
});
