/**
 * /app/settings/hr-zones — placeholder route.
 *
 * The HR-zones card empty-state links here so the CTA never 404s. A
 * proper editor (Z1–Z5 thresholds, max-HR self-report, %HRR vs %HRmax
 * toggle) ships in a follow-up; for now this surface explains what's
 * coming and points back to settings.
 */
export const dynamic = "force-dynamic";

export default function HrZonesSettingsPage() {
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 560 }}>
      <header>
        <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>HR zones</h1>
      </header>
      <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
        HR zones configuration coming soon. Once available, you&apos;ll be able to
        self-report your max heart rate (or set Z1–Z5 thresholds explicitly)
        and this page will backfill the Time-in-HR-zones card against your
        Strava-imported activities.
      </p>
    </div>
  );
}
