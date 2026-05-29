/**
 * /app/profile — Training Profile page.
 *
 * "Who am I as a trainee" — centralises identity, body comp, declared
 * experience + inferred tier, recent movement focus, training notes
 * (left column) plus preferences, TM summary, and an active-limitation
 * summary (right rail).
 *
 * Server component: fetches everything in parallel, hands plain
 * serialisable shapes down to the inline-edit client components.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { getActiveBlock, archetypeDisplayName, getUserTimezone } from "@/lib/planner/queries";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";
import { todayYmd } from "@/lib/dates";
import { getUserTier } from "@/lib/stats/engine";
import { EmptyState } from "@/components/ui/EmptyState";
import { MetricHelp } from "@/components/ui/MetricHelp";
import { TrainingMaxesCard } from "@/components/today/TrainingMaxesCard";
import { DisplayNameEditor } from "@/components/profile/DisplayNameEditor";
import { AiNotesEditor } from "@/components/profile/AiNotesEditor";
import { BodyweightLogger } from "@/components/profile/BodyweightLogger";
import { BodyweightSparkline } from "@/components/profile/BodyweightSparkline";
import { PreferencesEditor } from "@/components/profile/PreferencesEditor";
import {
  updateAiNotes,
  updateDisplayName,
  updatePreferences,
} from "@/lib/profile/actions";
import { markAuditRead } from "@/lib/profile/actions";
import { QuickSearchRow } from "@/components/profile/QuickSearchRow";
import { ProfileNotifications } from "@/components/profile/ProfileNotifications";
import type { TopBarAuditEntry } from "@/components/shell/TopBarRight";
import {
  getActiveLimitations,
  getBodyweight90d,
  getMovementFocus,
  getPendingTmSuggestionCount,
  memberSincePhrase,
  shortRelative,
  type LimitationSummaryRow,
} from "@/lib/profile/queries";

export const dynamic = "force-dynamic";

const EXPERIENCE_LABEL: Record<string, string> = {
  beginner_lt_6m: "Beginner",
  novice_6m_2y: "Novice",
  intermediate_2y_5y: "Intermediate",
  advanced_5y_10y: "Advanced",
  highly_advanced_10y_plus: "Highly advanced",
};

const SEVERITY_LABEL: Record<LimitationSummaryRow["severity"], string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

function initialsFrom(name: string | null, email: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  if (source.includes("@")) {
    const local = source.split("@")[0] ?? "";
    const letters = local.replace(/[^a-z0-9]/gi, "");
    return (letters.slice(0, 2) || local.slice(0, 2) || "?").toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[parts.length - 1]![0] ?? "")).toUpperCase();
}

function formatKg(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, "");
}

function activeBlockWeek(startedOn: string, now: Date = new Date()): number {
  const start = new Date(startedOn + "T00:00:00Z").getTime();
  const days = Math.floor((now.getTime() - start) / 86_400_000);
  return Math.max(1, Math.floor(days / 7) + 1);
}

function relativeDate(iso: string, now: Date = new Date()): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const days = Math.max(0, Math.floor((now.getTime() - ts) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export default async function TrainingProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const userId = user.id;
  const email = user.email ?? null;
  const memberSinceIso = user.created_at ?? null;

  const [
    { data: profile },
    activeBlock,
    bodyweight,
    movementFocus,
    tierState,
    limitations,
    pendingTmCount,
    tmRows,
    tz,
    auditRes,
    auditCountRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "display_name, timezone, units, am_window_start, pm_window_start, training_experience, ai_notes, updated_at, audit_last_read_at",
      )
      .eq("id", userId)
      .maybeSingle(),
    getActiveBlock(),
    getBodyweight90d(supabase, userId),
    getMovementFocus(supabase, userId),
    getUserTier(supabase, userId),
    getActiveLimitations(supabase, userId),
    getPendingTmSuggestionCount(supabase, userId),
    listTrainingMaxes(),
    getUserTimezone(userId),
    supabase
      .from("engine_override_events")
      .select("id, event_type, occurred_at, planned_session_id, reason")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(5),
    supabase
      .from("engine_override_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const auditLastReadAt = (profile?.audit_last_read_at as string | null) ?? null;
  const recentAudit: TopBarAuditEntry[] = (auditRes.data ?? []).map((row) => ({
    id: row.id as string,
    eventType: row.event_type as string,
    occurredAt: row.occurred_at as string,
    plannedSessionId: (row.planned_session_id as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
  }));
  const unreadAuditCount = auditLastReadAt
    ? recentAudit.filter((e) => e.occurredAt > auditLastReadAt).length
    : auditCountRes.count ?? recentAudit.length;

  const displayName = (profile?.display_name as string | null) ?? "";
  const timezone = (profile?.timezone as string | null) ?? tz ?? "UTC";
  const units: "metric" | "imperial" =
    (profile?.units as "metric" | "imperial" | null) ?? "metric";
  const amWindowStart = ((profile?.am_window_start as string | null) ?? "07:00").slice(0, 5);
  const pmWindowStart = ((profile?.pm_window_start as string | null) ?? "17:00").slice(0, 5);
  const trainingExperience = (profile?.training_experience as string | null) ?? null;
  const aiNotes = (profile?.ai_notes as string | null) ?? "";
  const aiNotesUpdatedAt = (profile?.updated_at as string | null) ?? null;

  const initials = initialsFrom(displayName, email);
  const memberSince = memberSinceIso ? memberSincePhrase(memberSinceIso) : null;
  const activeWeek = activeBlock ? activeBlockWeek(activeBlock.startedOn) : null;
  const tdy = todayYmd(timezone);

  return (
    <main
      data-testid="training-profile-page"
      style={{
        display: "grid",
        gap: 24,
        gridTemplateColumns: "minmax(0, 1fr)",
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      <div className="cp-profile-grid">
        {/* ────────── LEFT COLUMN ────────── */}
        <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
          {/* 0. Mobile-only: Notifications + Quick search.
                Hidden on desktop where the top-bar already surfaces both. */}
          <div className="cp-mobile-only">
            <div style={{ display: "grid", gap: 12 }}>
              <ProfileNotifications
                recentAudit={recentAudit}
                unreadCount={unreadAuditCount}
                markAuditReadAction={markAuditRead}
              />
              <QuickSearchRow />
            </div>
          </div>

          {/* 1. Identity header */}
          <section
            data-testid="profile-identity"
            className="cp-card"
            style={{
              padding: 20,
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 16,
              alignItems: "center",
            }}
          >
            <div
              data-testid="profile-avatar"
              aria-hidden
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "var(--cp-accent-soft)",
                color: "var(--cp-accent)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 22,
                letterSpacing: "0.02em",
                border: "1px solid var(--cp-border)",
              }}
            >
              {initials}
            </div>
            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
              <DisplayNameEditor
                initialName={displayName}
                email={email}
                action={updateDisplayName}
              />
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginTop: 4,
                }}
              >
                {memberSince && (
                  <Chip data-testid="profile-member-since">{memberSince}</Chip>
                )}
                {activeBlock && activeWeek != null && (
                  <Chip data-testid="profile-active-block">
                    {archetypeDisplayName(activeBlock.archetype, activeBlock.notes)}
                    {" · "}
                    Wk {activeWeek} of {activeBlock.weeks}
                  </Chip>
                )}
              </div>
            </div>
          </section>

          {/* 2. Bodyweight */}
          <section
            data-testid="profile-bodyweight"
            className="cp-card"
            style={{ padding: 20, display: "grid", gap: 12 }}
          >
            <SectionHeader title="Bodyweight" termId="rolling_mean" />
            {bodyweight.points.length === 0 ? (
              <EmptyState
                variant="card"
                title="No bodyweight logged"
                body="Tap Log bodyweight to start your trend. Once you have a few entries we'll show a 90-day sparkline."
                action={{ label: "Log bodyweight", href: "/app" }}
              />
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    gap: 12,
                  }}
                >
                  <span
                    data-testid="bodyweight-current"
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--cp-text)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {bodyweight.current
                      ? `${formatKg(bodyweight.current.kg)} kg`
                      : "—"}
                  </span>
                  {bodyweight.deltaKg30d != null && (
                    <span
                      data-testid="bodyweight-delta"
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: "var(--cp-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {bodyweight.deltaKg30d === 0
                        ? "· flat over 30 days"
                        : `· ${bodyweight.deltaKg30d > 0 ? "↑" : "↓"} ${formatKg(
                            Math.abs(bodyweight.deltaKg30d),
                          )} kg in 30 days`}
                    </span>
                  )}
                </div>
                {bodyweight.points.length >= 2 && (
                  <BodyweightSparkline points={bodyweight.points} />
                )}
                {bodyweight.current && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--cp-text-muted)",
                    }}
                  >
                    Last logged{" "}
                    <span data-testid="bodyweight-last-date">
                      {relativeDate(bodyweight.current.date)}
                    </span>
                    .
                  </div>
                )}
                <BodyweightLogger
                  todayYmd={tdy}
                  placeholderKg={bodyweight.current?.kg ?? null}
                />
              </>
            )}
          </section>

          {/* 3. Experience & tier */}
          <section
            data-testid="profile-experience"
            className="cp-card"
            style={{ padding: 20, display: "grid", gap: 12 }}
          >
            <SectionHeader title="Experience & tier" />
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Chip data-testid="experience-declared">
                {trainingExperience
                  ? EXPERIENCE_LABEL[trainingExperience] ?? trainingExperience
                  : "Experience not declared"}
              </Chip>
              <span
                data-testid="experience-tier"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--cp-border)",
                  background: "var(--cp-accent-soft, var(--cp-surface-soft))",
                  color: "var(--cp-accent, var(--cp-text))",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Tier: {tierState.tierLabel}
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: "var(--cp-text-muted)",
                    marginLeft: 4,
                  }}
                >
                  · {tierState.confidence}
                </span>
                <MetricHelp term="bts_tier" />
              </span>
              <Link
                href="/app/settings"
                data-testid="experience-change-link"
                style={{
                  fontSize: 12,
                  color: "var(--cp-link, var(--cp-accent))",
                  textDecoration: "none",
                  fontWeight: 500,
                }}
              >
                Change experience →
              </Link>
            </div>
            {tierState.contributors.length > 0 && (
              <details data-testid="tier-contributors">
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--cp-text-muted)",
                    fontWeight: 500,
                  }}
                >
                  Show contributors ({tierState.contributors.length})
                </summary>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "10px 0 0",
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {tierState.contributors.map((c) => (
                    <li
                      key={c.name}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 8,
                        padding: "6px 0",
                        fontSize: 12,
                        borderBottom: "1px solid var(--cp-border)",
                      }}
                    >
                      <span style={{ color: "var(--cp-text)" }}>{c.name}</span>
                      <span
                        className="mono"
                        style={{
                          color: "var(--cp-text-muted)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        w={c.weight.toFixed(2)} · score={c.contribution.toFixed(2)}
                        {" → "}
                        {c.pointsToward}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>

          {/* 4. Movement focus */}
          <section
            data-testid="profile-movement-focus"
            className="cp-card"
            style={{ padding: 20, display: "grid", gap: 12 }}
          >
            <SectionHeader title="Movement focus" subtitle="Top 6 over the last 12 weeks" />
            {movementFocus.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No logged sets yet"
                body="Once you log a few sessions we'll surface the movements you've leaned on most."
                action={{ label: "Log a session →", href: "/app/log" }}
              />
            ) : (
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  display: "grid",
                  gap: 6,
                }}
              >
                {movementFocus.map((m) => (
                  <li key={m.movementId}>
                    <Link
                      href={`/app/stats/movements/${m.movementSlug}`}
                      data-testid="movement-focus-row"
                      data-slug={m.movementSlug}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--cp-border)",
                        background: "var(--cp-surface-soft, var(--cp-surface))",
                        textDecoration: "none",
                        color: "var(--cp-text)",
                      }}
                    >
                      <span style={{ display: "grid", gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>
                          {m.movementName}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--cp-text-muted)",
                          }}
                        >
                          Last loaded {relativeDate(m.lastPerformedAt)}
                        </span>
                      </span>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "var(--cp-surface)",
                          border: "1px solid var(--cp-border)",
                          color: "var(--cp-text-muted)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {m.sessionCount} session{m.sessionCount === 1 ? "" : "s"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 5. AI notes */}
          <section
            data-testid="profile-ai-notes"
            className="cp-card"
            style={{ padding: 20, display: "grid", gap: 12 }}
          >
            <SectionHeader title="Training notes" termId="ai_notes" />
            <AiNotesEditor
              initialValue={aiNotes}
              action={updateAiNotes}
              lastUpdatedLabel={
                aiNotes && aiNotesUpdatedAt
                  ? `Last updated ${shortRelative(aiNotesUpdatedAt)}`
                  : null
              }
            />
          </section>
        </div>

        {/* ────────── RIGHT RAIL ────────── */}
        <aside
          style={{ display: "grid", gap: 20, minWidth: 0 }}
          aria-label="Profile preferences and summaries"
        >
          {/* 6. Preferences */}
          <section
            data-testid="profile-preferences"
            className="cp-card"
            style={{ padding: 18, display: "grid", gap: 14 }}
          >
            <SectionHeader title="Preferences" />
            <PreferencesEditor
              amWindowStart={amWindowStart}
              pmWindowStart={pmWindowStart}
              units={units}
              action={updatePreferences}
            />
            <hr style={{ border: 0, borderTop: "1px solid var(--cp-border)" }} />
            <div style={{ display: "grid", gap: 8, fontSize: 12 }}>
              <RailKv
                label="Timezone"
                value={
                  <span className="mono" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {timezone}
                  </span>
                }
                hint={
                  <Link
                    href="/app/settings"
                    style={{
                      fontSize: 11,
                      color: "var(--cp-link, var(--cp-accent))",
                      textDecoration: "none",
                    }}
                  >
                    Change
                  </Link>
                }
              />
              <RailKv
                label="Language"
                value="English"
                hint={
                  <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                    System
                  </span>
                }
              />
            </div>
          </section>

          {/* 7. Training maxes summary */}
          <section data-testid="profile-tm-summary" style={{ display: "grid", gap: 10 }}>
            {pendingTmCount > 0 && (
              <Link
                href="/app"
                data-testid="profile-tm-suggestion-banner"
                style={{
                  display: "block",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--cp-accent, var(--cp-border))",
                  background: "var(--cp-accent-soft, var(--cp-surface-soft))",
                  color: "var(--cp-accent, var(--cp-text))",
                  fontSize: 12,
                  fontWeight: 600,
                  textDecoration: "none",
                }}
              >
                {pendingTmCount} new TM suggested — review on Today →
              </Link>
            )}
            <TrainingMaxesCard rows={tmRows} />
            <Link
              href="/app/settings"
              data-testid="profile-tm-manage-link"
              style={{
                fontSize: 12,
                color: "var(--cp-link, var(--cp-accent))",
                textDecoration: "none",
                fontWeight: 500,
                alignSelf: "end",
              }}
            >
              Manage TMs →
            </Link>
          </section>

          {/* 8. Active limitations summary */}
          <section
            data-testid="profile-limitations"
            className="cp-card"
            style={{ padding: 18, display: "grid", gap: 10 }}
          >
            <SectionHeader title="Active limitations" />
            {limitations.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No active limitations"
                body="Recording limitations lets the engine cap or rotate around an affected muscle."
                action={{ label: "Manage →", href: "/app/recovery/injuries" }}
              />
            ) : (
              <>
                <ul
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  {limitations.map((l) => (
                    <li
                      key={l.id}
                      data-testid="profile-limitation-row"
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--cp-border)",
                        background: "var(--cp-surface-soft, var(--cp-surface))",
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "var(--cp-text)" }}>
                        {l.kind ?? "Unspecified"}
                      </span>
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--cp-text-muted)",
                          fontWeight: 500,
                        }}
                      >
                        {SEVERITY_LABEL[l.severity]}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/app/recovery/injuries"
                  data-testid="profile-limitations-manage-link"
                  style={{
                    fontSize: 12,
                    color: "var(--cp-link, var(--cp-accent))",
                    textDecoration: "none",
                    fontWeight: 500,
                  }}
                >
                  Manage →
                </Link>
              </>
            )}
          </section>
        </aside>
      </div>

      {/* Single-column on narrow viewports. */}
      <style>{`
        .cp-profile-grid {
          display: grid;
          gap: 24px;
          grid-template-columns: minmax(0, 1fr);
          align-items: start;
        }
        @media (min-width: 1100px) {
          .cp-profile-grid {
            grid-template-columns: minmax(0, 1fr) 340px;
          }
        }
      `}</style>
    </main>
  );
}

function Chip({
  children,
  style,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...rest}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 999,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface-soft)",
        color: "var(--cp-text-muted)",
        fontSize: 12,
        fontWeight: 500,
        ...(style ?? {}),
      }}
    >
      {children}
    </span>
  );
}

function SectionHeader({
  title,
  subtitle,
  termId,
}: {
  title: string;
  subtitle?: string;
  termId?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 8,
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 14,
          fontWeight: 700,
          color: "var(--cp-text)",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {title}
        {termId && <MetricHelp term={termId} />}
      </h2>
      {subtitle && (
        <span
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
          }}
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}

function RailKv({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ color: "var(--cp-text-muted)", fontWeight: 500 }}>
        {label}
      </span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          color: "var(--cp-text)",
        }}
      >
        {value}
        {hint}
      </span>
    </div>
  );
}
