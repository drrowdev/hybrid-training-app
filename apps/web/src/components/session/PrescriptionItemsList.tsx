"use client";

/**
 * Prescription items list with mid-workout swap affordance (Phase 2 A1 + A3)
 * AND one-tap "log against this item" prefill (feat/logging-works).
 *
 * Each strength prescription row is now an interactive button: tap to
 * prefill the linked `<SessionLogClient>` quick-entry form with the
 * item's movement / weight / reps / kind so the user can commit a
 * matching set in one tap. Rows whose item has already been logged
 * show a small ✓ chip (--cp-success) instead of the chevron and
 * scroll the user to the logged-set row when tapped (no prefill).
 *
 * Above the list a slim progress chip — "5 of 9 sets logged" — shows
 * how much of the prescription has been satisfied.
 *
 * The Swap affordance is unchanged; tapping "Swap" still opens the
 * candidate picker and does NOT trigger prefill (the click is
 * intercepted via stopPropagation).
 *
 * Optimistic update: as soon as the user picks a replacement we paint
 * the new name immediately and call the server action in the background.
 * Failures roll back and surface an error (red ring around the item).
 *
 * Phase 3 D1 — on viewports ≤640px the list collapses into a swipeable
 * single-item carousel with dot indicators. Swipe horizontally to
 * advance / retreat. Desktop is unaffected.
 */

import { useState, useEffect, useRef, useTransition } from "react";
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

/**
 * Public callback the session work area uses to react to a row tap.
 * `loggedSetId` is the canonical id of the satisfying set when the row
 * is already done (so the caller can scroll to it); null otherwise.
 */
export type PrescriptionItemTapHandler = (args: {
  index: number;
  item: PrescriptionItem;
  loggedSetId: string | null;
}) => void;

