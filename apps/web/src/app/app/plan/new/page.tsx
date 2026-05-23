import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBlock } from "@/lib/planner/actions";
import {
  ARCHETYPES,
  STRENGTH_ROLE_LABELS,
  effectiveDays,
} from "@/lib/planner/archetypes";
import { getRecentBlocks, todayYmd } from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import {
  PlanNewSwitch,
  type RecentBlockCard,
  type TmReadinessByArchetype,
} from "@/components/planner/BlockWizard";

// Six wizard-resolvable archetype ids — must stay in sync with
// `ResolvedArchetype["id"]` in lib/planner/wizard/wizard-mapping.ts.
const WIZARD_ARCHETYPE_IDS = [
  "strength_anchor",
  "endurance_anchor",
  "concurrent_hybrid",
  "hypertrophy_anchor",
  "maintenance",
  "rebuild",
] as const;

export default async function NewBlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tmCtx = await getTrainingMaxContext();

  const { data: profile } = await supabase
    .from("profiles")
    .select("allows_two_a_days, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const allowsTwoADays = Boolean(profile?.allows_two_a_days ?? false);
  const timezone = profile?.timezone ?? "UTC";

  // ── TM readiness per wizard-resolvable archetype ──
  const tmReadinessByArchetype = Object.fromEntries(
    WIZARD_ARCHETYPE_IDS.map((id) => {
      const archetype = ARCHETYPES[id];
      const pool = effectiveDays(archetype, allowsTwoADays);
      const missingRoles: string[] = [];
      const rolesSeen = new Map<string, boolean>();
      for (const day of pool) {
        if (day.kind !== "strength") continue;
        const existing = rolesSeen.get(day.role);
        const hasTm = day.candidateSlugs.some((s) => tmCtx.bySlug.has(s));
        if (existing === undefined) rolesSeen.set(day.role, hasTm);
        else if (hasTm) rolesSeen.set(day.role, true);
      }
      for (const [role, ready] of rolesSeen.entries()) {
        if (!ready) missingRoles.push(STRENGTH_ROLE_LABELS[role as keyof typeof STRENGTH_ROLE_LABELS]);
      }
      return [id, { ready: missingRoles.length === 0, missingRoles }];
    }),
  ) as TmReadinessByArchetype;

  // ── Recent blocks for "Run it again" ──
  const recent = await getRecentBlocks(3);
  const recentBlocks: RecentBlockCard[] = recent.map((b) => ({
    id: b.id,
    archetype: b.archetype,
    archetypeName: b.archetypeName,
    startedOn: b.startedOn,
    daysPerWeek: b.daysPerWeek,
    status: b.status,
    dayIndexOverrides: b.dayIndexOverrides,
  }));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link
          href="/app/plan"
          style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}
        >
          ← plan
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>
          Start a new block
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Pick up where you left off, or shape a new block from your goals.
        </p>
      </header>

      <PlanNewSwitch
        recentBlocks={recentBlocks}
        tmReadinessByArchetype={tmReadinessByArchetype}
        allowsTwoADays={allowsTwoADays}
        todayYmd={todayYmd(timezone)}
        action={createBlock}
      />
    </div>
  );
}
