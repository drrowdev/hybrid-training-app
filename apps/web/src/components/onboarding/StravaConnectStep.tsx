"use client";

/**
 * Onboarding · Connect Strava step (optional).
 *
 * Placement: second-to-last, immediately before Confirm. By this point
 * the user has set up profile / equipment / TMs / first block — the
 * Strava connect feels like a value-add ("we can sync your runs
 * automatically") rather than a barrier. Earlier placement risks
 * dropoff for users who don't have their Strava credentials handy.
 *
 * Three rendered states (in order of progression):
 *
 *   1. NOT CONNECTED — primary "Connect Strava" button + "Skip for now"
 *      ghost link. The connect button submits a form to the existing
 *      `connectStrava` server action with `returnTo=onboarding` so the
 *      OAuth callback bounces the user back here instead of /settings.
 *
 *   2. CONNECTED, NO IMPORT — "Import your past 90 days?" form. Fixed
 *      90-day window (no picker — onboarding speed > flexibility; the
 *      Settings page already exposes the full range UI). Auto-link is
 *      always on during onboarding (per PR #211 spec). Importing fires
 *      the same `importStravaHistoryAction` the Settings page uses.
 *
 *   3. IMPORT DONE — reuses `ImportSummaryView` from the Settings page
 *      to render imported/skipped/matched breakdown. "Skip import"
 *      collapses the import form to the same Continue posture without
 *      summary content.
 *
 * The component is dumb about wizard-level transitions — it surfaces
 * `done` to the parent through `onComplete`, which the wizard can use
 * to gate the visible Continue button styling (the step is always
 * advanceable regardless).
 */
import { useState, useTransition } from "react";
import type { ImportSummary } from "@/lib/integrations/strava/import-history";
import { ImportSummaryView } from "@/components/settings/StravaImportHistory";

const ONBOARDING_IMPORT_DAYS = 90;

type ImportAction = (input: {
  startDate: string;
  endDate?: string;
  autoLinkToPlanned?: boolean;
}) => Promise<
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }
>;

export type StravaConnectStepProps = {
  /** Whether the user already has a Strava connection (either from a
   *  prior session or from completing OAuth in this onboarding flow). */
  connected: boolean;
  /** Server action that begins the OAuth flow. Accepts FormData so the
   *  step can pass `returnTo=onboarding` and resume here after the
   *  Strava round-trip. */
  connectAction: (fd: FormData) => Promise<void>;
  /** Same action the Settings page uses for historical backfill. */
  importAction: ImportAction;
  /** Whether the OAuth flow is configured in this environment (env
   *  vars present). When false, the connect button is disabled and an
   *  inline note is shown — the user can still Skip and continue. */
  isConfigured: boolean;
  /** Stable kicker label shown above the heading — keeps the
   *  numbering consistent with the rest of the wizard. */
  kicker: string;
};

