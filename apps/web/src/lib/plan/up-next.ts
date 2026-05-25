/**
 * Up-next selection — picks today's planned session(s) and the next
 * few upcoming sessions for the /app/plan hero + right-rail surfaces.
 *
 * Pure: takes a planned-day list + a `today` YYYY-MM-DD and returns
 * a structured `UpNextSelection`. No I/O, no React, so it can be
 * unit-tested directly.
 *
 * The shape summary (warm-up / main / accessory / cardio counts) is
 * pre-computed here via `groupPrescriptionSections` so the hero card
 * can render a small visual shape strip without re-walking the
 * prescription items downstream.
 */
import type { Prescription } from "@hta/db";
import { summarisePrescription } from "@/lib/planner/archetypes";
import { groupPrescriptionSections } from "./prescription-grouping";

export type UpNextSlot = "single" | "am" | "pm";

export type UpNextSession = {
  id: string;
  date: string;
  slot: UpNextSlot;
  title: string;
  summary: string;
  warmupCount: number;
  mainCount: number;
  accessoryCount: number;
  cardioCount: number;
};

export type UpNextSelection = {
  /** 0..n sessions on today's date (sorted AM → single → PM). */
  today: UpNextSession[];
  /** Next ≤3 sessions strictly after today (not skipped, not completed). */
  upcoming: UpNextSession[];
  /** First future date with a session, or null when none. */
  nextDate: string | null;
};

type UpNextInputRow = {
  id: string;
  date: string;
  slot: UpNextSlot;
  title: string;
  prescription: Prescription;
  completedSessionId: string | null;
  skippedAt: string | null;
};

function slotOrder(s: UpNextSlot): number {
  if (s === "am") return 0;
  if (s === "single") return 1;
  return 2;
}

function toUp(p: UpNextInputRow): UpNextSession {
  const items = p.prescription?.items ?? [];
  const g = groupPrescriptionSections(items);
  return {
    id: p.id,
    date: p.date,
    slot: p.slot,
    title: p.title,
    summary: summarisePrescription(items),
    warmupCount: g.warmups.length,
    mainCount: g.main.length,
    accessoryCount:
      g.accessories.length + g.hingeCompensations.length + g.tendon.length,
    cardioCount: g.cardio.length,
  };
}

export function selectUpNext({
  all,
  today,
  upcomingLimit = 3,
}: {
  all: UpNextInputRow[];
  today: string;
  upcomingLimit?: number;
}): UpNextSelection {
  const todayList = all
    .filter((p) => p.date === today && !p.completedSessionId && !p.skippedAt)
    .sort((a, b) => slotOrder(a.slot) - slotOrder(b.slot))
    .map(toUp);

  const future = all
    .filter((p) => p.date > today && !p.completedSessionId && !p.skippedAt)
    .sort((a, b) =>
      a.date === b.date
        ? slotOrder(a.slot) - slotOrder(b.slot)
        : a.date < b.date
          ? -1
          : 1,
    );

  return {
    today: todayList,
    upcoming: future.slice(0, upcomingLimit).map(toUp),
    nextDate: future[0]?.date ?? null,
  };
}
