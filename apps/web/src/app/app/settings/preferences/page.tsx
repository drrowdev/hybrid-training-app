import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DateTimeFormatCard } from "@/components/settings/DateTimeFormatCard";
import {
  FeedbackAutoSave,
  RecoveryCheckinAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import {
  isDateFormat,
  isTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
} from "@/lib/format/datetime";

export default async function PreferencesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "haptics_enabled, timer_sound_enabled, show_today_recovery_card, time_format, date_format, timezone",
    )
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="min-h-screen px-6 py-8 max-w-2xl mx-auto space-y-8">
      <header className="space-y-1">
        <Link
          href="/app/settings"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Preferences</h1>
        <p className="text-xs text-foreground/60">
          How the app behaves during sessions and how it stays in sync.
        </p>
      </header>

      <div className="space-y-6">
        {/* Time & date format */}
        <div className="space-y-3" data-testid="settings-datetime-format">
          <p className="text-xs text-foreground/60">
            How wall-clock times and calendar dates render across the app.
            Durations like the rest-timer countdown stay in mm:ss regardless.
          </p>
          <DateTimeFormatCard
            initialTimeFormat={
              isTimeFormat(profile?.time_format) ? profile.time_format : null
            }
            initialDateFormat={
              isDateFormat(profile?.date_format) ? profile.date_format : null
            }
            resolvedTimeFormat={resolveTimeFormat(profile ?? null)}
            resolvedDateFormat={resolveDateFormat(profile ?? null)}
          />
        </div>

        {/* Feedback */}
        <div className="space-y-3" data-testid="settings-feedback">
          <p className="text-xs text-foreground/60">
            Subtle haptic + audio cues during a session — a short buzz when
            you commit a set, and a short tone when the rest timer reaches
            zero. Browser support varies; both are best-effort and silently
            no-op on devices that don&apos;t expose the underlying APIs.
          </p>
          <FeedbackAutoSave
            initialHaptics={profile?.haptics_enabled !== false}
            initialTimerSound={profile?.timer_sound_enabled !== false}
          />
        </div>

        {/* Daily recovery check-in */}
        <div className="space-y-3" data-testid="settings-recovery-card">
          <p className="text-xs text-foreground/60">
            A 2-tap fatigue + soreness logger on the Today page. Bias the
            engine&apos;s recovery model. Toggle off to hide the card entirely
            — your existing logs stay put, and you can turn it back on at any
            time.
          </p>
          <RecoveryCheckinAutoSave
            initialShow={profile?.show_today_recovery_card !== false}
          />
        </div>

        {/* Warmups — deeper editor lives on its own route */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            Auto-generated warmup ladder before each main lift. Pick a preset
            or dial in a custom percent/rep ramp.
          </p>
          <Link
            href="/app/settings/training"
            data-testid="settings-warmups-link"
            className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
          >
            <span className="text-sm">Configure warmups</span>
            <span className="text-xs text-foreground/60">→</span>
          </Link>
        </div>

        {/* Connections */}
        <div className="space-y-3">
          <p className="text-xs text-foreground/60">
            Import cardio activities so region freshness reflects all your
            training, not just lifts.
          </p>
          <Link
            href="/app/settings/strava"
            className="inline-flex items-center justify-between gap-3 rounded-lg border border-foreground/10 p-4 w-full hover:bg-foreground/5"
          >
            <span className="text-sm">Strava</span>
            <span className="text-xs text-foreground/60">→</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
