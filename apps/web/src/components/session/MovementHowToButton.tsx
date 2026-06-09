"use client";

/**
 * MovementHowToButton — a small ⓘ affordance that opens a bottom sheet with the
 * movement's how-to (summary, setup, steps, cues, common mistakes).
 *
 * Drop it next to any movement name (session card header, swap rows). Content is
 * fetched on first open from the side table and cached for the component's life,
 * so it costs nothing until the user actually asks "how do I do this?".
 */
import { useId, useState, useTransition, type ReactNode } from "react";
import {
  getMovementInstructions,
  type MovementHowTo,
} from "@/lib/movements/instructions";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; howTo: MovementHowTo | null };

export function MovementHowToButton({
  movementId,
  displayName,
}: {
  movementId: string;
  displayName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [, startTransition] = useTransition();
  const titleId = useId();

  const openSheet = () => {
    setOpen(true);
    if (state.status === "idle") {
      setState({ status: "loading" });
      startTransition(async () => {
        const howTo = await getMovementInstructions(movementId);
        setState({ status: "loaded", howTo });
      });
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label={`How to do ${displayName}`}
        data-testid="movement-howto-button"
        onClick={(e) => {
          // Nested inside the card-header toggle button — don't collapse the card.
          e.preventDefault();
          e.stopPropagation();
          openSheet();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: "50%",
          border: "1px solid var(--cp-border)",
          background: "transparent",
          color: "var(--cp-text-muted)",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        i
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="movement-howto-sheet"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 70,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cp-card"
            style={{
              width: "100%",
              maxWidth: 520,
              maxHeight: "85vh",
              overflowY: "auto",
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
              padding: "18px 20px 28px",
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 12 }}>
              <h2 id={titleId} style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>
                {displayName}
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--cp-text-muted)",
                  fontSize: 22,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>

            {state.status !== "loaded" ? (
              <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>Loading…</div>
            ) : state.howTo == null ? (
              <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
                No how-to for this movement yet.
              </div>
            ) : (
              <HowToBody howTo={state.howTo} />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--cp-text-muted)",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function HowToBody({ howTo }: { howTo: MovementHowTo }) {
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--cp-text)" }}>
        {howTo.summary}
      </p>

      {howTo.setup && (
        <Section label="Setup">
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: "var(--cp-text)" }}>
            {howTo.setup}
          </p>
        </Section>
      )}

      {howTo.steps.length > 0 && (
        <Section label="Steps">
          <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 5 }}>
            {howTo.steps.map((s, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--cp-text)" }}>
                {s}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {howTo.cues.length > 0 && (
        <Section label="Cues">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
            {howTo.cues.map((c, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--cp-text)" }}>
                {c}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {howTo.commonMistakes.length > 0 && (
        <Section label="Avoid">
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
            {howTo.commonMistakes.map((m, i) => (
              <li key={i} style={{ fontSize: 13.5, lineHeight: 1.5, color: "var(--cp-text-muted)" }}>
                {m}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
