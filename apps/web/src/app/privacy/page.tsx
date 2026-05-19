/**
 * Privacy Policy — placeholder per plan §4.5.
 *
 * Phase 0 deliverable: stub that names the controller, the data
 * collected, the legal basis (GDPR Article 6(1)(b) contract performance
 * + 6(1)(a) consent for analytics), and the data subject rights.
 * Must be expanded to full GDPR Article 13/14 disclosures before any
 * public launch.
 */
export const metadata = {
  title: "Privacy Policy — Hybrid Training App",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-6 py-12 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-foreground/60">Last updated: 2026-05-19 — placeholder, will be expanded before public launch.</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Information we collect</h2>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li><strong>Email address</strong> — required at signup; account identifier.</li>
          <li><strong>Display name</strong> — optional.</li>
          <li><strong>Training data</strong> — sessions, sets, cardio activities, wellness check-ins, body weight, recorded limitations.</li>
          <li><strong>Strava data (if connected)</strong> — cardio activities; pulled with your consent, revocable.</li>
          <li><strong>Usage analytics</strong> (PostHog) — only with your consent.</li>
          <li><strong>Error reports</strong> (Sentry) — only with your consent.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Where it lives</h2>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li>Primary storage: Supabase Postgres in the EU (eu-west-1, AWS).</li>
          <li>Web hosting: Vercel (edge network; origin in EU).</li>
          <li>All transit is HTTPS/TLS.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Your rights (GDPR)</h2>
        <ul className="list-disc list-inside text-sm space-y-1">
          <li><strong>Right to access:</strong> export all your data as JSON (Phase 1 feature).</li>
          <li><strong>Right to erasure (Article 17):</strong> delete your account at any time from Settings. Hard-deletes immediately and cascades to all your data. Live now.</li>
          <li><strong>Right to rectification:</strong> edit your profile and any logged data freely.</li>
          <li><strong>Right to data portability:</strong> JSON export covers this.</li>
          <li><strong>Right to complain:</strong> to your local data protection authority. For Finland: Tietosuojavaltuutettu.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Cookies</h2>
        <p className="text-sm">Only cookies strictly necessary for authentication (Supabase Auth session). No advertising cookies. Analytics cookies require your consent.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Contact</h2>
        <p className="text-sm">Personal-project deployment. For data-subject requests, contact via GitHub at <code>drrowdev/hybrid-training-app</code> or the email associated with your account.</p>
      </section>

      <p className="text-xs text-foreground/40 pt-4">
        This is a placeholder. Before public launch this policy will be expanded to cover the full GDPR Article 13 disclosures, retention periods, sub-processors list, and contact details for the Data Protection Officer if applicable.
      </p>
    </main>
  );
}
