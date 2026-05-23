"use client";

/**
 * Prescription items list with mid-workout swap affordance (Phase 2 A1 + A3).
 *
 * Rendered on the session detail page when the session is in progress
 * AND linked to a planned_session. Each strength prescription item gets
 * a "Swap exercise" button that opens an inline dropdown of
 * pattern-compatible alternatives fetched from
 * ``/api/movements/swap-candidates``.
 *
 * Optimistic update: as soon as the user picks a replacement we paint
 * the new name immediately and call the server action in the background.
 * Failures roll back and surface an error (red ring around the item).
 *
 * A swapped item shows a "Swapped" badge whose ``title`` attribute
 * reveals the original movement on hover/tap.
 */

import { useState, useEffect, useTransition } from "react";
import type { Prescription, PrescriptionItem } from "@hta/db";
import { isSwapped, originalMovementName } from "@/lib/sessions/prescription-mutations";
import type { swapPrescriptionItem } from "@/lib/sessions/actions";

type SwapAction = typeof swapPrescriptionItem;

type Candidate = {
  id: string;
  slug: string;
  display_name: string;
  pattern: string;
  equipment: string | null;
};

const STRENGTH_KINDS = new Set([
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
  "power_potentiation",
]);

export function PrescriptionItemsList({
  plannedSessionId,
  initialPrescription,
  swapAction,
}: {
  plannedSessionId: string;
  initialPrescription: Prescription;
  swapAction: SwapAction;
}) {
  const [prescription, setPrescription] = useState(initialPrescription);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [errorByIndex, setErrorByIndex] = useState<Record<number, string>>({});
  const [, startTransition] = useTransition();

  if (!prescription.items || prescription.items.length === 0) return null;

  const onPick = async (index: number, cand: Candidate) => {
    const prev = prescription;
    // Optimistic patch.
    const optimistic: Prescription = {
      items: prev.items.map((it, i) =>
        i === index
          ? {
              ...it,
              movementId: cand.id,
              movementSlug: cand.slug,
              movementName: cand.display_name,
              meta: {
                ...(it.meta ?? {}),
                swappedFrom:
                  (it.meta?.swappedFrom as { movementId: string; movementName: string } | undefined) ?? {
                    movementId: it.movementId,
                    movementName: it.movementName ?? it.movementSlug ?? "previous",
                  },
                swappedAt: new Date().toISOString(),
              },
            }
          : it,
      ),
    };
    setPrescription(optimistic);
    setOpenIndex(null);
    setErrorByIndex((m) => {
      const next = { ...m };
      delete next[index];
      return next;
    });

    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("itemIndex", String(index));
      fd.set("newMovementId", cand.id);
      const result = await swapAction(fd);
      if (result?.error) {
        // Rollback.
        setPrescription(prev);
        setErrorByIndex((m) => ({ ...m, [index]: result.error ?? "Swap failed." }));
        return;
      }
      if (result?.prescription) setPrescription(result.prescription);
    });
  };

  return (
    <section
      data-testid="prescription-items"
      className="cp-card"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Today&apos;s prescription
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {prescription.items.map((item, index) => (
          <PrescriptionRow
            key={`${index}-${item.movementId}`}
            item={item}
            index={index}
            open={openIndex === index}
            error={errorByIndex[index] ?? null}
            onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            onPick={(c) => onPick(index, c)}
          />
        ))}
      </ul>
    </section>
  );
}

function PrescriptionRow({
  item,
  index,
  open,
  error,
  onToggle,
  onPick,
}: {
  item: PrescriptionItem;
  index: number;
  open: boolean;
  error: string | null;
  onToggle: () => void;
  onPick: (c: Candidate) => void;
}) {
  const swapped = isSwapped(item);
  const originalName = originalMovementName(item);
  const swappable = STRENGTH_KINDS.has(item.kind) || item.kind.startsWith("cardio_");

  return (
    <li
      data-testid={`prescription-item-${index}`}
      data-swapped={swapped ? "true" : "false"}
      style={{
        border: `1px solid ${error ? "var(--cp-danger)" : "var(--cp-border)"}`,
        borderRadius: 10,
        padding: "8px 10px",
        background: "var(--cp-surface-soft)",
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 auto" }}>
          {item.movementName ?? item.movementSlug ?? "Movement"}
        </span>
        {swapped && (
          <span
            data-testid={`prescription-item-swapped-${index}`}
            title={originalName ? `Originally: ${originalName}` : "Swapped"}
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 999,
              background: "var(--cp-accent-soft)",
              color: "var(--cp-accent)",
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Swapped
          </span>
        )}
        <span
          className="mono"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          {formatItemBrief(item)}
        </span>
        {swappable && (
          <button
            type="button"
            onClick={onToggle}
            data-testid={`prescription-item-swap-button-${index}`}
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
            aria-expanded={open}
          >
            {open ? "× cancel" : "Swap"}
          </button>
        )}
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
      {open && (
        <SwapCandidatePicker
          originalId={item.movementId}
          onPick={onPick}
          onClose={onToggle}
        />
      )}
    </li>
  );
}

function SwapCandidatePicker({
  originalId,
  onPick,
}: {
  originalId: string;
  onPick: (c: Candidate) => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  // Lazy-fetch the candidate list when the picker opens. We don't
  // preload — keeps the per-item DOM cost low.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/movements/swap-candidates?originalId=${encodeURIComponent(originalId)}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as { movements: Candidate[] };
      })
      .then((body) => {
        if (!cancelled) setCandidates(body.movements);
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
  }, [originalId]);

  return (
    <div
      data-testid="swap-candidates"
      style={{
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 8,
        padding: 8,
        display: "grid",
        gap: 4,
        maxHeight: 240,
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
      {!loading && !error && candidates.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          No compatible alternatives in the catalog.
        </div>
      )}
      {!loading &&
        !error &&
        candidates.map((c) => (
          <button
            type="button"
            key={c.id}
            onClick={() => onPick(c)}
            data-testid={`swap-candidate-${c.slug}`}
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
                style={{ fontSize: 11, color: "var(--cp-text-muted)" }}
                className="mono"
              >
                {c.equipment}
              </span>
            )}
          </button>
        ))}
    </div>
  );
}

function formatItemBrief(item: PrescriptionItem): string {
  if (item.kind.startsWith("cardio_")) {
    return item.durationMin ? `${item.durationMin} min` : "cardio";
  }
  const sets = item.sets ?? 1;
  const reps = item.reps;
  const pct = item.percentTm ? ` @ ${item.percentTm}%` : "";
  return reps != null ? `${sets} × ${reps}${pct}` : `${sets} sets${pct}`;
}
