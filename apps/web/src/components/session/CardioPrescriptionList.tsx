"use client";

/**
 * Cardio prescription list with per-row movement swap (feat/cardio-swap).
 *
 * The session-detail page renders each cardio prescription item as a
 * card; this component layers a "Swap" affordance on each card. The
 * picker filters candidates by the original item's `cardioKind` (so a
 * Z2 item only swaps for other Z2 movements — never VO2) and by the
 * user's owned cardio equipment.
 *
 * Reuses `swapPrescriptionItem` (server action) — it operates on a
 * prescription item by index, modality-agnostic, so cardio works
 * without changes to the data layer. The optimistic-update + audit
 * trail (`meta.swappedFrom` + `engine_override_events` row) come along
 * for free.
 */

import { useEffect, useState, useTransition } from "react";
import type { PrescriptionItem } from "@hta/db";
import {
  isSwapped,
  originalMovementName,
} from "@/lib/sessions/prescription-mutations";
import {
  classifyCardioKind,
  filterCardioCandidates,
  MODALITY_LABEL,
  type CardioCandidate,
  type CardioKind,
  type FilteredCardioGroup,
} from "@/lib/sessions/cardio-swap";
import type { CardioMachineType } from "@/lib/settings/equipment-schema";
import type { swapPrescriptionItem } from "@/lib/sessions/actions";
import { CardioCard } from "./CardioCard";
import { CardioPlanView } from "./CardioPlanView";
import { makeShouldHideHeading } from "@/lib/session/heading-dedup";

type SwapAction = typeof swapPrescriptionItem;

/**
 * Phase 2 — classification of an external cardio session inferred
 * from Strava HR + duration data. Optional: when present and the
 * matching cardio_external card is rendered, replaces the "Logged via
 * Runna" placeholder with the inferred kind + reason.
 */
export type CardioClassification = {
  /** Display label, e.g. "VO2 intervals". */
  label: string;
  /** One-line reason, e.g. "avg 168 bpm (Z4), max 178 bpm — likely VO2 work". */
  reason: string;
  /** 0..1 — UI dims the badge below 0.7. */
  confidence: number;
  /** ESL value rendered in the "Effective load: N" footer. */
  effectiveStressLoad?: number | null;
};

export type CardioListItem = {
  /** Index inside the parent `prescription.items` array (NOT the filtered list). */
  itemIndex: number;
  item: PrescriptionItem;
  /** Phase 2 — Strava classifier output for `cardio_external` rows. */
  classification?: CardioClassification | null;
  /**
   * Display label for the implementing modality (e.g. "Run", "Bike",
   * "Row"). Surfaced as a pill in the cardio card header so the user
   * can see at a glance what the planned movement is — and reach for
   * Swap when they want to do the same protocol on a different machine.
   * Derived server-side from the planned movement's `metadata.modality`.
   */
  modalityLabel?: string | null;
};

