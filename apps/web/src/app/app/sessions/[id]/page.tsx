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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        <Stat label="Fatigue" value={session.fatigue ? `${session.fatigue}/5` : "—"} />
        <Stat label="Soreness" value={session.soreness ? `${session.soreness}/5` : "—"} />
        <Stat label="sRPE" value={session.session_rpe ?? "—"} />
        <Stat label="Duration" value={session.duration_min ? `${session.duration_min}m` : "—"} />
      </div>

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
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Link href={`/app/sessions/${id}/complete`} className="cp-btn primary big">
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
