"use client";

/**
 * MovementHowToButton — a small ⓘ affordance that opens a CENTERED modal with
 * the movement's how-to (summary, setup, numbered steps, cues, common mistakes).
 *
 * Drop it next to any movement name (session card header, swap rows).
 *
 * Latency: the content is fetched from a side table via a server action. To make
 * it feel instant on tap, each button PREFETCHES its movement's how-to in the
 * background on mount and stores it in a module-level cache (deduped + shared
 * across remounts and repeated movements). By the time the user reads the
 * workout and taps ⓘ, the content is almost always already resident.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  getMovementInstructions,
  type MovementHowTo,
} from "@/lib/movements/instructions";

// Module-level cache shared by every button instance for the page's lifetime.
// `null` is a real cached value ("no how-to for this movement").
const howToCache = new Map<string, MovementHowTo | null>();
const inFlight = new Map<string, Promise<MovementHowTo | null>>();

function fetchHowTo(movementId: string): Promise<MovementHowTo | null> {
  if (howToCache.has(movementId)) {
    return Promise.resolve(howToCache.get(movementId) ?? null);
  }
  const existing = inFlight.get(movementId);
  if (existing) return existing;
  const p = getMovementInstructions(movementId)
    .then((howTo) => {
      howToCache.set(movementId, howTo);
      inFlight.delete(movementId);
      return howTo;
    })
    .catch(() => {
      inFlight.delete(movementId);
      return null;
    });
  inFlight.set(movementId, p);
  return p;
}

type LoadState =
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
  const [state, setState] = useState<LoadState>(() =>
    howToCache.has(movementId)
      ? { status: "loaded", howTo: howToCache.get(movementId) ?? null }
      : { status: "loading" },
  );
  const titleId = useId();
  const mounted = useRef(true);

  // Prefetch on mount so the content is ready before the user taps.
  useEffect(() => {
    mounted.current = true;
    if (state.status === "loaded") return;
    void fetchHowTo(movementId).then((howTo) => {
      if (mounted.current) setState({ status: "loaded", howTo });
    });
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prefetch once per movement on mount
  }, [movementId]);

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
          setOpen(true);
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
            display: "grid",
            placeItems: "center",
            zIndex: 70,
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cp-card"
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "85vh",
              overflowY: "auto",
              borderRadius: 16,
              padding: "18px 20px 24px",
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

            {state.status === "loading" ? (
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

function StepRow({ index, text }: { index: number; text: string }) {
  return (
    <li style={{ display: "flex", gap: 10, alignItems: "start" }}>
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "var(--cp-accent)",
          color: "var(--cp-on-accent, #0a0a0a)",
          fontSize: 11,
          fontWeight: 700,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        {index}
      </span>
      <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--cp-text)" }}>{text}</span>
    </li>
  );
}

function IconRow({
  icon,
  color,
  text,
  muted,
}: {
  icon: string;
  color: string;
  text: string;
  muted?: boolean;
}) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "start" }}>
      <span aria-hidden style={{ flexShrink: 0, color, fontSize: 13, fontWeight: 700, marginTop: 1 }}>
        {icon}
      </span>
      <span
        style={{
          fontSize: 13.5,
          lineHeight: 1.45,
          color: muted ? "var(--cp-text-muted)" : "var(--cp-text)",
        }}
      >
        {text}
      </span>
    </li>
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
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 7 }}>
            {howTo.steps.map((s, i) => (
              <StepRow key={i} index={i + 1} text={s} />
            ))}
          </ol>
        </Section>
      )}

      {howTo.cues.length > 0 && (
        <Section label="Cues">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {howTo.cues.map((c, i) => (
              <IconRow key={i} icon="✓" color="var(--cp-success, #16a34a)" text={c} />
            ))}
          </ul>
        </Section>
      )}

      {howTo.commonMistakes.length > 0 && (
        <Section label="Avoid">
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
            {howTo.commonMistakes.map((m, i) => (
              <IconRow key={i} icon="✗" color="var(--cp-danger, #dc2626)" text={m} muted />
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