export function PrescriptionItemsList({
  plannedSessionId,
  initialPrescription,
  swapAction,
  loggedItemIndices,
  loggedSetIdByItemIndex,
  onItemTap,
}: {
  plannedSessionId: string;
  initialPrescription: Prescription;
  swapAction: SwapAction;
  /** Item indices that already have ≥1 matching logged set. */
  loggedItemIndices?: ReadonlySet<number>;
  /** For "done" rows, the canonical id of the satisfying logged set (so the caller can scroll to it). */
  loggedSetIdByItemIndex?: Readonly<Record<number, string>>;
  /** Fires on row tap. Receives logged-set id when the row is already done. */
  onItemTap?: PrescriptionItemTapHandler;
}) {
  const [prescription, setPrescription] = useState(initialPrescription);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [errorByIndex, setErrorByIndex] = useState<Record<number, string>>({});
  const [reasonByIndex, setReasonByIndex] = useState<Record<number, string>>({});
  const [, startTransition] = useTransition();

  if (!prescription.items || prescription.items.length === 0) return null;

  const strengthItemCount = prescription.items.filter((it) => STRENGTH_KINDS.has(it.kind)).length;
  const loggedCount = loggedItemIndices ? loggedItemIndices.size : 0;
  const cappedLogged = Math.min(loggedCount, strengthItemCount);
  const progressPct =
    strengthItemCount > 0 ? Math.round((cappedLogged / strengthItemCount) * 100) : 0;

  const onPick = async (index: number, cand: Candidate) => {
    const prev = prescription;
    const reason = (reasonByIndex[index] ?? "").trim();
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
    setReasonByIndex((m) => {
      const next = { ...m };
      delete next[index];
      return next;
    });

    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("itemIndex", String(index));
      fd.set("newMovementId", cand.id);
      if (reason.length > 0) fd.set("reason", reason.slice(0, 280));
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

  const setReason = (index: number, value: string) =>
    setReasonByIndex((m) => ({ ...m, [index]: value.slice(0, 280) }));

  const handleRowTap = (index: number) => {
    if (!onItemTap) return;
    const item = prescription.items[index];
    if (!item) return;
    const loggedSetId = loggedSetIdByItemIndex?.[index] ?? null;
    onItemTap({ index, item, loggedSetId });
  };

  return (
    <section
      data-testid="prescription-items"
      className="cp-card"
      style={{ padding: 16, display: "grid", gap: 10 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap",
        }}
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
        {strengthItemCount > 0 && (
          <div
            data-testid="prescription-progress-chip"
            data-logged={cappedLogged}
            data-total={strengthItemCount}
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span className="mono" style={{ color: "var(--cp-text)" }}>
              {cappedLogged} of {strengthItemCount}
            </span>{" "}
            <span>sets logged</span>
            <span
              aria-hidden="true"
              style={{
                width: 64,
                height: 4,
                borderRadius: 999,
                background: "var(--cp-surface-soft)",
                overflow: "hidden",
                display: "inline-block",
              }}
            >
              <span
                style={{
                  display: "block",
                  width: `${progressPct}%`,
                  height: "100%",
                  background: "var(--cp-accent)",
                  transition: "width 180ms ease-out",
                }}
              />
            </span>
          </div>
        )}
      </div>
      <PrescriptionItemsCarousel
        items={prescription.items}
        openIndex={openIndex}
        errorByIndex={errorByIndex}
        reasonByIndex={reasonByIndex}
        loggedItemIndices={loggedItemIndices}
        onToggle={(i) => setOpenIndex(openIndex === i ? null : i)}
        onPick={onPick}
        onReasonChange={setReason}
        onRowTap={handleRowTap}
        tapEnabled={Boolean(onItemTap)}
      />
    </section>
  );
}

/**
 * Renders the prescription items list AND its mobile carousel
 * variant. The desktop branch keeps the full vertical list — same
 * shape as before Phase 3. The mobile branch (≤640px) shows ONE item
 * at a time with dot indicators above and a horizontal touch-swipe
 * handler that advances / retreats.
 *
 * Detection runs once on mount via `matchMedia` and re-runs on resize
 * so the layout adapts to device rotation.
 */
function PrescriptionItemsCarousel({
  items,
  openIndex,
  errorByIndex,
  reasonByIndex,
  loggedItemIndices,
  onToggle,
  onPick,
  onReasonChange,
  onRowTap,
  tapEnabled,
}: {
  items: PrescriptionItem[];
  openIndex: number | null;
  errorByIndex: Record<number, string>;
  reasonByIndex: Record<number, string>;
  loggedItemIndices?: ReadonlySet<number>;
  onToggle: (i: number) => void;
  onPick: (i: number, c: Candidate) => void;
  onReasonChange: (i: number, value: string) => void;
  onRowTap: (i: number) => void;
  tapEnabled: boolean;
}) {
  const [isMobile, setIsMobile] = useState(false);
  const [active, setActive] = useState(0);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- clamp index after items shrink */
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  if (!isMobile) {
    return (
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
        {items.map((item, index) => (
          <PrescriptionRow
            key={`${index}-${item.movementId}`}
            item={item}
            index={index}
            open={openIndex === index}
            error={errorByIndex[index] ?? null}
            reason={reasonByIndex[index] ?? ""}
            logged={loggedItemIndices?.has(index) ?? false}
            tapEnabled={tapEnabled}
            onReasonChange={(v) => onReasonChange(index, v)}
            onToggle={() => onToggle(index)}
            onPick={(c) => onPick(index, c)}
            onRowTap={() => onRowTap(index)}
          />
        ))}
      </ul>
    );
  }

  const SWIPE_THRESHOLD = 50;
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    if (start == null) return;
    const end = e.changedTouches[0]?.clientX ?? start;
    const dx = end - start;
    touchStartX.current = null;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0 && active < items.length - 1) setActive((i) => i + 1);
    if (dx > 0 && active > 0) setActive((i) => i - 1);
  };

  const item = items[active];
  if (!item) return null;

  return (
    <div data-testid="prescription-items-carousel">
      <div
        role="tablist"
        aria-label="Prescription item"
        style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 8 }}
      >
        {items.map((_, i) => {
          const sel = i === active;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={sel}
              data-testid={`prescription-dot-${i}`}
              onClick={() => setActive(i)}
              style={{
                width: sel ? 18 : 8,
                height: 8,
                borderRadius: 999,
                border: "none",
                background: sel ? "var(--cp-accent)" : "var(--cp-border-strong)",
                cursor: "pointer",
                padding: 0,
                transition: "width 120ms ease-out",
              }}
              aria-label={`Show item ${i + 1} of ${items.length}`}
            />
          );
        })}
      </div>
      <ul
        style={{ listStyle: "none", padding: 0, margin: 0 }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        data-testid="prescription-items-swipe-zone"
      >
        <PrescriptionRow
          key={`${active}-${item.movementId}`}
          item={item}
          index={active}
          open={openIndex === active}
          error={errorByIndex[active] ?? null}
          reason={reasonByIndex[active] ?? ""}
          logged={loggedItemIndices?.has(active) ?? false}
          tapEnabled={tapEnabled}
          onReasonChange={(v) => onReasonChange(active, v)}
          onToggle={() => onToggle(active)}
          onPick={(c) => onPick(active, c)}
          onRowTap={() => onRowTap(active)}
        />
      </ul>
      <div
        style={{
          marginTop: 6,
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {active + 1} / {items.length} · swipe →
      </div>
    </div>
  );
}

function PrescriptionRow({
  item,
  index,
  open,
  error,
  reason,
  logged,
  tapEnabled,
  onReasonChange,
  onToggle,
  onPick,
  onRowTap,
}: {
  item: PrescriptionItem;
  index: number;
  open: boolean;
  error: string | null;
  reason: string;
  logged: boolean;
  tapEnabled: boolean;
  onReasonChange: (value: string) => void;
  onToggle: () => void;
  onPick: (c: Candidate) => void;
  onRowTap: () => void;
}) {
  const swapped = isSwapped(item);
  const originalName = originalMovementName(item);
  const swappable = STRENGTH_KINDS.has(item.kind) || item.kind.startsWith("cardio_");
  // Cardio items aren't logged from this list (they have their own
  // form), so don't pretend they're tappable for prefill.
  const rowTappable = tapEnabled && STRENGTH_KINDS.has(item.kind);

  // The interactive surface is a transparent button that overlays the
  // row content. We stop click propagation on the inner Swap button so
  // the user can swap without accidentally triggering prefill.
  const handleSwapClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <li
      data-testid={`prescription-item-${index}`}
      data-swapped={swapped ? "true" : "false"}
      data-logged={logged ? "true" : "false"}
      style={{
        border: `1px solid ${error ? "var(--cp-danger)" : logged ? "color-mix(in oklab, var(--cp-success) 50%, var(--cp-border))" : "var(--cp-border)"}`,
        borderRadius: 10,
        padding: 0,
        background: logged
          ? "color-mix(in oklab, var(--cp-success) 7%, var(--cp-surface-soft))"
          : "var(--cp-surface-soft)",
        display: "grid",
        gap: 0,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={rowTappable ? onRowTap : undefined}
        disabled={!rowTappable}
        data-testid={`prescription-item-tap-${index}`}
        aria-label={
          logged
            ? `Show logged set for ${item.movementName ?? item.movementSlug ?? "this movement"}`
            : `Log set for ${item.movementName ?? item.movementSlug ?? "this movement"}`
        }
        style={{
          all: "unset",
          display: "block",
          padding: "8px 10px",
          cursor: rowTappable ? "pointer" : "default",
          borderRadius: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {logged && (
            <span
              data-testid={`prescription-item-check-${index}`}
              aria-label="Logged"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 18,
                height: 18,
                borderRadius: 999,
                background: "var(--cp-success)",
                color: "var(--cp-accent-fg, #fff)",
                fontSize: 11,
                fontWeight: 700,
                lineHeight: 1,
                flex: "0 0 auto",
              }}
            >
              ✓
            </span>
          )}
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              flex: "1 1 auto",
              color: logged ? "var(--cp-text-muted)" : "var(--cp-text)",
              textDecoration: logged ? "line-through" : "none",
            }}
          >
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
          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
            {formatItemBrief(item)}
          </span>
          {swappable && (
            <button
              type="button"
              onClick={handleSwapClick}
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
      </button>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)", padding: "0 10px 8px" }}>
          {error}
        </div>
      )}
      {open && (
        <div style={{ padding: "0 10px 10px", display: "grid", gap: 8 }}>
          <label
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              display: "block",
            }}
          >
            Why are you swapping? (optional)
            <textarea
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              maxLength={280}
              rows={2}
              data-testid={`prescription-item-swap-reason-${index}`}
              placeholder="Bar busy, shoulder twinge, no rack…"
              style={{
                display: "block",
                width: "100%",
                marginTop: 4,
                padding: "6px 8px",
                border: "1px solid var(--cp-border)",
                borderRadius: 6,
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontSize: 13,
                fontFamily: "inherit",
                resize: "vertical",
                minHeight: 36,
              }}
            />
          </label>
          <SwapCandidatePicker
            originalId={item.movementId}
            onPick={onPick}
            onClose={onToggle}
          />
        </div>
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
  // ADR 0007 — surface the AMRAP top set with a trailing "+".
  const amrap = item.isAmrap === true ? "+" : "";
  return reps != null ? `${sets} × ${reps}${amrap}${pct}` : `${sets} sets${pct}`;
}
