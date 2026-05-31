/**
 * LimitationResponseCard — ADR 0014 mid-block limitation-response offer.
 *
 * Shared between the active-block view on `/app/plan` and the
 * `/app/recovery/injuries` page so the user sees "here's what I'll change"
 * both where the impact lands (the plan) and where the limitation is
 * authored (the injuries page). Pure presentational + a single server
 * action passed as a prop; no client hooks.
 */
import type { ReactElement } from "react";
import type { LimitationResponseOffer } from "@/lib/limitations/offer";

export function LimitationResponseCard({
  offer,
  action,
}: {
  offer: LimitationResponseOffer;
  action: () => Promise<void>;
}): ReactElement {
  const autoCount = offer.swaps.length + offer.drops.length;
  return (
    <section
      className="cp-card"
      role="alert"
      style={{
        padding: "14px 18px",
        display: "grid",
        gap: 8,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Limitation — adjust remaining sessions
      </div>
      <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
        A limitation you flagged still affects movements scheduled later in
        this block. The engine can adjust your upcoming sessions to work
        around it:
      </div>
      {offer.swaps.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--cp-text-muted)" }}>
          {offer.swaps.slice(0, 6).map((s) => (
            <li key={`${s.sessionId}-${s.itemIndex}`}>
              <strong style={{ color: "var(--cp-text)" }}>{s.fromName}</strong>
              {" → "}
              <strong style={{ color: "var(--cp-text)" }}>{s.toName}</strong>
            </li>
          ))}
          {offer.swaps.length > 6 && <li>+{offer.swaps.length - 6} more swaps</li>}
        </ul>
      )}
      {offer.drops.length > 0 && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          {offer.drops.length} accessory movement
          {offer.drops.length === 1 ? "" : "s"} with no safe alternative will be
          removed.
        </div>
      )}
      {offer.warns.length > 0 && (
        <div style={{ fontSize: 12, color: "var(--cp-warning)" }}>
          ⚠ {offer.warns.length} main-lift movement
          {offer.warns.length === 1 ? "" : "s"} also load this area (
          {offer.warns.slice(0, 3).map((w) => w.fromName).join(", ")}
          {offer.warns.length > 3 ? "…" : ""}). These aren&apos;t changed
          automatically — adjusting load, range of motion, or grip on a primary
          lift is best decided with a clinician.
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
        This is load management, not medical care. If symptoms persist or
        worsen, see a qualified clinician.
      </div>
      {autoCount > 0 && (
        <form action={action}>
          <button
            type="submit"
            className="cp-btn"
            style={{ fontSize: 13, padding: "7px 14px", justifySelf: "start" }}
          >
            Apply {autoCount} change{autoCount === 1 ? "" : "s"}
          </button>
        </form>
      )}
    </section>
  );
}
