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

/**
 * One movement's worth of prescription rows. Strength sessions can
 * legitimately carry multiple movements per session (e.g. the
 * bodyweight planner emits one main + back-off per family, so a single
 * session contains push + pull + squat). The plan card groups MAIN
 * work by movement so each movement gets its own warm-up ramp and
 * sets list under a labelled subsection.
 *
 * Accessories, hinge compensation, tendon, and cardio do NOT split into
 * per-movement subsections — pooling them at the session level keeps
 * the card scannable when an accessory pool has 5 distinct movements.
 */
export type MovementPrescriptionSection = {
  rowKey: string;
  movementId: string | null;
  movementName: string;
  movementSlug: string | null;
  warmups: PrescriptionItem[];
  /** Combined main + back-off + power_potentiation rows in source order. */
  sets: PlanSetRow[];
};

export type PlanSetRow = {
  item: PrescriptionItem;
  /** 1-indexed display position within the movement's set list. */
  setNumber: number;
  /** True for the heaviest %TM main set. */
  isTopSet: boolean;
  /** True for back-off rows so the renderer can tag them inline. */
  isBackOff: boolean;
};

export type PlanCardSections = {
  movements: MovementPrescriptionSection[];
  accessories: PrescriptionMovementRow[];
  hingeCompensations: PrescriptionMovementRow[];
  tendon: PrescriptionMovementRow[];
  cardio: PrescriptionItem[];
};

/** Legacy alias — kept so existing imports compile. */
export type MovementGroupedSections = PlanCardSections;

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
 * Group prescription items for the plan-card layout.
 *
 * Strength / skill movements (kinds: main, back_off, warmup,
 * power_potentiation) group by `movement_id` into their own subsections.
 * Within a movement, warm-ups separate (they collapse to a tiny pill),
 * and main + back-off + power_potentiation merge into ONE flat numbered
 * "Sets" list with back-off rows tagged inline. This avoids the
 * "MAIN WORK / BACK-OFF" double-header pattern that doubled section
 * chrome when a movement had as few as one back-off set.
 *
 * Accessories, hinge-compensation, tendon, and cardio pool at the
 * session level — they're rendered as a single grouped section each at
 * the bottom of the card, NOT exploded into per-movement subsections.
 * The latter blew up the card vertically when 5 accessories each got
 * their own header.
 *
 * Movements appear in the order they first occur in the input array,
 * which preserves the planner's intentional ordering.
 *
 * Empty / contentless items (no reps, no holdSec, no percentTm, no
 * durationMin, no notes, no intensityLabel, no bw payload) are dropped.
 */
export function groupByMovementThenKind(
  items: PrescriptionItem[],
): PlanCardSections {
  const movements: MovementPrescriptionSection[] = [];
  const byKey = new Map<string, MovementPrescriptionSection>();
  const accessories: PrescriptionMovementRow[] = [];
  const accessoriesByKey = new Map<string, PrescriptionMovementRow>();
  const hinge: PrescriptionMovementRow[] = [];
  const hingeByKey = new Map<string, PrescriptionMovementRow>();
  const tendon: PrescriptionMovementRow[] = [];
  const tendonByKey = new Map<string, PrescriptionMovementRow>();
  const cardio: PrescriptionItem[] = [];

  function sectionFor(item: PrescriptionItem): MovementPrescriptionSection {
    const key =
      item.movementId ??
      `slug:${item.movementSlug ?? displayName(item)}`;
    const existing = byKey.get(key);
    if (existing) return existing;
    const section: MovementPrescriptionSection = {
      rowKey: key,
      movementId: item.movementId ?? null,
      movementName: displayName(item),
      movementSlug: item.movementSlug ?? null,
      warmups: [],
      sets: [],
    };
    byKey.set(key, section);
    movements.push(section);
    return section;
  }

  for (const item of items) {
    if (item.kind.startsWith("cardio_")) {
      cardio.push(item);
      continue;
    }
    if (isContentlessItem(item)) continue;
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
    if (item.kind === "warmup") {
      sectionFor(item).warmups.push(item);
      continue;
    }
    if (MAIN_KINDS.has(item.kind)) {
      const section = sectionFor(item);
      section.sets.push({
        item,
        setNumber: section.sets.length + 1,
        isTopSet: false,
        isBackOff: item.kind === "back_off",
      });
      continue;
    }
    // Defensive: unknown kinds fall through as accessories so they
    // still surface rather than being silently dropped.
    pushIntoRow(accessories, accessoriesByKey, item);
  }

  // Mark top set within each movement — the heaviest %TM among kind ===
  // "main" rows wins; back-off / power_potentiation rows are excluded.
  for (const section of movements) {
    let topPct = -Infinity;
    for (const row of section.sets) {
      if (row.item.kind !== "main") continue;
      if (row.item.percentTm != null && row.item.percentTm > topPct) {
        topPct = row.item.percentTm;
      }
    }
    let marked = false;
    for (const row of section.sets) {
      if (
        !marked &&
        row.item.kind === "main" &&
        row.item.percentTm != null &&
        row.item.percentTm === topPct
      ) {
        row.isTopSet = true;
        marked = true;
      }
    }
  }

  return { movements, accessories, hingeCompensations: hinge, tendon, cardio };
}

/**
 * True when a prescription item carries no renderable content — no
 * reps, no hold, no percentTm, no duration, no intensity label, no
 * notes. Used to filter the rare malformed items that some generator
 * paths can produce (e.g. an isometric back-off that lost its
 * holdSeconds during a refactor). Rendering them produces blank rows
 * that confuse the user; dropping them is the conservative move.
 */
function isContentlessItem(item: PrescriptionItem): boolean {
  if (item.reps != null) return false;
  if (item.percentTm != null) return false;
  if (item.durationMin != null) return false;
  if (item.holdSec != null) return false;
  if (item.distanceM != null) return false;
  if (item.intensityLabel) return false;
  if (item.intensityCue) return false;
  if (item.notes) return false;
  const bw = item.bw as { reps?: number; holdSeconds?: number; repRange?: unknown } | undefined;
  if (bw && (bw.reps != null || bw.holdSeconds != null || bw.repRange)) return false;
  return true;
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

/**
 * Collapse a run of structurally-identical prescription items into a single
 * item whose `sets` is the summed set count.
 *
 * The planner sometimes expands an accessory's prescribed sets into multiple
 * one-set items (e.g. a 2×14 box jump becomes two `{ sets: 1, reps: 14 }`
 * entries). Rendered naively that reads "1 × 14 · 1 × 14" — confusing. This
 * merges adjacent items that match on every field *except* `sets`, summing the
 * set counts so the same prescription renders as a clean "2 × 14".
 *
 * Items that genuinely differ (different reps, intensity, distance, hold, …)
 * are kept separate, preserving the original order.
 */
export function collapseIdenticalSetItems(
  items: PrescriptionItem[],
): PrescriptionItem[] {
  const out: PrescriptionItem[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && sameExceptSets(prev, item)) {
      out[out.length - 1] = {
        ...prev,
        sets: (prev.sets ?? 1) + (item.sets ?? 1),
      };
    } else {
      out.push(item);
    }
  }
  return out;
}

function sameExceptSets(a: PrescriptionItem, b: PrescriptionItem): boolean {
  const stripSets = (it: PrescriptionItem) => {
    const { sets: _sets, ...rest } = it as PrescriptionItem & { sets?: number };
    void _sets;
    return JSON.stringify(rest);
  };
  return stripSets(a) === stripSets(b);
}
