/**
 * GoalsCard — placeholder card for the Today right rail.
 *
 * No `goals` table exists yet; this surface is a stub that points the
 * user toward future settings. Kept here so the rail composition stays
 * stable once goals ship.
 */

import { EmptyState } from "@/components/ui/EmptyState";

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
      <EmptyState
        variant="inline"
        title="No goals set"
        body="Set a goal (race date, lift target, weekly volume) and we'll show progress here."
      />
    </section>
  );
}
