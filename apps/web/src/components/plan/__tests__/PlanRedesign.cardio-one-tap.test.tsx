/**
 * Drawer one-tap cardio completion.
 *
 * The Today "This week" drawer used to render "Mark done" as a plain <Link> to
 * the session screen, where the lifter had to press an IDENTICAL "Mark done" a
 * second time to finish a pure prescribed cardio slot. `markExternalCardioComplete`
 * already materialises the session, writes the cardio log and completes it from a
 * planned-session id alone, so the drawer can finish the session in place.
 *
 * The one-tap button is gated on `prescriptionItemsHaveStrength` — the SAME
 * predicate the server action uses for `isPureCardio` (plan §6.9) — so the drawer
 * can never offer a one-tap finish the server would refuse. Hybrid and
 * strength slots keep the navigation link, because they still need sets logged.
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
const noopCardioDone = async () => ({ ok: true as const, sessionCompleted: true });

const CARDIO_ITEM = {
  movementId: "mv-lss",
  kind: "cardio_external",
  sets: 1,
  reps: 1,
  notes: "60 min easy, conversational long steady state.",
} as unknown as PrescriptionItem;

const MAIN_ITEM = {
  movementId: "mv-squat",
  movementName: "Back Squat",
  kind: "main",
  sets: 3,
  reps: 5,
  percentTm: 85,
} as unknown as PrescriptionItem;

function drawer(
  items: PrescriptionItem[],
  opts: { withAction?: boolean; done?: boolean } = {},
) {
  const { withAction = true, done = false } = opts;
  return renderToStaticMarkup(
    <SessionDrawer
      session={{
        id: "00000000-0000-0000-0000-0000000000aa",
        weekIndex: 1,
        dayIndex: 2,
        date: "2026-08-16",
        title: "Armor · LSS 2",
        isCardio: items.some((it) => String(it.kind).startsWith("cardio_")),
        isStrength: items.some((it) => it.kind === "main"),
        done,
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
      {...(withAction ? { markCardioDoneAction: noopCardioDone } : {})}
    />,
  );
}

describe("SessionDrawer — one-tap cardio completion", () => {
  it("renders Mark done as an in-place button for a pure cardio slot", () => {
    const html = drawer([CARDIO_ITEM]);
    expect(html).toContain('data-testid="plan-drawer-mark-done"');
    expect(html).toContain('data-one-tap="true"');
    // The regression: it must NOT be a navigation link to the session screen.
    expect(html).not.toContain('href="/app/sessions/start/');
  });

  it("keeps the navigation link for a hybrid session that still needs sets", () => {
    const html = drawer([CARDIO_ITEM, MAIN_ITEM]);
    expect(html).toContain('data-testid="plan-drawer-mark-done"');
    expect(html).toContain('href="/app/sessions/start/');
    expect(html).not.toContain('data-one-tap="true"');
  });

  it("keeps the navigation link for a strength-only session", () => {
    const html = drawer([MAIN_ITEM]);
    expect(html).toContain('href="/app/sessions/start/');
    expect(html).not.toContain('data-one-tap="true"');
  });

  it("falls back to the link when no one-tap action is supplied", () => {
    const html = drawer([CARDIO_ITEM], { withAction: false });
    expect(html).toContain('href="/app/sessions/start/');
    expect(html).not.toContain('data-one-tap="true"');
  });

  it("shows no Mark done at all once the session is complete", () => {
    const html = drawer([CARDIO_ITEM], { done: true });
    expect(html).not.toContain('data-testid="plan-drawer-mark-done"');
  });
});
