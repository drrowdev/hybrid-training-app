import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  connectStrava,
  disconnectStrava,
  syncStravaNow,
} from "@/lib/integrations/strava/actions";
import { StravaPoweredBadge } from "@/components/StravaPoweredBadge";

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
    <main className="min-h-screen px-6 py-12 max-w-2xl mx-auto space-y-6">
      <header className="space-y-1">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Strava</h1>
          <StravaPoweredBadge />
        </div>
        <p style={{ color: "var(--cp-text-muted)", margin: 0, fontSize: 14 }}>
          Pull your runs, rides, swims, and other cardio into the training
          ledger so region freshness reflects all your work, not just lifts.
        </p>
      </header>

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
            <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              athlete #{connection.athlete_id}
            </span>
          </div>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", fontSize: 13 }}>
            <dt style={{ color: "var(--cp-text-muted)" }}>Last sync</dt>
            <dd style={{ margin: 0 }}>{formatTimeAgo(connection.last_synced_at)}</dd>
            <dt style={{ color: "var(--cp-text-muted)" }}>Scopes</dt>
            <dd style={{ margin: 0 }} className="mono">
              {connection.scopes}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <form action={syncStravaNow}>
              <button type="submit" className="cp-btn primary">
                Sync now
              </button>
            </form>
            <form action={disconnectStrava}>
              <button type="submit" className="cp-btn">
                Disconnect
              </button>
            </form>
          </div>
          <p style={{ fontSize: 12, color: "var(--cp-text-muted)", margin: 0 }}>
            Sync pulls the last 30 days of activities. Strength-style entries
            (WeightTraining, Crossfit, Workout) are skipped — we log those
            here directly.
          </p>
        </section>
      ) : (
        <section className="cp-card" style={{ padding: 20, display: "grid", gap: 12 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Not connected</h2>
          <p style={{ fontSize: 14, color: "var(--cp-text-muted)", margin: 0 }}>
            One-click connect via Strava OAuth. We&apos;ll ask for read access
            to your activities and pull the last 30 days on first sync.
          </p>
          <form action={connectStrava}>
            <button type="submit" className="cp-btn primary" disabled={!isConfigured}>
              Connect Strava
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
