"use client";

/**
 * Phase 3 A2 — weekly bodyweight nudge.
 *
 * Renders a small dismissable card in the Today page's quieter zone
 * (below the hero, alongside the "Up next" / "Recent" strips) when
 * the user hasn't logged a bodyweight in the past 7 days. The card
 * is intentionally low-stakes: a single number input, a Save button,
 * and a small "×" dismiss that hides the card for another 7 days via
 * localStorage. The hero session card is never blocked or pushed
 * around — this is a polite ask, not a modal.
 */

import { useEffect, useState, useTransition } from "react";

const DISMISS_KEY = "hta:bw-nudge:dismissed-until";
const DISMISS_DAYS = 7;

export type RecordCheckInAction = (
  fd: FormData,
) => Promise<{ ok?: true; error?: string }>;

export function BodyweightNudge({
  todayYmd,
  recordDailyCheckIn,
}: {
  todayYmd: string;
  recordDailyCheckIn: RecordCheckInAction;
}) {
  const [hidden, setHidden] = useState(true); // SSR-safe — reveal after the localStorage check.
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weight, setWeight] = useState("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    try {
      const until = window.localStorage.getItem(DISMISS_KEY);
      if (until && Date.now() < Number.parseInt(until, 10)) {
        setHidden(true);
        return;
      }
    } catch {
      // localStorage may be unavailable — fall through and show the nudge.
    }
    setHidden(false);
  }, []);

  if (hidden) return null;
  if (saved) {
    return (
      <div
        data-testid="bw-nudge-saved"
        className="cp-card"
        style={{
          padding: 12,
          fontSize: 13,
          color: "var(--cp-text-muted)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span style={{ color: "var(--cp-success)", fontWeight: 700 }}>✓</span>
        Bodyweight logged for today — thanks. We&apos;ll ask again next week.
      </div>
    );
  }

  const dismiss = () => {
    try {
      const until = Date.now() + DISMISS_DAYS * 86_400_000;
      window.localStorage.setItem(DISMISS_KEY, String(until));
    } catch {
      // No-op: best effort.
    }
    setHidden(true);
  };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = Number(weight);
    if (!Number.isFinite(value) || value < 20 || value > 400) {
      setError("Enter a value between 20 and 400 kg.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("date", todayYmd);
    fd.set("bodyweightKg", String(value));
    startTransition(async () => {
      const result = await recordDailyCheckIn(fd);
      if (result?.error) {
        setError(result.error);
        return;
      }
      try {
        window.localStorage.removeItem(DISMISS_KEY);
      } catch {
        // No-op.
      }
      setSaved(true);
    });
  };

  return (
    <form
      onSubmit={submit}
      data-testid="bw-nudge"
      className="cp-card"
      style={{
        padding: 14,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
        borderColor: "var(--cp-border)",
      }}
    >
      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Quick check-in
        </div>
        <div style={{ fontSize: 14, marginTop: 2 }}>
          <strong>Bodyweight today?</strong>{" "}
          <span style={{ color: "var(--cp-text-muted)" }}>
            Tracks weekly — never blocks training.
          </span>
        </div>
      </div>
      <input
        type="number"
        inputMode="decimal"
        step="0.1"
        min="20"
        max="400"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="kg"
        aria-label="Bodyweight in kilograms"
        data-testid="bw-nudge-input"
        style={{
          width: 96,
          padding: "10px 12px",
          fontSize: 16,
          textAlign: "right",
          border: "1px solid var(--cp-border)",
          borderRadius: 8,
          background: "var(--cp-surface)",
          color: "var(--cp-text)",
        }}
      />
      <button
        type="submit"
        className="cp-btn primary"
        disabled={isPending || weight.trim() === ""}
        data-testid="bw-nudge-save"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide bodyweight nudge for 7 days"
        data-testid="bw-nudge-dismiss"
        style={{
          border: "none",
          background: "transparent",
          color: "var(--cp-text-muted)",
          fontSize: 18,
          cursor: "pointer",
          padding: "4px 8px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
      {error && (
        <div
          role="alert"
          style={{ flexBasis: "100%", fontSize: 12, color: "var(--cp-danger)" }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
