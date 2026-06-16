import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient, getAuthUser } from "@/lib/supabase/server";
import { DateTimeFormatCard } from "@/components/settings/DateTimeFormatCard";
import {
  FeedbackAutoSave,
  SupersetAutoSave,
  UnitsAutoSave,
} from "@/components/settings/SettingsAutoSaveSections";
import {
  isDateFormat,
  isTimeFormat,
  resolveDateFormat,
  resolveTimeFormat,
} from "@/lib/format/datetime";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function PreferencesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "haptics_enabled, timer_sound_enabled, superset_accessories, time_format, date_format, timezone, units",
    )
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/app/settings", label: "Settings" }}
        title="Preferences"
        subtitle="How the app behaves during sessions and how it stays in sync."
      />

      <div className="space-y-6">
        {/* Units */}
        <div className="space-y-3" data-testid="settings-units">
          <p className="text-xs text-foreground/60">
            Whether weights and distances show in kilograms / kilometres or
            pounds / miles. Everything is stored in metric and converted for
            display — switching never changes your logged numbers.
          </p>
          <UnitsAutoSave
            initialUnits={profile?.units === "imperial" ? "imperial" : "metric"}
          />
        </div>

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

        {/* Training style — antagonist supersets */}
        <div className="space-y-3" data-testid="settings-superset">
          <p className="text-xs text-foreground/60">
            How accessory work is sequenced inside a session. Off by default —
            accessories run one at a time. Turning supersets on never changes
            which exercises or how many sets you get; it only pairs opposites so
            you wait through one rest instead of two.
          </p>
          <SupersetAutoSave
            initialSuperset={profile?.superset_accessories === true}
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
            <span className="text-sm">Warmups</span>
            <span className="text-xs text-foreground/60">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
