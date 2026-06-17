import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  connectStrava,
  disconnectStrava,
  syncStravaNow,
  importStravaHistoryAction,
} from "@/lib/integrations/strava/actions";
import { StravaPoweredBadge } from "@/components/StravaPoweredBadge";
import { ImportHistorySection } from "@/components/settings/StravaImportHistory";
import {
  StravaConnectionActions,
  StravaConnectButton,
} from "@/components/settings/StravaConnectionActions";
import { PageHeader } from "@/components/ui/PageHeader";

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

/**
 * Translate raw Strava OAuth scope tokens (e.g. "activity:read read")
 * into a single plain-language line. The raw value is preserved in a
 * tooltip for anyone who wants it.
 */
function describeScopes(scopes: string | null): string {
  if (!scopes) return "Activity access";
  const tokens = scopes.split(/[\s,]+/).filter(Boolean);
  if (tokens.includes("activity:read_all")) {
    return "Reads your activities, including private ones";
  }
  if (tokens.includes("activity:read")) {
    return "Reads your activities";
  }
  return "Basic profile access";
}

export default async function StravaSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const { data: connection } = await supabase
    .from("strava_connections")
    .select("athlete_id, connected_at, last_synced_at, last_sync_error, scopes")
    .eq("user_id", user.id)
    .maybeSingle();

  const isConfigured =
    Boolean(process.env.STRAVA_CLIENT_ID) &&
    Boolean(process.env.STRAVA_CLIENT_SECRET) &&
    Boolean(process.env.STRAVA_REDIRECT_URI);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app/settings/integrations", label: "Integrations" }}
        title="Strava"
        subtitle="Pull your runs, rides, swims, and other cardio into the training ledger so region freshness reflects all your work, not just lifts."
        actions={<StravaPoweredBadge />}
      />

      {params.strava_connected === "1" && (
        <div
          role="status"
          className="cp-card"
          style={{
            padding: "10px 14px",
            background: "color-mix(in oklab, var(--cp-success) 12%, transparent)",
            borderColor: "var(--cp-success)",
            fontSize: 13,
          }}
        >
          Strava connected. Initial sync complete.
        </div>
      )}
      {params.strava_error && (
        <div
          role="alert"
          className="cp-card"
          style={{
            padding: "10px 14px",
            background: "color-mix(in oklab, var(--cp-danger) 12%, transparent)",
            borderColor: "var(--cp-danger)",
            fontSize: 13,
          }}
        >
          Connection failed: {params.strava_error}
        </div>
      )}

      {!isConfigured && (
        <div
          role="note"
          className="cp-card"
          data-testid="strava-not-configured"
          style={{
            padding: "12px 16px",
            background: "var(--cp-surface-soft, rgba(0,0,0,0.03))",
            borderColor: "var(--cp-border)",
            fontSize: 13,
            color: "var(--cp-text-muted)",
          }}
        >
          {/*
            Developer note (kept out of user copy): to enable Strava sync,
            set the STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and
            STRAVA_REDIRECT_URI environment variables. Create an app at
            https://www.strava.com/settings/api and register the callback
            /api/strava/callback.
          */}
          Strava sync isn&apos;t available in this environment. Cardio
          activities can still be logged manually from the Plan page.
        </div>
      )}

      {connection ? (
        <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Connected</h2>
            <a
              href={`https://www.strava.com/athletes/${connection.athlete_id}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
            >
              View on Strava ↗
            </a>
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", fontSize: 13 }}>
            <dt style={{ color: "var(--cp-text-muted)" }}>Last sync</dt>
            <dd style={{ margin: 0 }}>{formatTimeAgo(connection.last_synced_at)}</dd>
            <dt style={{ color: "var(--cp-text-muted)" }}>Access</dt>
            <dd style={{ margin: 0 }} title={connection.scopes ?? undefined}>
              {describeScopes(connection.scopes)}
            </dd>
          </dl>
          {connection.last_sync_error && (
            <div
              role="alert"
              style={{
                padding: "8px 12px",
                borderRadius: 10,
                background: "color-mix(in oklab, var(--cp-danger) 10%, transparent)",
                border: "1px solid var(--cp-danger)",
                fontSize: 12,
              }}
            >
              Last sync error: {connection.last_sync_error}
            </div>
          )}
          <StravaConnectionActions
            syncAction={syncStravaNow}
            disconnectAction={disconnectStrava}
          />
          <p style={{ fontSize: 12, color: "var(--cp-text-muted)", margin: 0 }}>
            Each sync pulls your last 30 days of activity. Strength workouts
            (logged as WeightTraining, Crossfit, or Workout in Strava) are left
            out — you log those right here in your plan.
          </p>
        </section>
      ) : (
        <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Not connected</h2>
          <p style={{ fontSize: 14, color: "var(--cp-text-muted)", margin: 0 }}>
            One-click connect via Strava OAuth. We&apos;ll ask for read access
            to your activities and pull the last 30 days on first sync.
          </p>
          <StravaConnectButton
            connectAction={connectStrava}
            disabled={!isConfigured}
          />
        </section>
      )}

      {connection && (
        <ImportHistorySection action={importStravaHistoryAction} />
      )}
    </div>
  );
}
