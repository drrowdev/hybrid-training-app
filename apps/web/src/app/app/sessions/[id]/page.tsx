import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AddCardioBlockForm } from "@/components/add-log-forms";
import {
  addCardioBlock,
  addStrengthSet,
  deleteCardio,
} from "@/lib/sessions/actions";
import { getTrainingMaxDict } from "@/lib/training-maxes/queries";
import {
  SessionLogClient,
  type LoggedSet,
} from "@/components/session/SessionLogClient";
import { GRM_RECOMMEND_THRESHOLD, applyGrmToPercent, computeGrm, grmLabel } from "@/lib/engine/grm";
import { PR_KIND_LABEL } from "@/lib/engine/pr";
import { acceptTmBump, declineTmBump } from "@/lib/engine/tm-bump-actions";
import { formatHitValue, getSessionPrs } from "@/lib/stats/pr-queries";
import { findBumpProposalForSession } from "@/lib/stats/bump-proposal";
import type { Prescription } from "@hta/db";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await supabase
    .from("sessions")
    .select(
      "id, performed_at, title, fatigue, soreness, session_rpe, duration_min, notes, completed_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  const { data: setsRaw } = await supabase
    .from("set_logs")
    .select(
      "id, set_index, set_kind, weight_kg, reps, duration_sec, distance_m, rpe, notes, movement:movements(id, slug, display_name, primary_region)",
    )
    .eq("session_id", id)
    .order("set_index", { ascending: true });

  const { data: cardio } = await supabase
    .from("cardio_logs")
    .select(
      "id, block_index, modality, duration_sec, distance_km, avg_hr_bpm, rpe, notes, movement:movements(id, display_name)",
    )
    .eq("session_id", id)
    .order("block_index", { ascending: true });

  const sets: LoggedSet[] = (setsRaw ?? []).map((s) => {
    const m = Array.isArray(s.movement) ? s.movement[0] : s.movement;
    return {
      id: s.id,
      set_index: s.set_index,
      set_kind: s.set_kind,
      weight_kg: s.weight_kg,
      reps: s.reps,
      duration_sec: s.duration_sec,
      distance_m: s.distance_m,
      rpe: s.rpe,
      movement: m ?? {
        id: "",
        slug: "",
        display_name: "Unknown movement",
        primary_region: "",
      },
    };
  });

  const tmDict = await getTrainingMaxDict();
  const tmBySlug: Record<string, number> = Object.fromEntries(tmDict.bySlug);

  const isComplete = !!session.completed_at;

  // Pull the linked planned_session so we can build a contextual GRM
  // recommendation ("top set ~81% instead of 90%").
  const { data: planned } = await supabase
    .from("planned_sessions")
    .select("id, prescription")
    .eq("completed_session_id", id)
    .maybeSingle();
  const plannedPrescription = (planned?.prescription as Prescription | null) ?? null;
  const plannedTopPercent = plannedPrescription?.items
    .filter((i) => i.kind === "main" && typeof i.percentTm === "number")
    .reduce((max, i) => Math.max(max, i.percentTm ?? 0), 0);
  const grm = computeGrm({ fatigue: session.fatigue, soreness: session.soreness });
  const showRecommendation =
    grm.hasCheckIn && grm.value < GRM_RECOMMEND_THRESHOLD && !isComplete;

  // PR detection — only meaningful when at least one set has been logged.
  const prSummaries = sets.length > 0
    ? await getSessionPrs(supabase, user.id, id, session.performed_at)
    : [];

  // TM-bump proposal — runs the AMRAP confidence gate. Returns null when
  // there's no planned-session link, no AMRAP, no qualifying set, or the
  // gate suppresses (hard gate or below score threshold).
  const bumpProposal = !isComplete && sets.length > 0
    ? await findBumpProposalForSession(supabase, user.id, id)
    : null;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {new Date(session.performed_at).toLocaleString()}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <h1 style={{ fontSize: 26, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
            {session.title ?? "Session"}
          </h1>
          {isComplete && (
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "color-mix(in oklab, var(--cp-success) 18%, transparent)",
                color: "var(--cp-success)",
                fontWeight: 600,
              }}
            >
              completed
            </span>
          )}
        </div>
      </header>

      {showRecommendation && (
        <section
          role="note"
          className="cp-card"
          style={{
            padding: "12px 16px",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            background: "var(--cp-surface-soft)",
            borderColor: "var(--cp-border)",
          }}
          title="research-v2 §3.4 — Global Recovery Multiplier"
        >
          <div style={{ fontSize: 18, lineHeight: 1, color: "var(--cp-text)" }} aria-hidden="true">
            ⓘ
          </div>
          <div style={{ display: "grid", gap: 4, flex: 1 }}>
            <div style={{ fontSize: 13, color: "var(--cp-text)" }}>
              <strong>Feeling {grmLabel(grm.value)}.</strong>
              <span style={{ color: "var(--cp-text-muted)", marginLeft: 6 }}>
                Recovery multiplier <span className="mono">{grm.value.toFixed(2)}</span>.
                {plannedTopPercent && plannedTopPercent > 0 ? (
                  <>
                    {" "}
                    Top set at{" "}
                    <span className="mono" style={{ color: "var(--cp-text)" }}>
                      ~{applyGrmToPercent(plannedTopPercent, grm.value)}%
                    </span>{" "}
                    instead of {plannedTopPercent}% may be the smarter call today.
                  </>
                ) : (
                  <> Consider pulling back the top-set intensity by ~{Math.round((1 - grm.value) * 100)}%.</>
                )}
              </span>
            </div>
            <div style={{ fontSize: 10, color: "var(--cp-text-muted)", fontStyle: "italic" }}>
              Advisory only — research-v2 §3.4 GRM.
            </div>
          </div>
        </section>
      )}

      {bumpProposal && (
        <section
          className="cp-card"
          style={{
            padding: 18,
            display: "grid",
            gap: 12,
            borderColor: "var(--cp-accent)",
            background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">📈</div>
            <div style={{ display: "grid", gap: 4, flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--cp-accent)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                Bump your TM?
              </div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                {bumpProposal.movementDisplayName} —{" "}
                <span className="mono">{bumpProposal.currentTm.toFixed(1)} kg</span>{" "}
                →{" "}
                <span className="mono" style={{ color: "var(--cp-accent)" }}>
                  {bumpProposal.proposal.newTm} kg
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                Estimated 1RM from today&apos;s top set:{" "}
                <span className="mono">{bumpProposal.proposal.estimatedOneRm.toFixed(1)} kg</span>. New TM
                is 90% of that, rounded to the nearest plate.
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gap: 4, paddingLeft: 34 }}>
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              Why this fired
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 2 }}>
              {bumpProposal.proposal.reasons.map((r, i) => (
                <li key={i} style={{ fontSize: 12, color: "var(--cp-text-muted)", display: "flex", gap: 6 }}>
                  <span style={{ color: r.points >= 0 ? "var(--cp-success)" : "var(--cp-danger)", fontWeight: 600, minWidth: 30 }}>
                    {r.points >= 0 ? `+${r.points}` : r.points}
                  </span>
                  <span>{r.label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div style={{ display: "flex", gap: 8, paddingLeft: 34, flexWrap: "wrap" }}>
            <form action={acceptTmBump}>
              <input type="hidden" name="movementId" value={bumpProposal.movementId} />
              <input type="hidden" name="newTmKg" value={String(bumpProposal.proposal.newTm)} />
              <input type="hidden" name="reason" value="amrap_bump" />
              <input type="hidden" name="triggerKey" value={bumpProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn primary">
                Accept {bumpProposal.proposal.newTm} kg
              </button>
            </form>
            <form action={declineTmBump}>
              <input type="hidden" name="movementId" value={bumpProposal.movementId} />
              <input type="hidden" name="triggerKey" value={bumpProposal.triggerKey} />
              <input type="hidden" name="sessionId" value={id} />
              <button type="submit" className="cp-btn ghost">
                Not now
              </button>
            </form>
          </div>
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <Stat label="Fatigue" value={session.fatigue ? `${session.fatigue}/5` : "—"} />
        <Stat label="Soreness" value={session.soreness ? `${session.soreness}/5` : "—"} />
        <Stat label="sRPE" value={session.session_rpe ?? "—"} />
        <Stat label="Duration" value={session.duration_min ? `${session.duration_min}m` : "—"} />
      </div>

      {prSummaries.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          {prSummaries.map((s) =>
            s.hits.map((hit) => (
              <div
                key={`${s.movementId}:${hit.kind}`}
                className="cp-card"
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  borderColor: "var(--cp-accent)",
                  background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
                }}
              >
                <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden="true">🏆</div>
                <div style={{ display: "grid", gap: 2, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
                    {PR_KIND_LABEL[hit.kind]} · {s.movementDisplayName}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
                    <span className="mono" style={{ fontWeight: 600, color: "var(--cp-accent)" }}>
                      {formatHitValue(hit, hit.kind)}
                    </span>
                    {hit.previousBest != null && (
                      <span style={{ marginLeft: 8 }}>
                        · previous best{" "}
                        <span className="mono">{formatHitValue({ ...hit, value: hit.previousBest }, hit.kind)}</span>
                        {hit.daysSincePrevious != null && hit.daysSincePrevious >= 14 && (
                          <span style={{ marginLeft: 6, fontStyle: "italic" }}>
                            · first {hit.kind === "weight" ? "weight" : hit.kind === "reps_at_weight" ? "reps" : "1RM"} PR in {Math.round(hit.daysSincePrevious / 7)} weeks
                          </span>
                        )}
                      </span>
                    )}
                    {hit.previousBest == null && (
                      <span style={{ marginLeft: 8, fontStyle: "italic" }}>· first ever on this lift</span>
                    )}
                  </div>
                </div>
              </div>
            )),
          )}
        </section>
      )}

      <SessionLogClient
        sessionId={id}
        isComplete={isComplete}
        sets={sets}
        tmBySlug={tmBySlug}
        addStrengthSet={addStrengthSet}
      />

      {(cardio && cardio.length > 0) || !isComplete ? (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            Cardio <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>({cardio?.length ?? 0})</span>
          </h2>
          {cardio && cardio.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
              {cardio.map((c) => {
                const mov = Array.isArray(c.movement) ? c.movement[0] : c.movement;
                return (
                  <li
                    key={c.id}
                    style={{
                      padding: "10px 0",
                      borderTop: "1px solid var(--cp-border)",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 13,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{mov?.display_name ?? c.modality}</div>
                      <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                        {Math.round(c.duration_sec / 60)} min
                        {c.distance_km ? ` · ${c.distance_km} km` : ""}
                        {c.avg_hr_bpm ? ` · HR ${c.avg_hr_bpm}` : ""}
                        {c.rpe ? ` · RPE ${c.rpe}` : ""}
                      </div>
                    </div>
                    {!isComplete && (
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link href={`/app/sessions/${id}/cardio/${c.id}/edit`} style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                          edit
                        </Link>
                        <form action={deleteCardio}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="sessionId" value={id} />
                          <button type="submit" style={{ fontSize: 11, background: "transparent", border: "none", color: "var(--cp-text-muted)", cursor: "pointer", padding: 0 }}>
                            delete
                          </button>
                        </form>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {!isComplete && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--cp-text-muted)", userSelect: "none" }}>
                + add cardio block
              </summary>
              <div style={{ marginTop: 10 }}>
                <AddCardioBlockForm sessionId={id} action={addCardioBlock} />
              </div>
            </details>
          )}
        </section>
      ) : null}

      {!isComplete && (
        <div className="cp-stickybar" style={{ marginInline: -16 }}>
          <Link
            href={`/app/sessions/${id}/complete`}
            className="cp-btn primary big"
            style={{ flex: 1 }}
          >
            Finish session →
          </Link>
        </div>
      )}

      {isComplete && session.notes && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Notes</h3>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--cp-text-muted)", whiteSpace: "pre-wrap" }}>
            {session.notes}
          </p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ background: "var(--cp-surface)", border: "1px solid var(--cp-border)", borderRadius: 12, padding: "10px 12px" }}>
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}