type ImportState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "done"; summary: ImportSummary }
  | { phase: "skipped" }
  | { phase: "error"; message: string };

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function StravaConnectStep({
  connected,
  connectAction,
  importAction,
  isConfigured,
  kicker,
}: StravaConnectStepProps) {
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });
  const [pending, startTransition] = useTransition();

  if (!connected) {
    return (
      <section
        data-testid="onboarding-strava-step"
        data-state="not-connected"
        style={{ display: "grid", gap: 16 }}
      >
        <div>
          <div style={kickerStyle}>{kicker}</div>
          <h2 style={headingStyle}>Connect Strava (optional)</h2>
        </div>
        <p style={bodyStyle}>
          Sync your runs, rides, and other cardio activities automatically.
          We&apos;ll match them to your planned workouts and update your
          training history.
        </p>

        {!isConfigured && (
          <div
            role="note"
            data-testid="onboarding-strava-not-configured"
            style={noteStyle}
          >
            Strava sync isn&apos;t available in this environment yet — you
            can connect later from Settings.
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <form action={connectAction}>
            <input type="hidden" name="returnTo" value="onboarding" />
            <button
              type="submit"
              className="cp-btn primary"
              disabled={!isConfigured}
              data-testid="onboarding-strava-connect-button"
            >
              Connect Strava
            </button>
          </form>
          {/* "Skip for now" is purely a styling cue — the wizard's
              Continue button advances the step regardless. We expose
              it here as a ghost link so the user has an obvious
              "no thanks" affordance next to the primary CTA. */}
          <span
            data-testid="onboarding-strava-skip-hint"
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            Or hit <strong>Continue →</strong> to skip for now.
          </span>
        </div>
      </section>
    );
  }

  // Connected branch ────────────────────────────────────────────────────

  if (importState.phase === "done") {
    return (
      <section
        data-testid="onboarding-strava-step"
        data-state="import-done"
        style={{ display: "grid", gap: 16 }}
      >
        <div>
          <div style={kickerStyle}>{kicker}</div>
          <h2 style={headingStyle}>Strava connected</h2>
        </div>
        <p style={bodyStyle}>
          Your activities are in. Hit <strong>Continue →</strong> to wrap up
          onboarding.
        </p>
        <ImportSummaryView summary={importState.summary} />
      </section>
    );
  }

  if (importState.phase === "skipped") {
    return (
      <section
        data-testid="onboarding-strava-step"
        data-state="import-skipped"
        style={{ display: "grid", gap: 16 }}
      >
        <div>
          <div style={kickerStyle}>{kicker}</div>
          <h2 style={headingStyle}>Strava connected</h2>
        </div>
        <p style={bodyStyle}>
          We&apos;ll keep syncing new activities going forward. You can
          backfill any time from <strong>Settings → Strava</strong>.
        </p>
      </section>
    );
  }

  const startImport = () => {
    setImportState({ phase: "running" });
    startTransition(async () => {
      const result = await importAction({
        startDate: daysAgoIso(ONBOARDING_IMPORT_DAYS),
        autoLinkToPlanned: true,
      });
      if (result.ok) {
        setImportState({ phase: "done", summary: result.summary });
      } else {
        setImportState({ phase: "error", message: result.error });
      }
    });
  };

  return (
    <section
      data-testid="onboarding-strava-step"
      data-state="connected"
      style={{ display: "grid", gap: 16 }}
    >
      <div>
        <div style={kickerStyle}>{kicker}</div>
        <h2 style={headingStyle}>Import your past 90 days?</h2>
      </div>
      <p style={bodyStyle}>
        We&apos;ll pull your recent activities so your training history
        starts with real data. You can adjust the date range anytime in
        Settings.
      </p>

      {importState.phase === "error" && (
        <div role="alert" style={errorBoxStyle}>
          Import failed: {importState.message}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={startImport}
          disabled={pending || importState.phase === "running"}
          aria-busy={importState.phase === "running"}
          className="cp-btn primary"
          data-testid="onboarding-strava-import-button"
        >
          {importState.phase === "running" ? "Importing…" : "Import"}
        </button>
        <button
          type="button"
          onClick={() => setImportState({ phase: "skipped" })}
          disabled={pending || importState.phase === "running"}
          className="cp-btn ghost"
          data-testid="onboarding-strava-skip-import-button"
          style={{ fontSize: 13 }}
        >
          Skip import
        </button>
        {importState.phase === "running" && (
          <span
            role="status"
            style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
          >
            Pulling the last {ONBOARDING_IMPORT_DAYS} days from Strava…
          </span>
        )}
      </div>
    </section>
  );
}

// ── styles ──────────────────────────────────────────────────────────────

const kickerStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const headingStyle: React.CSSProperties = {
  fontSize: 22,
  margin: "4px 0 0",
  letterSpacing: "-0.01em",
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: "var(--cp-text-muted)",
  lineHeight: 1.55,
};

const noteStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface-soft, rgba(0,0,0,0.03))",
  color: "var(--cp-text-muted)",
  fontSize: 12,
  lineHeight: 1.5,
};

const errorBoxStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text)",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--cp-warning, #d97706)",
  background: "color-mix(in oklab, var(--cp-warning, #d97706) 8%, transparent)",
};
