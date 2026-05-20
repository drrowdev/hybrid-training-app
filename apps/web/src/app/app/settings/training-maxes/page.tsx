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
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  STRENGTH_ROLE_CANDIDATES,
  type StrengthRole,
} from "@/lib/planner/archetypes";
import { getActiveBlock } from "@/lib/planner/queries";
import { DefaultTmPercentControl } from "@/components/training-maxes/DefaultTmPercentControl";
import { TmAutoForm } from "@/components/training-maxes/TmAutoForm";

export default async function TrainingMaxesPage() {
  const supabase = await createClient();
  const ctx = await getTrainingMaxContext();
  const existingMovementIds = new Set(ctx.rows.map((r) => r.movementId));

  const block = await getActiveBlock();
  const archetype = block ? ARCHETYPES[block.archetype as keyof typeof ARCHETYPES] : undefined;
  const requiredRoles: StrengthRole[] = archetype
    ? Array.from(
        new Set(
          archetype.days
            .filter((d) => d.kind === "strength")
            .map((d) => (d as { role: StrengthRole }).role),
        ),
      )
    : (["squat", "horizontal_press", "deadlift", "vertical_press"] as StrengthRole[]);

  // Resolve display names for every candidate slug we might want to surface.
  const allCandidateSlugs = Array.from(
    new Set(
      requiredRoles.flatMap((r) => STRENGTH_ROLE_CANDIDATES[r] ?? []),
    ),
  );
  const { data: candidateMovements } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern")
    .in("slug", allCandidateSlugs)
    .is("user_id", null);

  const candidateBySlug = new Map(
    (candidateMovements ?? []).map((m) => [m.slug, m]),
  );

  // For each required role, find the user's chosen variant (a TM whose slug is in the candidate list).
  // Build the "Required by your block" group.
  const requiredGroups = requiredRoles.map((role) => {
    const candidates = STRENGTH_ROLE_CANDIDATES[role]
      .map((slug) => candidateBySlug.get(slug))
      .filter((m): m is { id: string; slug: string; display_name: string; pattern: string } => !!m);
    const setRow = ctx.rows.find((r) =>
      STRENGTH_ROLE_CANDIDATES[role].includes(r.movementSlug),
    );
    return {
      role,
      label: STRENGTH_ROLE_LABELS[role],
      candidates,
      setRow,
    };
  });

  const requiredSlugSet = new Set(
    requiredGroups.flatMap((g) => g.candidates.map((c) => c.slug)),
  );

  // "Other" TMs the user has set that aren't for a required role.
  const otherRows = ctx.rows.filter((r) => !requiredSlugSet.has(r.movementSlug));

  // Catalog for the picker (excluding existing TMs).
  const { data: compounds } = await supabase
    .from("movements")
    .select("id, slug, display_name, pattern")
    .eq("is_compound", true)
    .is("user_id", null)
    .order("pattern")
    .order("display_name")
    .limit(120);

  const pickerOptions = (compounds ?? []).filter((m) => !existingMovementIds.has(m.id));

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
          Enter your 1RM for each main lift. The app applies a default TM% to compute the
          working <em>training max</em> used by the planner. Pick whichever variant of squat,
          bench, deadlift, or overhead press you actually train — back squat, front squat,
          trap-bar deadlift, push press, etc. are all valid.
        </p>
      </header>

      {/* ── Default TM% ────────────────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Default TM%
          <span className="cp-info" tabIndex={0} aria-label="Why these presets">
            i
            <span className="pop" style={{ width: 340 }}>
              The literature treats <strong>70–87.5% of true 1RM</strong> as the daily
              strength work zone, with <strong>≥85%</strong> needed on the heaviest
              exposure to maintain strength (Bickel 2011, HIGH).
              &gt;90% of 1RM is reserved for testing or short peaking blocks.
              <br /><br />
              The planner&apos;s intensity wave tops out at 95% of TM, so:
              <br />
              · <strong>TM 85%</strong> → top set ≈ 81% of 1RM (below maintenance floor)
              <br />
              · <strong>TM 90%</strong> → top set ≈ 85.5% of 1RM (right at the floor)
              <br />
              · <strong>TM 95%</strong> → top set ≈ 90.25% of 1RM (testing/peaking)
            </span>
          </span>
        </h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Used for every lift unless you set a per-movement override below.
        </p>
        <DefaultTmPercentControl
          initialPercent={ctx.defaultPercent}
          action={setDefaultTmPercent}
        />
      </section>

      {/* ── Required by archetype ──────────────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {archetype ? "Required for your active block" : "Main lifts"}
        </h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          {archetype
            ? `${archetype.name} needs one TM per role. Pick whichever variant you actually train.`
            : "When you start a block, the planner needs a TM for at least one variant of each role here."}
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          {requiredGroups.map((group) => (
            <RoleGroup
              key={group.role}
              label={group.label}
              candidates={group.candidates}
              currentRow={group.setRow}
              defaultPercent={ctx.defaultPercent}
            />
          ))}
        </div>
      </section>

      {/* ── Other TMs ──────────────────────────────────────────── */}
      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Other lifts</h2>
          <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            TMs you&apos;ve set that aren&apos;t required by the active archetype.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {otherRows.map((r) => (
              <TmCard key={r.id} row={r} defaultPercent={ctx.defaultPercent} />
            ))}
          </ul>
        </section>
      )}

      {/* ── Add by picker (any compound) ───────────────────────── */}
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add a max for any other lift</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick from the catalog of compound movements — autosaves once you select a movement and enter your 1RM.
        </p>
        <TmAutoForm
          mode="new"
          candidateGroups={Array.from(groupBy(pickerOptions, "pattern").entries()).map(([pattern, items]) => ({
            label: prettyPattern(pattern),
            items: items.map((m) => ({ id: m.id, display_name: m.display_name })),
          }))}
          defaultPercent={ctx.defaultPercent}
          action={upsertTrainingMax}
        />
      </section>
    </div>
  );
}

