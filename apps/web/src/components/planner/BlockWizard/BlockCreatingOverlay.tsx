"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen overlay shown while the wizard server action is creating
 * the block. Steps through a short narrative so the user perceives the
 * delay as deliberate orchestration rather than dead time.
 *
 * Pure CSS animations. No new npm deps.
 */
const STEPS = [
  "Resolving archetype",
  "Placing anchor sessions",
  "Distributing cardio",
  "Generating week shape",
  "Anchoring tendon work",
  "Saving your block",
] as const;

export function BlockCreatingOverlay(): React.ReactElement {
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setStepIdx((i) => Math.min(i + 1, STEPS.length - 1));
    }, 600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "var(--cp-overlay)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "cp-fade-in 200ms ease-out",
      }}
    >
      <div
        style={{
          width: "min(420px, 90vw)",
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
          borderRadius: 16,
          padding: "28px 24px",
          boxShadow: "var(--cp-shadow)",
          display: "grid",
          gap: 18,
          textAlign: "center",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 56,
            height: 56,
            margin: "0 auto",
            borderRadius: "50%",
            border: "3px solid var(--cp-border)",
            borderTopColor: "var(--cp-accent)",
            animation: "cp-spin 800ms linear infinite",
          }}
        />
        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: "var(--cp-text)",
              marginBottom: 8,
            }}
          >
            Building your block
          </div>
          <div
            data-testid="block-creating-step"
            style={{
              fontSize: 13,
              color: "var(--cp-text-muted)",
              minHeight: 18,
              transition: "opacity 150ms ease-out",
            }}
            key={stepIdx}
          >
            {STEPS[stepIdx]}…
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 6 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background:
                  i <= stepIdx ? "var(--cp-accent)" : "var(--cp-border)",
                transition: "background 200ms ease-out",
              }}
            />
          ))}
        </div>
      </div>
      <style jsx>{`
        @keyframes cp-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes cp-fade-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
