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
import type { Prescription, PrescriptionItem } from "@hta/db";
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

type SwapAction = typeof swapPrescriptionItem;

export type CardioListItem = {
  /** Index inside the parent `prescription.items` array (NOT the filtered list). */
  itemIndex: number;
  item: PrescriptionItem;
};

export function CardioPrescriptionList({
  plannedSessionId,
  items,
  ownedCardio,
  swapAction,
  isReadOnly,
}: {
  plannedSessionId: string | null;
  items: CardioListItem[];
  ownedCardio: readonly CardioMachineType[];
  swapAction: SwapAction;
  /** Hides the Swap button when the parent session has been completed. */
  isReadOnly?: boolean;
}) {
  const [overrides, setOverrides] = useState<Record<number, PrescriptionItem>>(
    {},
  );

  if (items.length === 0) return null;

  const onSwap = (itemIndex: number, next: PrescriptionItem) => {
    setOverrides((prev) => ({ ...prev, [itemIndex]: next }));
  };

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
      {items.map(({ item, itemIndex }) => {
        const live = overrides[itemIndex] ?? item;
        return (
          <CardioPrescriptionRow
            key={`cardio-rx-${itemIndex}`}
            plannedSessionId={plannedSessionId}
            itemIndex={itemIndex}
            item={live}
            ownedCardio={ownedCardio}
            swapAction={swapAction}
            isReadOnly={isReadOnly ?? false}
            onSwap={(next) => onSwap(itemIndex, next)}
          />
        );
      })}
    </ul>
  );
}

function CardioPrescriptionRow({
  plannedSessionId,
  itemIndex,
  item,
  ownedCardio,
  swapAction,
  isReadOnly,
  onSwap,
}: {
  plannedSessionId: string | null;
  itemIndex: number;
  item: PrescriptionItem;
  ownedCardio: readonly CardioMachineType[];
  swapAction: SwapAction;
  isReadOnly: boolean;
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

  return (
    <li
      data-testid={`cardio-prescription-item-${itemIndex}`}
      data-swapped={swapped ? "true" : "false"}
      style={{
        padding: "10px 12px",
        border: `1px solid ${error ? "var(--cp-danger)" : "var(--cp-border)"}`,
        borderRadius: 8,
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
        fontSize: 13,
        display: "grid",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "baseline",
        }}
      >
        <span style={{ fontWeight: 600 }}>
          {item.movementName ?? item.movementSlug ?? item.intensityLabel ?? "Cardio"}
        </span>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
          {item.intensityLabel && (
            <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              {item.intensityLabel}
            </span>
          )}
          {canSwap && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              data-testid={`cardio-prescription-swap-button-${itemIndex}`}
              aria-expanded={open}
              style={{
                fontSize: 11,
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text-muted)",
                cursor: "pointer",
                minHeight: 28,
              }}
            >
              {open ? "× cancel" : "Swap"}
            </button>
          )}
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
        {item.durationMin != null ? `${item.durationMin} min` : null}
        {item.hrCap ? ` · ${item.hrCap}` : ""}
        {item.protocolNote ? ` · ${item.protocolNote}` : ""}
      </div>
      {swapped && origName && (
        <div
          data-testid={`cardio-prescription-swapped-from-${itemIndex}`}
          style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
        >
          previously: {origName}
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