export function CardioPrescriptionList({
  plannedSessionId,
  items,
  ownedCardio,
  swapAction,
  isReadOnly,
  markExternalCompleteAction,
  pageTitle,
}: {
  plannedSessionId: string | null;
  items: CardioListItem[];
  ownedCardio: readonly CardioMachineType[];
  swapAction: SwapAction;
  /** Hides the Swap button when the parent session has been completed. */
  isReadOnly?: boolean;
  /**
   * Phase 1 "external cardio". Server action invoked when the user
   * presses "Mark complete" on a `cardio_external` placeholder card.
   * Optional — if omitted, the button still renders but is disabled so
   * the parent (e.g. session-detail page) can wire it incrementally.
   */
  markExternalCompleteAction?: (fd: FormData) => Promise<{ ok?: true; error?: string }>;
  /**
   * Page title (e.g. `sessions.title`). When a row's heading
   * (movementName) would just repeat this title, the structured cardio
   * card hides its own heading via the shared `heading-dedup` helper.
   */
  pageTitle?: string | null;
}) {
  const [overrides, setOverrides] = useState<Record<number, PrescriptionItem>>(
    {},
  );

  if (items.length === 0) return null;

  const onSwap = (itemIndex: number, next: PrescriptionItem) => {
    setOverrides((prev) => ({ ...prev, [itemIndex]: next }));
  };

  const shouldHideHeading = makeShouldHideHeading(pageTitle);

  return (
    <ul
      data-testid="cardio-prescription-items"
      style={{
        listStyle: "none",
        padding: 0,
        margin: "10px 0 0",
        display: "grid",
        gap: 8,
      }}
    >
      {items.map(({ item, itemIndex, classification, modalityLabel }) => {
        const live = overrides[itemIndex] ?? item;
        if (live.kind === "cardio_external") {
          return (
            <ExternalCardioRow
              key={`cardio-rx-${itemIndex}`}
              itemIndex={itemIndex}
              item={live}
              plannedSessionId={plannedSessionId}
              isReadOnly={isReadOnly ?? false}
              markCompleteAction={markExternalCompleteAction}
              classification={classification ?? null}
            />
          );
        }
        return (
          <CardioPrescriptionRow
            key={`cardio-rx-${itemIndex}`}
            plannedSessionId={plannedSessionId}
            itemIndex={itemIndex}
            item={live}
            modalityLabel={modalityLabel ?? null}
            ownedCardio={ownedCardio}
            swapAction={swapAction}
            isReadOnly={isReadOnly ?? false}
            hideHeading={shouldHideHeading(
              live.movementName ?? live.movementSlug ?? "Cardio",
            )}
            onSwap={(next) => onSwap(itemIndex, next)}
          />
        );
      })}
    </ul>
  );
}

/**
 * Phase 1 "external cardio" row. Muted card with no intensity chip /
 * no Swap button — the user logs the actual run via their external
 * program (Runna / Garmin Coach / Hal Higdon / etc.). The single CTA
 * fires `markExternalCompleteAction` which inserts a placeholder
 * `cardio_logs` row so the session can be marked done.
 */
