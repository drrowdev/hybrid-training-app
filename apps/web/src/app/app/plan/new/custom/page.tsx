import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCustomBlock } from "@/lib/planner/actions";
import { todayYmd } from "@/lib/planner/queries";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { CustomBlockBuilder } from "@/components/planner/CustomBlockBuilder";

export default async function NewCustomBlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tmCtx = await getTrainingMaxContext();
  const hasAnyStrengthTm = tmCtx.rows.length > 0;

  const { data: profile } = await supabase
    .from("profiles")
    .select("training_days_per_week")
    .eq("id", user.id)
    .maybeSingle();
  const defaultDaysPerWeek = Number(profile?.training_days_per_week ?? 4);

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <Link href="/app/plan/new" style={{ fontSize: 12, color: "var(--cp-text-muted)", textDecoration: "none" }}>
          ← plan presets
        </Link>
        <h1 style={{ fontSize: 28, margin: "8px 0 0", letterSpacing: "-0.01em" }}>Build a custom block</h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 14 }}>
          Pick your block length, intensity wave, and what happens on each day.
          Strength days use whichever variant you&apos;ve set a TM for. The same prescription
          pipeline as the curated presets generates the planned sessions.
        </p>
      </header>

      <CustomBlockBuilder
        defaultStartedOn={todayYmd()}
        defaultDaysPerWeek={defaultDaysPerWeek}
        hasAnyStrengthTm={hasAnyStrengthTm}
        action={createCustomBlock}
      />
    </div>
  );
}
