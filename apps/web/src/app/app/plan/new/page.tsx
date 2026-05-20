import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBlock } from "@/lib/planner/actions";
import { ARCHETYPES, STRENGTH_ANCHOR } from "@/lib/planner/archetypes";
import { todayYmd } from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";

export default async function NewBlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolve required movements + check existing TMs for the canonical archetype.
  const requiredSlugs = Array.from(new Set(STRENGTH_ANCHOR.days.map((d) => d.movementSlug)));
  const { data: movements } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", requiredSlugs)
    .is("user_id", null);

  const tmCtx = await getTrainingMaxContext();
  const tmBySlug = tmCtx.bySlug;
  const allTmsReady = (movements ?? []).every((m) => tmBySlug.has(m.slug));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link href="/app/plan" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← plan
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>Start a block</h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          A block is a multi-week mesocycle. Pick an archetype, confirm your training maxes,
          and the planner will generate the calendar.
        </p>
      </header>

      {/* ── Archetype picker ───────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Archetype</h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          One option in v1. Hypertrophy / endurance archetypes land next.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {Object.values(ARCHETYPES).map((a) => (
            <div
              key={a.id}
              style={{
                border: `1px solid var(--cp-accent)`,
                background: "var(--cp-accent-soft)",
                borderRadius: 12,
                padding: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 15 }}>{a.name}</h3>
                <span className="cp-pill">{a.weeks} weeks · {a.days.length} days/wk</span>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--cp-text-muted)" }}>{a.oneLiner}</p>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
                {a.weekProfiles.map((wp) => (
                  <div
                    key={wp.weekIndex}
                    style={{
                      background: "var(--cp-surface)",
                      border: "1px solid var(--cp-border)",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                      Week {wp.weekIndex + 1}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{wp.intensityLabel}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                      {wp.setIntensities.map((s) => `${Math.round(s * 100)}%`).join(" / ")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── TM readiness ───────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Training maxes</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          The block needs a TM for each main lift. Update them in{" "}
          <Link href="/app/settings/training-maxes" style={{ color: "var(--cp-link)" }}>Settings → Training maxes</Link>.
        </p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {(movements ?? []).map((m, i) => {
            const tm = tmBySlug.get(m.slug);
            return (
              <li
                key={m.id}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "10px 0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                  fontSize: 13,
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{m.display_name}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                    {m.slug}
                  </div>
                </div>
                {tm ? (
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{tm} kg</span>
                ) : (
                  <span style={{ fontSize: 12, color: "var(--cp-danger)", fontWeight: 600 }}>
                    not set
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Start ──────────────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <form action={createBlock} style={{ display: "grid", gap: 12 }}>
          <input type="hidden" name="archetype" value={STRENGTH_ANCHOR.id} />
          <div>
            <label
              htmlFor="startedOn"
              style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}
            >
              Start date
            </label>
            <input
              type="date"
              id="startedOn"
              name="startedOn"
              defaultValue={todayYmd()}
              required
              style={{
                display: "block",
                marginTop: 6,
                padding: "8px 10px",
                fontSize: 14,
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "var(--cp-surface)",
                color: "var(--cp-text)",
                fontFamily: "inherit",
              }}
            />
            <div style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 4 }}>
              The block snaps to the Monday of the chosen week.
            </div>
          </div>
          {!allTmsReady && (
            <div style={{ fontSize: 12, color: "var(--cp-danger)" }}>
              You&apos;re missing a TM for one or more main lifts. Set them first, then come back.
            </div>
          )}
          <div>
            <button type="submit" className="cp-btn primary big" disabled={!allTmsReady}>
              Generate {STRENGTH_ANCHOR.weeks}-week block →
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
