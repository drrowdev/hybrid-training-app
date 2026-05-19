/**
 * Terms of Service — placeholder per plan §4.5.
 */
export const metadata = {
  title: "Terms of Service — Hybrid Training App",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen px-6 py-12 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-foreground/60">Last updated: 2026-05-19 — placeholder.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">What this is</h2>
        <p className="text-sm">A web-based hybrid training app (strength + endurance programming and logging) provided as-is, primarily for personal use during alpha. Free of charge during Phase 0–3.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Not medical advice</h2>
        <p className="text-sm">The recommendations and guardrails this app surfaces are general training principles derived from peer-reviewed literature. They are <strong>not medical advice</strong>. Consult a qualified medical professional before starting any training program, especially if you have any pre-existing condition, injury, or symptom. You exercise at your own risk.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Acceptable use</h2>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li>Use the app for your own training only.</li>
          <li>Do not attempt to break authentication, scrape other users&apos; data, or otherwise abuse the platform.</li>
          <li>Do not upload illegal content.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Service availability</h2>
        <p className="text-sm">Best-effort uptime. No SLA during alpha. We may take the service offline for maintenance or upgrades without notice.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Account termination</h2>
        <p className="text-sm">You may delete your account at any time from Settings. We may suspend accounts that violate acceptable use. Account deletion is irreversible.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Liability</h2>
        <p className="text-sm">Provided &ldquo;as is&rdquo; without warranty of any kind. To the maximum extent permitted by applicable law, the developer is not liable for any direct, indirect, incidental, or consequential damages arising from use of the app, including injury sustained during training. See &ldquo;Not medical advice&rdquo; above.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Privacy</h2>
        <p className="text-sm">See the <a href="/privacy" className="underline">Privacy Policy</a>.</p>
      </section>

      <p className="text-xs text-foreground/40 pt-4">
        Placeholder. Before public launch these terms will be reviewed against the applicable consumer-protection laws (Finnish + EU) and expanded to include dispute resolution, governing law, and contact details.
      </p>
    </main>
  );
}
