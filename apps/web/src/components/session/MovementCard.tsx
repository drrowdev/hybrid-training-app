"use client";

/**
 * One collapsible card per prescribed movement in the session. Owns
 * the header chip, the collapsed/expanded toggle, the auto-collapse-
 * to-recap latch, and the embedded `<MovementFocusView>` body.
 *
 * The auto-collapse latch (`autoCollapsedRef`) ensures that once a
 * user re-expands the card after it auto-collapsed, the card stays
 * open for the rest of the session — preventing the re-collapse loop
 * called out in the reference doc.
 *
 * The "Same as planned" button moved here from the session-level
 * banner so prefilling is per-movement: tap to populate every set in
 * this group with its TM-derived target.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Prescription } from "@hta/db";
import {
  deriveCardState,
  isMovementComplete,
  type MovementGroup,
} from "@/lib/sessions/movement-grouping";
import { summariseGroupForHeader } from "@/lib/sessions/movement-summary";
import { buildMovementRecap } from "@/lib/sessions/movement-recap";
import { cleanPrescriptionNotes } from "@/lib/planner/clean-prescription-notes";
import { MovementFocusView, type FocusLoggedSet } from "./MovementFocusView";
import { SwapMovementModal } from "./SwapMovementModal";
import { MovementHowToButton } from "./MovementHowToButton";
import { DisclosureArrow } from "./DisclosureArrow";
import { MetricHelp } from "@/components/ui/MetricHelp";
import type { PlateInventoryItem } from "./plate-math";
import type { LastSetHint } from "./SessionLogClient";
import { formatHintDate } from "@/lib/sessions/format-hint-date";
import { hapticTick } from "@/lib/feedback";
import { useUnits } from "@/lib/units/context";
import { type WeightUnit, formatWeight } from "@/lib/stats/units";
import type { fillSessionFromPlan } from "@/lib/sessions/actions";

export type MovementCardProps = {
  sessionId: string;
  group: MovementGroup;
  /**
   * Session-complete read-only mode. When true the card defaults
   * collapsed (condensed-by-default review), suppresses every edit
   * affordance (swap, fill-from-plan, set logging), and renders a
   * read-only per-set breakdown when expanded instead of the
   * interactive focus view. Collapse state is ephemeral (not persisted)
   * so a reviewed session always opens condensed.
   */
  readOnly?: boolean;
  tmKg: number | undefined;
  /** Saved 1RM from training_maxes.one_rm_kg. Drives TM-anchored PR flash. */
  oneRmKg: number | undefined;
  loggedItemIndices: ReadonlySet<number>;
  skippedItemIndices?: ReadonlySet<number>;
  loggedSetIdByItemIndex: Readonly<Record<number, string>>;
  loggedSets: FocusLoggedSet[];
  priorBest: { heaviestWeight: number | null; bestE1rm: number | null } | undefined;
  /**
   * Prior-session top set for this movement ("last time: X kg × Y").
   * Set by the parent for accessory cards only; mains leave it
   * undefined since they show a TM-derived prescribed weight instead.
   * When present it renders a muted hint row in the expanded body.
   */
  lastSetHint?: LastSetHint;
  addStrengthSet: (fd: FormData) => Promise<{ error?: string; ok?: true }>;
  fillFromPlan?: typeof fillSessionFromPlan | null;
  /** Parent-controlled: only the first card in a fresh session shows the session-level fill button. */
  showFillFromPlan: boolean;
  hapticsEnabled: boolean;
  timerSoundEnabled: boolean;
  /** User equipment — forwarded to `<MovementFocusView>` for the plate breakdown. */
  barbellKg?: number;
  trapBarKg?: number;
  plateInventory?: PlateInventoryItem[];
  preferStandardLbPlates?: boolean;
  /** Persistence key prefix — combined with movementId for localStorage. */
  persistKeyPrefix: string;
  /**
   * True when the movement is bodyweight-capable (`body_weight_loaded`):
   * pull-ups, dips, inverted rows, etc. Forwarded to the focus view so the
   * set can be logged at 0 kg added load instead of demanding a weight.
   */
  bodyweightCapable?: boolean;
  /**
   * Optional reorder grip rendered inside the card header (accessory cards only).
   * Kept INSIDE the card so the card itself stays full-width and aligned with the
   * non-reorderable main-lift cards — an external grip column made accessory cards
   * narrower and visually misaligned.
   */
  dragHandle?: React.ReactNode;
  /** Phase 4 BW gate state — passed through verbatim to the focus view. */
  bwGateStateByFamily?: Readonly<
    Record<
      string,
      {
        weeksAtNode: number;
        weeksRequired: number;
        tutAccumulated: number;
        tutRequired: number;
        recentOverCompleted: boolean;
      }
    >
  >;
};