function ExternalCardioRow({
  itemIndex,
  item,
  plannedSessionId,
  isReadOnly,
  markCompleteAction,
  classification,
}: {
  itemIndex: number;
  item: PrescriptionItem;
  plannedSessionId: string | null;
  isReadOnly: boolean;
  markCompleteAction?: (fd: FormData) => Promise<{ ok?: true; error?: string }>;
  classification: CardioClassification | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const programName = (item.intensityLabel ?? "").trim();
  const title = programName.length > 0 && programName !== "External program"
    ? programName
    : "External cardio";
  // Body line: Phase 2 — when the Strava classifier returned a kind,
  // surface that instead of the placeholder. Otherwise prefer the
  // engine's own prescription note (`notes` — what the user is meant to
  // do this session), then the protocol hint, then the generic fallback.
  const hasClassification = classification != null;
  const isLowConfidence =
    hasClassification && classification.confidence < 0.7;
  const richNote = (item.notes ?? "").trim();
  const protoNote = (item.protocolNote ?? "").trim();
  const body = hasClassification
    ? null
    : richNote.length > 0
      ? `${richNote} Mark complete when done.`
      : protoNote.length > 0
        ? `${protoNote} Mark complete when done.`
        : `Logged via ${programName.length > 0 && programName !== "External program" ? programName : "your external program"}. Mark complete when done.`;

  const onClick = () => {
    if (!markCompleteAction || !plannedSessionId) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("itemIndex", String(itemIndex));
      if (programName) fd.set("programName", programName);
      const res = await markCompleteAction(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setDone(true);
    });
  };

  const canMark = !isReadOnly && !done && !!markCompleteAction && !!plannedSessionId;

  return (
    <li
      data-testid={`cardio-prescription-item-${itemIndex}`}
      data-external="true"
      data-classified={hasClassification ? "true" : "false"}
      style={{
        padding: "12px 14px",
        border: `1px dashed ${error ? "var(--cp-danger)" : "var(--cp-border)"}`,
        borderRadius: 8,
        background: "var(--cp-surface-soft)",
        fontSize: 13,
        display: "grid",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontWeight: 600 }}>
          {title}
          {hasClassification && (
            <>
              {" · "}
              <span style={{ fontWeight: 400, color: "var(--cp-text-muted)" }}>
                Detected as
              </span>{" "}
              <span
                data-testid={`cardio-external-classified-${itemIndex}`}
                style={{
                  fontWeight: 600,
                  opacity: isLowConfidence ? 0.75 : 1,
                }}
              >
                {classification.label}
              </span>
              {isLowConfidence && (
                <span
                  data-testid={`cardio-external-low-confidence-${itemIndex}`}
                  title="We weren't sure about this one — heart-rate data may have been incomplete."
                  aria-label="Uncertain classification"
                  style={{
                    marginLeft: 4,
                    fontSize: 11,
                    color: "var(--cp-text-muted)",
                    cursor: "help",
                  }}
                >
                  (?)
                </span>
              )}
            </>
          )}
        </span>
      </div>
      {hasClassification ? (
        <>
          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
            {classification.reason}
          </div>
          {classification.effectiveStressLoad != null && (
            <div
              data-testid={`cardio-external-esl-${itemIndex}`}
              style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
            >
              Effective load: {Math.round(classification.effectiveStressLoad)}
              {classification.effectiveStressLoad >= 60 ? " (high)" : classification.effectiveStressLoad >= 30 ? " (moderate)" : " (low)"}
            </div>
          )}
        </>
      ) : item.cardioPlan ? (
        <CardioPlanView plan={item.cardioPlan} durationMin={item.durationMin ?? null} />
      ) : (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
          {body}
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
      {!isReadOnly && (
        <div>
          <button
            type="button"
            onClick={onClick}
            disabled={!canMark || pending}
            data-testid={`cardio-external-mark-complete-${itemIndex}`}
            style={{
              fontSize: 12,
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--cp-accent)",
              background: done ? "var(--cp-surface)" : "var(--cp-accent)",
              color: done ? "var(--cp-text-muted)" : "var(--cp-accent-fg)",
              cursor: canMark && !pending ? "pointer" : "not-allowed",
              opacity: !canMark || pending ? 0.7 : 1,
              fontWeight: 600,
              minHeight: 32,
            }}
          >
            {done ? "Marked complete" : pending ? "Saving…" : "Mark complete"}
          </button>
        </div>
      )}
    </li>
  );
}

function CardioPrescriptionRow({
  plannedSessionId,
  itemIndex,
  item,
  modalityLabel,
  ownedCardio,
  swapAction,
  isReadOnly,
  hideHeading,
  onSwap,
}: {
  plannedSessionId: string | null;
  itemIndex: number;
  item: PrescriptionItem;
  modalityLabel: string | null;
  ownedCardio: readonly CardioMachineType[];
  swapAction: SwapAction;
  isReadOnly: boolean;
  hideHeading: boolean;
  onSwap: (next: PrescriptionItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const targetKind = item.kind as CardioKind;
  const swapped = isSwapped(item);
  const origName = originalMovementName(item);
  const canSwap = !isReadOnly && plannedSessionId != null;

  const pick = (cand: CardioCandidate) => {
    setError(null);
    setOpen(false);
    const prevMeta = (item.meta ?? {}) as Record<string, unknown>;
    const prevSwappedFrom = prevMeta.swappedFrom as
      | { movementId: string; movementName: string }
      | undefined;
    const optimistic: PrescriptionItem = {
      ...item,
      movementId: cand.id,
      movementSlug: cand.slug,
      movementName: cand.display_name,
      meta: {
        ...prevMeta,
        swappedFrom: prevSwappedFrom ?? {
          movementId: item.movementId,
          movementName: item.movementName ?? item.movementSlug ?? "previous",
        },
        swappedAt: new Date().toISOString(),
      },
    };
    onSwap(optimistic);

    if (!plannedSessionId) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("itemIndex", String(itemIndex));
      fd.set("newMovementId", cand.id);
      const res = await swapAction(fd);
      if (res?.error) {
        setError(res.error);
        onSwap(item); // rollback
      } else if (res?.prescription) {
        const persisted = res.prescription.items?.[itemIndex];
        if (persisted) onSwap(persisted);
      }
    });
  };

  const swapButton = canSwap ? (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      data-testid={`cardio-prescription-swap-button-${itemIndex}`}
      aria-expanded={open}
      style={{
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: 999,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
        color: "var(--cp-text-muted)",
        cursor: "pointer",
        minHeight: 32,
        fontWeight: 500,
      }}
    >
      {open ? "× cancel" : "Swap"}
    </button>
  ) : null;

  return (
    <li
      data-testid={`cardio-prescription-item-${itemIndex}`}
      data-swapped={swapped ? "true" : "false"}
      style={{
        listStyle: "none",
        padding: 0,
        margin: 0,
        display: "grid",
        gap: 8,
      }}
    >
      <CardioCard
        item={item}
        hideHeading={hideHeading}
        modalityLabel={modalityLabel}
        headerActions={swapButton}
        testId={`cardio-prescription-card-${itemIndex}`}
        rowTestIdPrefix={`cardio-prescription-card-${itemIndex}`}
      />
      {swapped && origName && (
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
          }}
        >
          <span
            data-testid={`cardio-prescription-swapped-from-${itemIndex}`}
          >
            previously: {origName}
          </span>
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
      {open && (
        <CardioSwapPicker
          originalId={item.movementId}
          targetKind={targetKind}
          ownedCardio={ownedCardio}
          onPick={pick}
        />
      )}
    </li>
  );
}

function CardioSwapPicker({
  originalId,
  targetKind,
  ownedCardio,
  onPick,
}: {
  originalId: string;
  targetKind: CardioKind;
  ownedCardio: readonly CardioMachineType[];
  onPick: (c: CardioCandidate) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<FilteredCardioGroup[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(
      `/api/movements/swap-candidates?originalId=${encodeURIComponent(originalId)}&limit=50`,
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as { movements: CardioCandidate[] };
      })
      .then((body) => {
        if (cancelled) return;
        // Defensive: when classifying by metadata the API may not be
        // updated. We still classify whatever we got back.
        const filtered = filterCardioCandidates(body.movements, {
          targetKind,
          ownedCardio,
          excludeMovementId: originalId,
        });
        setGroups(filtered);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [originalId, targetKind, ownedCardio]);

  return (
    <div
      data-testid="cardio-swap-candidates"
      style={{
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 8,
        padding: 8,
        display: "grid",
        gap: 6,
        maxHeight: 280,
        overflowY: "auto",
      }}
    >
      {loading && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Loading…</div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
      {!loading && !error && groups.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          No compatible alternatives for this intensity given your equipment.
        </div>
      )}
      {!loading &&
        !error &&
        groups.map((group) => (
          <div
            key={group.modality}
            data-testid={`cardio-swap-group-${group.modality}`}
            style={{ display: "grid", gap: 4 }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--cp-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              {MODALITY_LABEL[group.modality]}
            </div>
            {group.movements.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => onPick(c)}
                data-testid={`cardio-swap-candidate-${c.slug}`}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--cp-border)",
                  background: "var(--cp-surface-soft)",
                  color: "var(--cp-text)",
                  cursor: "pointer",
                  fontSize: 13,
                  minHeight: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontWeight: 500 }}>{c.display_name}</span>
                {c.equipment && (
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
                  >
                    {c.equipment}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

// Keep classifyCardioKind reachable for downstream typing tests.
export { classifyCardioKind };
