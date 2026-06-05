import { startSession } from "@/lib/sessions/actions";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Start an ad-hoc (off-plan) session.
 *
 * The pre-session fatigue + soreness interstitial was removed; this
 * surface used to host it. What remains is a single optional title
 * field plus a Start button — everything else is logged on the
 * session detail page. The daily wellness check-in card was retired
 * from the Today page (see chore/retire-wellness-checkin).
 */
export default function NewSessionPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app", label: "Today" }}
        title="Start workout"
        subtitle="Off-plan workout. Log what you actually did on the next screen."
      />
      <form action={startSession} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="title">
            Workout title (optional)
          </label>
          <input
            id="title"
            name="title"
            type="text"
            placeholder="e.g. Upper push + Z2 bike"
            maxLength={120}
            className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          data-testid="adhoc-start-button"
          className="rounded-md bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90"
        >
          Start workout
        </button>
      </form>
    </div>
  );
}
