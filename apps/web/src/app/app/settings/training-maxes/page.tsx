import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  upsertTrainingMax,
  deleteTrainingMax,
  setDefaultTmPercent,
} from "@/lib/training-maxes/actions";
import {
  getTrainingMaxContext,
  type TmRow,
} from "@/lib/training-maxes/queries";

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
  const ctx = await getTrainingMaxContext();
  const existingMovementIds = new Set(ctx.rows.map((r) => r.movementId));

  const { data: candidates } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .in("slug", SUGGESTED_SLUGS);

  const { data: compounds } = await supabase
    .from("movements")
    .select("id, slug, display_name")
    .eq("is_compound", true)
    .is("user_id", null)
    .order("display_name")
    .limit(80);

  const suggested = (candidates ?? []).filter((m) => !existingMovementIds.has(m.id));

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
          Enter your 1RM for each main lift. The app applies a default TM%
          (typically 85–90%) to compute the working <em>training max</em> used by the planner.
          Override the % per movement if you want one lift treated differently.
        </p>
      </header>

      {/* ── Default TM% ────────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Default TM%</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Used for every lift unless you set a per-movement override below.
        </p>
        <form action={setDefaultTmPercent} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            name="percent"
            step="0.5"
            min="50"
            max="100"
            defaultValue={ctx.defaultPercent}
            inputMode="decimal"
            aria-label="Default training max percent"
            required
            className="mono"
            style={{ width: 110, padding: "8px 10px", fontSize: 16, textAlign: "right" }}
          />
          <span style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>% of 1RM</span>
          <button type="submit" className="cp-btn">Save default</button>
        </form>
      </section>

      {/* ── Your maxes ─────────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Your maxes</h2>
        {ctx.rows.length === 0 ? (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--cp-text-muted)" }}>
            None yet. Add one below — the canonical four are squat, bench, deadlift, overhead press.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "grid", gap: 8 }}>
            {ctx.rows.map((r) => (
              <TmCard key={r.id} row={r} defaultPercent={ctx.defaultPercent} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Quick-add canonicals ───────────────────────────────── */}
      {suggested.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Quick add — main lifts</h2>
          <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Enter your 1RM and the app will derive the TM. Optional column overrides the default % just for that lift.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1.4fr) 110px 110px auto",
              gap: 8,
              padding: "0 0 6px",
              alignItems: "end",
            }}
          >
            <Label>Movement</Label>
            <Label>1RM (kg)</Label>
            <Label>TM% (optional)</Label>
            <span />
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {suggested.map((m) => (
              <QuickAddRow
                key={m.id}
                movement={m}
                defaultPercent={ctx.defaultPercent}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Add by picker ──────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add a max for any lift</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick from the catalog of compound movements.
        </p>
        <form
          action={upsertTrainingMax}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) 110px 110px auto",
            gap: 8,
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 2 }}>
            <Label>Movement</Label>
            <select name="movementId" required aria-label="Movement" style={{ padding: "8px 10px", fontSize: 14 }}>
              <option value="">— pick a movement —</option>
              {(compounds ?? [])
                .filter((m) => !existingMovementIds.has(m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </select>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <Label>1RM (kg)</Label>
            <input
              type="number"
              name="oneRmKg"
              step="0.5"
              min="1"
              max="1000"
              inputMode="decimal"
              required
              aria-label="One rep max in kilograms"
              className="mono"
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, textAlign: "right" }}
            />
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <Label>TM% (optional)</Label>
            <input
              type="number"
              name="tmPercent"
              step="0.5"
              min="50"
              max="100"
              placeholder={`${ctx.defaultPercent}`}
              inputMode="decimal"
              aria-label="Optional per-movement TM percent override"
              className="mono"
              style={{ width: "100%", padding: "8px 10px", fontSize: 14, textAlign: "right" }}
            />
          </div>
          <button type="submit" className="cp-btn primary">Add</button>
        </form>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {children}
    </span>
  );
}

function TmCard({ row, defaultPercent }: { row: TmRow; defaultPercent: number }) {
  const isOverride = row.tmPercentOverride != null;
  return (
    <li
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{row.movementName}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)", marginTop: 2 }}>
            {row.movementSlug}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--cp-accent)" }}>
            {row.tmKg} kg
          </div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            TM ({row.effectivePercent}% × {row.oneRmKg} kg)
          </div>
        </div>
      </div>

      <form
        action={upsertTrainingMax}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 8,
          alignItems: "end",
        }}
      >
        <input type="hidden" name="movementId" value={row.movementId} />
        <div>
          <label
            style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            1RM (kg)
          </label>
          <input
            type="number"
            name="oneRmKg"
            step="0.5"
            min="1"
            max="1000"
            defaultValue={row.oneRmKg}
            inputMode="decimal"
            required
            aria-label="One rep max"
            className="mono"
            style={{ width: "100%", padding: "6px 8px", fontSize: 14, textAlign: "right", marginTop: 2 }}
          />
        </div>
        <div>
          <label
            style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}
          >
            TM% {isOverride ? "(override)" : `(default ${defaultPercent}%)`}
          </label>
          <input
            type="number"
            name="tmPercent"
            step="0.5"
            min="50"
            max="100"
            defaultValue={row.tmPercentOverride ?? ""}
            placeholder={`${defaultPercent}`}
            inputMode="decimal"
            aria-label="TM percent override (leave blank to use default)"
            className="mono"
            style={{ width: "100%", padding: "6px 8px", fontSize: 14, textAlign: "right", marginTop: 2 }}
          />
        </div>
        <button type="submit" className="cp-btn">Save</button>
      </form>

      <form action={deleteTrainingMax} style={{ justifySelf: "end" }}>
        <input type="hidden" name="id" value={row.id} />
        <button
          type="submit"
          className="cp-btn ghost"
          style={{ fontSize: 11, color: "var(--cp-text-muted)", padding: "4px 8px" }}
        >
          remove
        </button>
      </form>
    </li>
  );
}

function QuickAddRow({
  movement,
  defaultPercent,
}: {
  movement: { id: string; display_name: string };
  defaultPercent: number;
}) {
  return (
    <form
      action={upsertTrainingMax}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.4fr) 110px 110px auto",
        gap: 8,
        alignItems: "center",
        borderTop: "1px solid var(--cp-border)",
        paddingTop: 10,
      }}
    >
      <input type="hidden" name="movementId" value={movement.id} />
      <div style={{ fontSize: 14, fontWeight: 500 }}>{movement.display_name}</div>
      <input
        type="number"
        name="oneRmKg"
        step="0.5"
        min="1"
        max="1000"
        inputMode="decimal"
        required
        aria-label={`1RM for ${movement.display_name}`}
        className="mono"
        style={{ width: "100%", padding: "6px 8px", fontSize: 14, textAlign: "right" }}
      />
      <input
        type="number"
        name="tmPercent"
        step="0.5"
        min="50"
        max="100"
        placeholder={`${defaultPercent}`}
        inputMode="decimal"
        aria-label={`TM% override for ${movement.display_name} (optional)`}
        className="mono"
        style={{ width: "100%", padding: "6px 8px", fontSize: 14, textAlign: "right" }}
      />
      <button type="submit" className="cp-btn primary">Add</button>
    </form>
  );
}
