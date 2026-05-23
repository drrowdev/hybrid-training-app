/**
 * GoalsCard — placeholder card for the Today right rail.
 *
 * No `goals` table exists yet; this surface is a stub that points the
 * user toward future settings. Kept here so the rail composition stays
 * stable once goals ship.
 */

import Link from "next/link";

export function GoalsCard() {
  return (
    <section
      className="cp-card"
      style={{ padding: 18 }}
      aria-label="Goals (coming soon)"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Goals</h4>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 12,
          color: "var(--cp-text-muted)",
          lineHeight: 1.5,
        }}
      >
        Goals coming soon.{" "}
        <Link
          href="/app/more"
          style={{ color: "var(--cp-link)", textDecoration: "none" }}
        >
          Set a target →
        </Link>
      </p>
    </section>
  );
}