function groupBy<T, K extends keyof T>(items: T[], key: K): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  for (const item of items) {
    const k = item[key];
    const arr = map.get(k) ?? [];
    arr.push(item);
    map.set(k, arr);
  }
  return map;
}

function prettyPattern(pattern: string): string {
  const labels: Record<string, string> = {
    squat: "Squat patterns",
    hinge: "Hinge / deadlift patterns",
    press: "Press patterns",
    pull: "Pull patterns",
    carry: "Carries",
    olympic: "Olympic lifts",
  };
  return labels[pattern] ?? pattern;
}

function RoleGroup({
  label,
  candidates,
  currentRow,
  defaultPercent,
}: {
  label: string;
  candidates: { id: string; slug: string; display_name: string }[];
  currentRow?: TmRow;
  defaultPercent: number;
}) {
  if (currentRow) {
    return (
      <div>
        <RoleHeader label={label} status="set" />
        <TmCard row={currentRow} defaultPercent={defaultPercent} />
      </div>
    );
  }

  return (
    <div>
      <RoleHeader label={label} status="missing" />
      <TmAutoForm
        mode="new"
        candidates={candidates.map((c) => ({ id: c.id, display_name: c.display_name }))}
        defaultPercent={defaultPercent}
        action={upsertTrainingMax}
      />
    </div>
  );
}

function RoleHeader({ label, status }: { label: string; status: "set" | "missing" }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cp-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <span
        className="cp-pill"
        style={{
          color: status === "set" ? "var(--cp-success)" : "var(--cp-danger)",
          borderColor: status === "set" ? "var(--cp-success)" : "var(--cp-danger)",
        }}
      >
        {status === "set" ? "✓ set" : "needs a TM"}
      </span>
    </div>
  );
}

function TmCard({ row, defaultPercent }: { row: TmRow; defaultPercent: number }) {
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

      <TmAutoForm
        mode="edit"
        initial={{
          movementId: row.movementId,
          movementName: row.movementName,
          oneRmKg: row.oneRmKg,
          tmPercent: row.tmPercentOverride,
        }}
        defaultPercent={defaultPercent}
        action={upsertTrainingMax}
      />

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