// Delay before a movement card auto-collapses to its recap once the final set is
// logged. Long enough to register the last entry (and any PR flash) but short so
// the card gets out of the way quickly — the user asked for a snappier close.
const RECAP_DELAY_MS = 700;

export function MovementCard({
  sessionId,
  group: groupProp,
  readOnly = false,
  tmKg,
  oneRmKg,
  loggedItemIndices,
  skippedItemIndices,
  loggedSetIdByItemIndex,
  loggedSets,
  priorBest,
  lastSetHint,
  addStrengthSet,
  fillFromPlan,
  showFillFromPlan,
  hapticsEnabled,
  timerSoundEnabled,
  barbellKg,
  trapBarKg,
  plateInventory,
  preferStandardLbPlates,
  persistKeyPrefix,
  bwGateStateByFamily,
  bodyweightCapable,
  dragHandle,
}: MovementCardProps) {
  const units = useUnits();
  const router = useRouter();
  // A mid-session swap repaints this card to the chosen movement: the header
  // shows its name and future sets log against its id. Sets already logged stay
  // attributed to the original in the DB (the swap is forward-only). The swap is
  // persisted server-side, so we also refresh to pick up the new movement's
  // server-derived state (notably whether a weight is required).
  const [swappedMovement, setSwappedMovement] = useState<
    { id: string; slug: string; displayName: string } | null
  >(null);
  const group = useMemo<MovementGroup>(
    () =>
      swappedMovement
        ? {
            ...groupProp,
            movementId: swappedMovement.id,
            movementName: swappedMovement.displayName,
            movementSlug: swappedMovement.slug,
          }
        : groupProp,
    [groupProp, swappedMovement],
  );
  const cardState = deriveCardState(group, loggedItemIndices);
  const complete = isMovementComplete(group, loggedItemIndices);

  // Persistence key stays anchored to the ORIGINAL movement so collapse state
  // survives a swap (and isn't orphaned under a new key).
  const storageKey = `${persistKeyPrefix}:${groupProp.movementId}`;

  // Compute the initial collapsed value. Server render uses card state
  // defaults; client mount syncs with localStorage so the user's
  // explicit toggles win across page reloads. In read-only (completed
  // session) mode every card starts collapsed regardless of per-movement
  // state — the user is reviewing, not logging.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (readOnly) return true;
    if (cardState === "completed") return true;
    if (cardState === "not_started") return true;
    return false;
  });
  const userOverrodeRef = useRef(false);
  const autoCollapsedRef = useRef(false);
  const [swapOpen, setSwapOpen] = useState(false);
  // Hydrate from localStorage on mount. Skipped in read-only mode so a
  // completed session always opens condensed, ignoring whatever toggle
  // state was persisted while the workout was being logged.
  useEffect(() => {
    if (readOnly) return;
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      /* eslint-disable react-hooks/set-state-in-effect -- hydrate from storage on mount */
      if (raw === "open") {
        userOverrodeRef.current = true;
        setCollapsed(false);
      } else if (raw === "closed") {
        userOverrodeRef.current = true;
        setCollapsed(true);
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    } catch {
      /* ignore */
    }
  }, [storageKey, readOnly]);

  // Auto-collapse to recap once every set is logged. Latches via
  // autoCollapsedRef so re-expanding AFTER the auto-collapse doesn't snap the
  // card shut again. We deliberately do NOT gate on `userOverrodeRef` here:
  // accessory cards start collapsed, so the user must tap to expand them in
  // order to log — that manual expand should not prevent the card from
  // collapsing once its final set is in. The `autoCollapsedRef` latch alone
  // guarantees a single auto-collapse (a later re-expand sticks). No-op in
  // read-only mode (the card is already collapsed).
  useEffect(() => {
    if (readOnly) return;
    if (!complete) return;
    if (autoCollapsedRef.current) return;
    const id = window.setTimeout(() => {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    }, RECAP_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [complete, readOnly]);

  // Latch the cursor where "Edit sets" tapped on the recap — the
  // focus view picks this up via its `initialCursor` prop. Reset
  // back to null on the next save so the auto cursor takes over.
  const [pinnedCursor, setPinnedCursor] = useState<number | null>(null);

  const toggleCollapsed = () => {
    userOverrodeRef.current = true;
    hapticTick(hapticsEnabled, 8);
    setCollapsed((v) => {
      const next = !v;
      // Read-only review toggles are ephemeral — don't persist, so the
      // session reopens condensed next visit.
      if (!readOnly) {
        try {
          window.localStorage.setItem(storageKey, next ? "closed" : "open");
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  /**
   * Re-expand the card AND pin the focus view to the slot that was
   * last logged. Used by the recap-row "Edit sets" button so the
   * user lands on the most-recent set rather than the auto cursor's
   * "next open slot" pick (which would land outside the prescribed
   * range when every slot is covered).
   */
  const expandAtLastLogged = () => {
    const slots = group.itemIndices;
    let lastSlot = 0;
    for (let i = 0; i < slots.length; i++) {
      if (loggedItemIndices.has(slots[i]!)) lastSlot = i;
    }
    setPinnedCursor(lastSlot);
    userOverrodeRef.current = true;
    setCollapsed(false);
    try {
      window.localStorage.setItem(storageKey, "open");
    } catch {
      /* ignore */
    }
  };

  const total = group.itemIndices.length;
  const done = group.itemIndices.filter((i) => loggedItemIndices.has(i)).length;

  const chipColor =
    cardState === "completed"
      ? "var(--cp-success)"
      : cardState === "in_progress"
        ? "var(--cp-accent)"
        : "var(--cp-text-muted)";
  const chipLabel =
    cardState === "completed"
      ? `${done}/${total} ✓`
      : cardState === "in_progress"
        ? `${done}/${total}`
        : "·";

  // Kind-bucketed recap lines for the collapsed view. The legacy one-
  // liner summaryLine is dropped in favour of one row per bucket
  // (warm-ups / working / volume / accessory / tendon) plus a final
  // `N skipped (reason)` row when any skips were recorded.
  const recapLines = buildMovementRecap(group.items, loggedSets);

  // One-line summary for the collapsed header chip. Hidden on narrow
  // viewports via the `cp-mc-summary` class (see globals.css).
  const headerSummary = useMemo(
    () =>
      summariseGroupForHeader(
        group,
        loggedSets,
        tmKg,
        oneRmKg != null && tmKg != null && Math.abs(tmKg - oneRmKg) < 0.001 ? "1RM" : "TM",
      ),
    [group, loggedSets, tmKg, oneRmKg],
  );

  // Per-movement "why" for accessory cards — the engine's own deterministic
  // selection reason, threaded onto the item as `notes`. Mains carry no notes
  // (they show a TM-derived target instead), so this only lights up for
  // accessories/durability/power picks. Surfaced as a ✦ "why" spark.
  //
  // Run through `cleanPrescriptionNotes` so leaked engine-bucket jargon
  // (e.g. "Weekly tissue floor: hsr") is stripped to null rather than
  // shown raw — only genuine human-readable reasons surface. Hidden
  // entirely on a completed session (readOnly): the per-movement "why"
  // is logging-time guidance, not review material.
  const accessoryWhy = useMemo(() => {
    if (readOnly) return undefined;
    const first = group.items[0];
    if (!first || first.kind === "main") return undefined;
    const note = cleanPrescriptionNotes(first.notes);
    if (!note) return undefined;
    const trimmed = note.trim();
    if (trimmed.length === 0) return undefined;
    // Some generators stash the set's rep TARGET in `notes` (e.g. "10–15" or
    // "12") rather than a rationale. That's already implied by the row's set ×
    // reps — surfacing it under a "Why this movement" heading reads as empty.
    // Only treat genuine prose (a multi-word explanation) as a "why".
    if (/^\d+\s*[\u2013-]\s*\d+$/.test(trimmed) || /^\d+$/.test(trimmed)) {
      return undefined;
    }
    if (!/\s/.test(trimmed)) return undefined;
    return trimmed;
  }, [group.items, readOnly]);

  return (
    <section
      data-testid={`movement-card-${group.movementId}`}
      data-state={cardState}
      data-collapsed={collapsed ? "true" : "false"}
      className="cp-card"
      style={{
        padding: 0,
        display: "grid",
        borderColor:
          cardState === "completed"
            ? "color-mix(in oklab, var(--cp-success) 40%, var(--cp-border))"
            : cardState === "in_progress"
              ? "color-mix(in oklab, var(--cp-accent) 40%, var(--cp-border))"
              : "var(--cp-border)",
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={toggleCollapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCollapsed();
          }
        }}
        data-testid={`movement-card-header-${group.movementId}`}
        aria-expanded={!collapsed}
        style={{
          all: "unset",
          cursor: "pointer",
          padding: "12px 14px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {group.movementName}
          </span>
          <MovementHowToButton
            movementId={group.movementId}
            displayName={group.movementName}
          />
          {/Hsr|HSR|\(hsr\)/i.test(group.movementName) && (
            <MetricHelp term="hsr" variant="info" placement="bottom" />
          )}
          {accessoryWhy && (
            <MetricHelp
              title="Why this movement"
              body={accessoryWhy}
              variant="why"
              placement="bottom"
            />
          )}
        </span>
        {tmKg != null && (
          <span style={{ display: "inline-flex", alignItems: "center" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 6,
                background: "var(--cp-surface-soft)",
                color: "var(--cp-text-muted)",
                border: "1px solid var(--cp-border)",
              }}
            >
              {oneRmKg != null && Math.abs(tmKg - oneRmKg) < 0.001 ? "1RM" : "TM"} {formatWeight(tmKg, units)}
            </span>
          </span>
        )}
        {collapsed && headerSummary && (
          <span
            data-testid={`movement-card-summary-${group.movementId}`}
            className="cp-mc-summary"
            style={{
              fontSize: 12,
              color: "var(--cp-text-muted)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "60%",
            }}
          >
            {headerSummary}
          </span>
        )}
        {total > 0 ? (
          <span
            data-testid={`movement-card-chip-${group.movementId}`}
            aria-label={
              cardState === "completed"
                ? "All sets logged"
                : `${done} of ${total} sets logged`
            }
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              flex: "0 0 auto",
              display: "grid",
              placeItems: "center",
              background: `conic-gradient(${chipColor} ${(done / total) * 360}deg, color-mix(in oklab, ${chipColor} 16%, transparent) 0)`,
            }}
          >
            <span
              style={{
                width: 25,
                height: 25,
                borderRadius: "50%",
                background: "var(--cp-surface)",
                display: "grid",
                placeItems: "center",
                fontSize: cardState === "completed" ? 13 : 10,
                fontWeight: 700,
                color: chipColor,
                letterSpacing: "-0.02em",
              }}
            >
              {cardState === "completed" ? "✓" : `${done}/${total}`}
            </span>
          </span>
        ) : (
          <span
            data-testid={`movement-card-chip-${group.movementId}`}
            style={{ fontSize: 11, color: chipColor, fontWeight: 700 }}
          >
            {chipLabel}
          </span>
        )}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            color: "var(--cp-text-muted)",
          }}
        >
          <DisclosureArrow open={!collapsed} />
        </span>
        {dragHandle}
      </div>

      {collapsed && cardState === "completed" && recapLines.length > 0 && (
        <div
          data-testid={`movement-card-recap-${group.movementId}`}
          style={{
            padding: "0 14px 14px",
            display: "grid",
            gap: 6,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 12,
              color: "var(--cp-text-muted)",
            }}
          >
            <span style={{ color: "var(--cp-success)", fontWeight: 700 }}>✓</span>
            <span style={{ flex: "1 1 auto", fontWeight: 600, color: "var(--cp-text)" }}>
              {group.movementName} complete
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={expandAtLastLogged}
                className="cp-btn"
                style={{ padding: "4px 10px", fontSize: 11 }}
                data-testid={`movement-card-edit-${group.movementId}`}
              >
                Edit sets
              </button>
            )}
          </div>
          {/* Per-set/bucket recap list. Only shown when REVIEWING a finished
              session (readOnly) — during an ACTIVE workout a just-completed
              movement collapses to the compact "✓ complete + Edit sets" row
              above (plus the one-line header summary), so the card stays short
              on mobile instead of listing every set again. */}
          {readOnly && (
            <ul
              data-testid={`movement-card-recap-lines-${group.movementId}`}
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "grid",
                gap: 2,
                fontSize: 12,
                color: "var(--cp-text-muted)",
              }}
            >
              {recapLines.map((line) => (
                <li
                  key={line.kind}
                  data-recap-kind={line.kind}
                  style={{
                    color:
                      line.kind === "skipped"
                        ? "var(--cp-warning)"
                        : "var(--cp-text-muted)",
                  }}
                >
                  {line.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!collapsed && readOnly && (
        <div className="cp-reveal" style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
          <ReadOnlySetList group={group} loggedSets={loggedSets} sessionId={sessionId} />
        </div>
      )}

      {!collapsed && !readOnly && (
        <div className="cp-reveal" style={{ padding: "0 14px 14px", display: "grid", gap: 12 }}>
          <LastSetHintRow hint={lastSetHint} label={group.movementName} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {fillFromPlan && showFillFromPlan && cardState !== "completed" && (
              <FillFromPlanButton
                fillFromPlan={fillFromPlan}
                sessionId={sessionId}
              />
            )}
            <button
              type="button"
              onClick={() => setSwapOpen(true)}
              data-testid={`movement-card-swap-${group.movementId}`}
              className="cp-btn"
              style={{ padding: "6px 10px", fontSize: 11 }}
            >
              Swap movement
            </button>
          </div>
          <MovementFocusView
            sessionId={sessionId}
            group={group}
            tmKg={tmKg}
            oneRmKg={oneRmKg}
            loggedItemIndices={loggedItemIndices}
            skippedItemIndices={skippedItemIndices}
            loggedSetIdByItemIndex={loggedSetIdByItemIndex}
            loggedSets={loggedSets}
            priorBest={priorBest}
            addStrengthSet={addStrengthSet}
            hapticsEnabled={hapticsEnabled}
            timerSoundEnabled={timerSoundEnabled}
            barbellKg={barbellKg}
            trapBarKg={trapBarKg}
            plateInventory={plateInventory}
            preferStandardLbPlates={preferStandardLbPlates}
            initialCursor={pinnedCursor}
            onSaved={() => setPinnedCursor(null)}
            bwGateStateByFamily={bwGateStateByFamily}
            bodyweightCapable={bodyweightCapable}
          />
        </div>
      )}

      {!readOnly && (
        <SwapMovementModal
          open={swapOpen}
          onClose={() => setSwapOpen(false)}
          sessionId={sessionId}
          original={{ id: group.movementId, displayName: group.movementName }}
          onSwapped={(next) => {
            setSwappedMovement(next);
            setSwapOpen(false);
            // The swap is persisted on the server (prescription updated); refresh
            // so the card picks up the new movement's server-derived state — most
            // importantly whether a weight is required (a bodyweight movement like
            // a GHD sit-up must be loggable at 0 kg).
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

/**
 * Read-only per-set breakdown shown when a *completed* session's
 * movement card is expanded for a deeper dive. Lists each logged set
 * (weight × reps, or distance / duration for carries / time work) plus
 * its RPE, and flags skipped slots. No inputs, no actions — the session
 * is locked once finished.
 *
 * Exported so the presentational contract can be pinned in isolation.
 */
export function ReadOnlySetList({
  group,
  loggedSets,
  sessionId,
}: {
  group: MovementGroup;
  loggedSets: FocusLoggedSet[];
  /** When set, each logged row gets an Edit link to the set-edit page. */
  sessionId?: string;
}) {
  const units = useUnits();
  if (loggedSets.length === 0) {
    return (
      <div
        data-testid={`movement-card-readonly-empty-${group.movementId}`}
        style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
      >
        No sets were logged for this movement.
      </div>
    );
  }
  return (
    <ul
      data-testid={`movement-card-readonly-sets-${group.movementId}`}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}
    >
      {loggedSets.map((s, i) => (
        <li
          key={s.id}
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 12,
            alignItems: "baseline",
            padding: "8px 0",
            borderBottom:
              i === loggedSets.length - 1 ? "none" : "1px solid var(--cp-border)",
            opacity: s.skipped ? 0.6 : 1,
          }}
        >
          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            Set {i + 1}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 14,
              color: "var(--cp-text)",
              textDecoration: s.skipped ? "line-through" : "none",
            }}
          >
            {s.skipped ? `Skipped${s.skipReason ? ` (${s.skipReason})` : ""}` : formatReadOnlySet(s, units)}
          </span>
          <span style={{ display: "inline-flex", gap: 12, alignItems: "baseline", justifySelf: "end" }}>
            {!s.skipped && s.rpe != null && (
              <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                RPE {s.rpe}
              </span>
            )}
            {sessionId && !s.skipped && (
              <Link
                href={`/app/sessions/${sessionId}/sets/${s.id}/edit`}
                data-testid={`readonly-set-edit-${s.id}`}
                className="mono"
                style={{ fontSize: 12, color: "var(--cp-accent)", textDecoration: "none" }}
              >
                Edit
              </Link>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One-line value for a logged set: weight × reps, a loaded carry's
 * distance, or a timed effort's duration. */
function formatReadOnlySet(s: FocusLoggedSet, units: WeightUnit): string {
  if (s.distanceM != null && s.distanceM > 0) {
    const load = s.weightKg != null && s.weightKg > 0 ? ` @ ${formatWeight(s.weightKg, units)}` : "";
    return `${s.distanceM} m${load}`;
  }
  if ((s.reps == null || s.reps <= 0) && s.durationSec != null && s.durationSec > 0) {
    const mins = Math.floor(s.durationSec / 60);
    const secs = s.durationSec % 60;
    const t = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return s.weightKg != null && s.weightKg > 0 ? `${t} @ ${formatWeight(s.weightKg, units)}` : t;
  }
  const w = s.weightKg != null && s.weightKg > 0 ? formatWeight(s.weightKg, units) : "BW";
  const reps = s.reps ?? 0;
  return `${w} × ${reps}`;
}

/**
 * Muted "Last <movement>: X kg × Y (date)" row shown in the expanded
 * body of accessory cards. For accessories — which carry no TM-derived
 * prescribed weight — the prior-session top set is the lifter's primary
 * weight-selection signal. Renders nothing when no hint is available.
 *
 * Exported as a pure presentational unit so the render contract can be
 * tested in isolation without standing up the heavy focus view.
 */
export function LastSetHintRow({
  hint,
  label,
}: {
  hint?: LastSetHint | null;
  label: string;
}) {
  const units = useUnits();
  if (!hint) return null;
  return (
    <div
      data-testid="last-time-hint"
      style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
    >
      Last {label.toLowerCase()}:{" "}
      <span style={{ color: "var(--cp-text)", fontWeight: 500 }} className="mono">
        {formatWeight(hint.weightKg, units)} × {hint.reps}
      </span>
      <span style={{ marginLeft: 6, color: "var(--cp-text-muted)" }}>
        ({formatHintDate(hint.performedAt)})
      </span>
    </div>
  );
}

function FillFromPlanButton({
  fillFromPlan,
  sessionId,
}: {
  fillFromPlan: typeof fillSessionFromPlan;
  sessionId: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setPending(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      const result = await fillFromPlan(fd);
      if (result?.error) setError(result.error);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className="cp-btn primary"
        disabled={pending}
        data-testid="movement-card-fill-from-plan"
        style={{ padding: "6px 10px", fontSize: 11 }}
      >
        {pending ? "Filling…" : "Same as planned"}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
    </>
  );
}

// Re-export so callers don't need to know the underlying shape file.
export type { Prescription };
