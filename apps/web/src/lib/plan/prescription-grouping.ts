/**
 * Section-grouping for the /app/plan day card.
 *
 * Splits a planned session's `prescription.items` into the visual
 * sections the card renders: warm-ups, main work, accessories, hinge
 * compensation, tendon, and cardio. Pure — no React, no I/O — so it
 * can be unit-tested independently and reused by other planned-session
 * surfaces (e.g. the /app today summary) without dragging UI in.
 *
 * Mirrors the bucket vocabulary used by
 * `lib/sessions/movement-grouping.ts` on the session-log side but
 * adds a few plan-only distinctions (hinge-compensation is broken
 * out of accessories; cardio gets its own bucket).
 */

import type { PrescriptionItem } from "@hta/db";

export type PrescriptionMovementRow = {
  /** movement_id used as the dedup key; falls back to slug-derived id. */
  rowKey: string;
  movementId: string | null;
  movementName: string;
  movementSlug: string | null;
  /** Items contributing to this row, in original prescription order. */
  items: PrescriptionItem[];
};

export type PrescriptionMainRow = {
  item: PrescriptionItem;
  /** Original index in the input array (1-indexed set number for display). */
  setNumber: number;
  /** True for the heaviest %TM main set in the section. */
  isTopSet: boolean;
};

export type PrescriptionSections = {
  warmups: PrescriptionItem[];
  main: PrescriptionMainRow[];
  accessories: PrescriptionMovementRow[];
  hingeCompensations: PrescriptionMovementRow[];
  tendon: PrescriptionMovementRow[];
  cardio: PrescriptionItem[];
};

const MAIN_KINDS: ReadonlySet<PrescriptionItem["kind"]> = new Set([
  "main",
  "back_off",
  "power_potentiation",
]);

function humaniseSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  const cleaned = slug.replaceAll("_", " ").trim();
  if (!cleaned) return null;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function displayName(item: PrescriptionItem): string {
  return (
    item.movementName ??
    humaniseSlug(item.movementSlug) ??
    "Movement"
  );
}

/**
 * Hinge-compensation accessories are flagged on `meta.hinge_compensation`
 * by the planner (see `lib/planner/actions.ts` — `buildHingeCompensationItem`).
 * No schema change needed — meta is the canonical channel for this hint.
 */
function isHingeCompensation(item: PrescriptionItem): boolean {
  const meta = item.meta as Record<string, unknown> | undefined;
  return Boolean(meta && meta.hinge_compensation === true);
}

function pushIntoRow(
  rows: PrescriptionMovementRow[],
  byKey: Map<string, PrescriptionMovementRow>,
  item: PrescriptionItem,
): void {
  const key = item.movementId ?? `slug:${item.movementSlug ?? displayName(item)}`;
  const existing = byKey.get(key);
  if (existing) {
    existing.items.push(item);
    return;
  }
  const row: PrescriptionMovementRow = {
    rowKey: key,
    movementId: item.movementId ?? null,
    movementName: displayName(item),
    movementSlug: item.movementSlug ?? null,
    items: [item],
  };
  byKey.set(key, row);
  rows.push(row);
}

export function groupPrescriptionSections(
  items: PrescriptionItem[],
): PrescriptionSections {
  const warmups: PrescriptionItem[] = [];
  const mainItems: PrescriptionItem[] = [];
  const accessories: PrescriptionMovementRow[] = [];
  const accessoriesByKey = new Map<string, PrescriptionMovementRow>();
  const hinge: PrescriptionMovementRow[] = [];
  const hingeByKey = new Map<string, PrescriptionMovementRow>();
  const tendon: PrescriptionMovementRow[] = [];
  const tendonByKey = new Map<string, PrescriptionMovementRow>();
  const cardio: PrescriptionItem[] = [];

  for (const item of items) {
    if (item.kind === "warmup") {
      warmups.push(item);
      continue;
    }
    if (MAIN_KINDS.has(item.kind)) {
      mainItems.push(item);
      continue;
    }
    if (item.kind === "tendon") {
      pushIntoRow(tendon, tendonByKey, item);
      continue;
    }
    if (item.kind === "accessory") {
      if (isHingeCompensation(item)) {
        pushIntoRow(hinge, hingeByKey, item);
      } else {
        pushIntoRow(accessories, accessoriesByKey, item);
      }
      continue;
    }
    if (item.kind.startsWith("cardio_")) {
      cardio.push(item);
      continue;
    }
    // Defensive fallthrough: treat unknown kinds as accessories so they
    // still render somewhere rather than getting silently dropped.
    pushIntoRow(accessories, accessoriesByKey, item);
  }

  // Top set = highest %TM among `main`-kind items. Back-off sets are
  // explicitly NOT eligible (they're volume work, not the headline).
  // Ties resolve to the first occurrence so the chip is stable.
  let topPct = -Infinity;
  for (const it of mainItems) {
    if (it.kind !== "main") continue;
    if (it.percentTm != null && it.percentTm > topPct) topPct = it.percentTm;
  }
  let topMarked = false;
  const main: PrescriptionMainRow[] = mainItems.map((item, i) => {
    const eligible = item.kind === "main";
    const isTopSet =
      eligible && !topMarked && item.percentTm != null && item.percentTm === topPct;
    if (isTopSet) topMarked = true;
    return { item, setNumber: i + 1, isTopSet };
  });

  return { warmups, main, accessories, hingeCompensations: hinge, tendon, cardio };
}

/**
 * Render a compact "+10 kg vest" / "−10 kg band" / "vest" badge for a
 * movement row when the planner attached a `bw.loadSource` (and
 * optionally a suggested `bw.externalLoadKg`) to its prescription
 * items.
 *
 * Returns null when no row item carries load metadata so callers can
 * conditionally render the chip without extra branches.
 *
 * Mirrors the suffix vocabulary used by MovementFocusView so the
 * planned card and the session log read consistently.
 */
export function describeRowExternalLoad(
  row: PrescriptionMovementRow,
): string | null {
  for (const it of row.items) {
    const bw = (it as PrescriptionItem & {
      bw?: { externalLoadKg?: number; loadSource?: string };
    }).bw;
    if (!bw || !bw.loadSource) continue;
    const label = loadSourceLabel(bw.loadSource);
    const kg = bw.externalLoadKg;
    if (kg == null || kg === 0) return label;
    if (kg < 0) return `−${Math.abs(kg)} kg ${label}`;
    return `+${kg} kg ${label}`;
  }
  return null;
}

function loadSourceLabel(source: string): string {
  switch (source) {
    case "weighted_vest":
      return "vest";
    case "dip_belt":
      return "belt";
    case "ankle_weights":
      return "ankle";
    case "band_assist":
      return "band";
    default:
      return source;
  }
}
