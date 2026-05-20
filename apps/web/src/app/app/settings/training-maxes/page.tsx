import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  upsertTrainingMax,
  deleteTrainingMax,
} from "@/lib/training-maxes/actions";
import { listTrainingMaxes } from "@/lib/training-maxes/queries";

// Canonical main-lift suggestions — slugs come from the movements seed.
const SUGGESTED_SLUGS = [
  "back_squat",
  "front_squat",
  "bench_press",
  "overhead_press",
  "conventional_deadlift",
  "sumo_deadlift",
  "romanian_deadlift",
];

export default async function TrainingMaxesPage() {
  const supabase = await createClient();
  const existing = await listTrainingMaxes();

  // Suggest only compound, free-bar style movements the user hasn't set yet.
  const { data: candidates } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern, primary_region")
    .in("slug", SUGGESTED_SLUGS);

  // Also offer a broader picker: ~50 popular compounds (is_compound = true).
  const { data: compounds } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern")
    .eq("is_compound", true)
    .is("user_id", null) // only seed movements, not custom
    .order("display_name")
    .limit(80);

  const existingMovementIds = new Set(existing.map((r) => r.movementId));
  const suggested =
    candidates?.filter((m) => !existingMovementIds.has(m.id)) ?? [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link
          href="/app/settings"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← back to settings
        </Link>
        <h1 style={{ fontSize: 26, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Training maxes
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          A training max (TM) is a deliberate underestimate of your 1RM, used as the
          reference number for percentage-based prescription. Stays stable across a block,
          then revisits at deload. Each TM lets the Log show &quot;X% of TM&quot; next to the weight.
        </p>
      </header>

      {/* ── Existing maxes ───────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Your TMs</h2>
        {existing.length === 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--cp-text-muted)" }}>
            None set yet. Add one below — the canonical four are squat, bench, deadlift, overhead press.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0" }}>
            {existing.map((r, i) => (
              <li
                key={r.id}
                style={{
                  borderTop: i === 0 ? "none" : "1px solid var(--cp-border)",
                  padding: "12px 0",
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.movementName}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
                    {r.movementSlug}
                  </div>
                </div>
                <form
                  action={upsertTrainingMax}
                  style={{ display: "flex", gap: 6, alignItems: "center" }}
                >
                  <input type="hidden" name="movementId" value={r.movementId} />
                  <input
                    type="number"
                    name="tmKg"
                    step="0.5"
                    min="1"
                    max="1000"
                    defaultValue={r.tmKg}
                    inputMode="decimal"
                    aria-label="Training max in kilograms"
                    style={{
                      width: 88,
                      padding: "6px 8px",
                      borderRadius: 8,
                      border: "1px solid var(--cp-border)",
                      background: "var(--cp-surface)",
                      color: "var(--cp-text)",
                      fontSize: 14,
                      textAlign: "right",
                    }}
                    className="mono"
                  />
                  <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>kg</span>
                  <button type="submit" className="cp-btn">Save</button>
                </form>
                <form
                  action={deleteTrainingMax}
                  style={{ gridColumn: "1 / -1", justifySelf: "end", marginTop: -8 }}
                >
                  <input type="hidden" name="id" value={r.id} />
                  <button
                    type="submit"
                    className="cp-btn ghost"
                    style={{ fontSize: 11, color: "var(--cp-text-muted)", padding: "4px 8px" }}
                  >
                    remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Add by canonical lift ────────────────────────────────── */}
      {suggested.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Quick add — main lifts</h2>
          <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Tap the lift, enter your TM in kg, save.
          </p>
          <div style={{ display: "grid", gap: 10 }}>
            {suggested.map((m) => (
              <form
                key={m.id}
                action={upsertTrainingMax}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 8,
                  alignItems: "center",
                  borderTop: "1px solid var(--cp-border)",
                  paddingTop: 10,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500 }}>{m.display_name}</div>
                <input type="hidden" name="movementId" value={m.id} />
                <input
                  type="number"
                  name="tmKg"
                  step="0.5"
                  min="1"
                  max="1000"
                  placeholder="kg"
                  inputMode="decimal"
                  aria-label={`Training max for ${m.display_name}`}
                  required
                  style={{
                    width: 88,
                    padding: "6px 8px",
                    borderRadius: 8,
                    border: "1px solid var(--cp-border)",
                    background: "var(--cp-surface)",
                    color: "var(--cp-text)",
                    fontSize: 14,
                    textAlign: "right",
                  }}
                  className="mono"
                />
                <button type="submit" className="cp-btn primary">Add</button>
              </form>
            ))}
          </div>
        </section>
      )}

      {/* ── Add by picking from any compound ─────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add a TM for any lift</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick from the catalog of compound movements.
        </p>
        <form
          action={upsertTrainingMax}
          style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 8 }}
        >
          <select
            name="movementId"
            required
            aria-label="Movement"
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 14,
            }}
          >
            <option value="">— pick a movement —</option>
            {(compounds ?? [])
              .filter((m) => !existingMovementIds.has(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))}
          </select>
          <input
            type="number"
            name="tmKg"
            step="0.5"
            min="1"
            max="1000"
            placeholder="kg"
            inputMode="decimal"
            required
            aria-label="Training max in kilograms"
            style={{
              width: 88,
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 14,
              textAlign: "right",
            }}
            className="mono"
          />
          <button type="submit" className="cp-btn primary">Add TM</button>
        </form>
      </section>
    </div>
  );
}
