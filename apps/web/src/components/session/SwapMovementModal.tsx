"use client";

/**
 * SwapMovementModal — mid-workout movement swap.
 *
 * Surfaces a focused modal letting the lifter swap the currently
 * active movement for a catalog alternative (same primary
 * pattern/role) when pain, equipment, or any other reason makes the
 * prescribed lift undoable.
 *
 * The swap is forward-only: sets already logged against the original
 * movement stay attributed to it. Going forward, the logger writes
 * sets against the new movement. The override audit log (DC-K4)
 * captures the original/new ids, a reason category (pain / equipment
 * / other), and an optional freeform note via `swapActiveMovement`.
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { swapActiveMovement } from "@/lib/sessions/swap-actions";

export type SwapMovementCatalogRow = {
  id: string;
  slug: string;
  display_name: string;
  equipment: string | null;
  /** Server similarity rank flag — the closest alternatives to the original. */
  recommended?: boolean;
};

export type SwapMovementModalProps = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  original: { id: string; displayName: string };
  /** Called with the picked movement once the swap is recorded. */
  onSwapped: (next: { id: string; slug: string; displayName: string }) => void;
};

type ReasonCategory = "pain" | "equipment" | "other";

const REASON_CHIPS: { id: ReasonCategory; label: string }[] = [
  { id: "pain", label: "Pain" },
  { id: "equipment", label: "Equipment" },
  { id: "other", label: "Other" },
];

export function SwapMovementModal({
  open,
  onClose,
  sessionId,
  original,
  onSwapped,
}: SwapMovementModalProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<SwapMovementCatalogRow[]>([]);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState<ReasonCategory>("pain");
  const [freeform, setFreeform] = useState("");
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();

  // Lazy-fetch candidates from the same role/pattern bucket on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(
      `/api/movements/swap-candidates?originalId=${encodeURIComponent(original.id)}&limit=40`,
    )
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${r.status}`);
        }
        return (await r.json()) as { movements: SwapMovementCatalogRow[] };
      })
      .then((body) => {
        if (!cancelled) {
          setCandidates(body.movements ?? []);
          setError(null);
        }
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
  }, [open, original.id]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => searchRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered =
    search.trim().length === 0
      ? candidates
      : candidates.filter((c) =>
          c.display_name.toLowerCase().includes(search.trim().toLowerCase()),
        );
  const isSearching = search.trim().length > 0;
  const recommended = filtered.filter((c) => c.recommended);
  const others = filtered.filter((c) => !c.recommended);

  const renderCandidate = (c: SwapMovementCatalogRow) => (
    <button
      key={c.id}
      type="button"
      onClick={() => confirm(c)}
      disabled={pending}
      data-testid={`swap-modal-candidate-${c.slug}`}
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 8,
        border: `1px solid ${c.recommended ? "color-mix(in oklab, var(--cp-accent) 45%, var(--cp-border))" : "var(--cp-border)"}`,
        background: "var(--cp-surface-soft)",
        color: "var(--cp-text)",
        cursor: pending ? "wait" : "pointer",
        fontSize: 13,
        minHeight: 44,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span style={{ fontWeight: 500 }}>{c.display_name}</span>
      {c.equipment && (
        <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {c.equipment}
        </span>
      )}
    </button>
  );

  const sectionLabel = (text: string) => (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--cp-text-muted)",
        marginTop: 4,
        fontWeight: 600,
      }}
    >
      {text}
    </div>
  );

  const confirm = (pick: SwapMovementCatalogRow) => {
    setError(null);
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("originalMovementId", original.id);
    fd.set("newMovementId", pick.id);
    fd.set("reason", reason);
    if (freeform.trim().length > 0) fd.set("freeformReason", freeform.trim());
    startTransition(async () => {
      const res = await swapActiveMovement(fd);
      if (res.error || !res.newMovement) {
        setError(res.error ?? "Swap failed.");
        return;
      }
      onSwapped(res.newMovement);
      onClose();
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="swap-movement-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cp-card"
        style={{
          maxWidth: 480,
          width: "100%",
          padding: 20,
          display: "grid",
          gap: 14,
          background: "var(--cp-surface)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 16 }}>
            Swap <em style={{ fontStyle: "italic" }}>{original.displayName}</em> for what?
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            data-testid="swap-modal-close"
            style={{ background: "transparent", border: 0, color: "var(--cp-text-muted)", fontSize: 18, cursor: "pointer" }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }} role="radiogroup" aria-label="Reason">
          {REASON_CHIPS.map((c) => {
            const selected = c.id === reason;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`swap-reason-${c.id}`}
                onClick={() => setReason(c.id)}
                style={{
                  padding: "6px 12px",
                  minHeight: 36,
                  borderRadius: 999,
                  border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
                  color: selected ? "var(--cp-accent)" : "var(--cp-text)",
                  fontSize: 12,
                  fontWeight: selected ? 600 : 500,
                  cursor: "pointer",
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>

        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--cp-text-muted)" }}>
          Why are you swapping? <span style={{ color: "var(--cp-text-muted)" }}>(optional)</span>
          <input
            type="text"
            value={freeform}
            onChange={(e) => setFreeform(e.target.value.slice(0, 280))}
            maxLength={280}
            data-testid="swap-reason-freeform"
            placeholder="Right knee twinge on squat descent…"
            style={{
              padding: "8px 10px",
              border: "1px solid var(--cp-border)",
              borderRadius: 8,
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
        </label>

        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="swap-modal-search"
          placeholder="Search alternatives…"
          style={{
            padding: "8px 10px",
            border: "1px solid var(--cp-border)",
            borderRadius: 8,
            background: "var(--cp-surface)",
            color: "var(--cp-text)",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        />

        <div
          data-testid="swap-modal-list"
          style={{
            display: "grid",
            gap: 4,
            maxHeight: 280,
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {loading && (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Loading…</div>
          )}
          {error && (
            <div role="alert" data-testid="swap-modal-error" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
              {error}
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              No compatible alternatives in the catalog.
            </div>
          )}
          {!loading && !error && filtered.length > 0 && (
            isSearching ? (
              filtered.map(renderCandidate)
            ) : (
              <>
                {recommended.length > 0 && (
                  <>
                    {sectionLabel("Recommended")}
                    {recommended.map(renderCandidate)}
                  </>
                )}
                {others.length > 0 && (
                  <>
                    {recommended.length > 0 && sectionLabel("Other alternatives")}
                    {others.map(renderCandidate)}
                  </>
                )}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
