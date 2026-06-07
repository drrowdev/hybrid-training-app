import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { createCustomBlock } from "@/lib/planner/actions";
import { updateProfile } from "@/lib/settings/actions";
import { todayYmd } from "@/lib/planner/queries";
import { upcomingMondayYmd } from "@/lib/dates";
import { getTrainingMaxContext } from "@/lib/training-maxes/queries";
import { CustomBlockBuilder } from "@/components/planner/CustomBlockBuilder";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function NewCustomBlockPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) redirect("/login");

  const tmCtx = await getTrainingMaxContext();
  const hasAnyStrengthTm = tmCtx.rows.length > 0;

  const { data: profile } = await supabase
    .from("profiles")
    .select("training_days_per_week, allows_two_a_days, timezone")
    .eq("id", user.id)
    .maybeSingle();
  const defaultDaysPerWeek = Number(profile?.training_days_per_week ?? 4);
  const allowsTwoADays = Boolean(profile?.allows_two_a_days ?? false);
  const timezone = profile?.timezone ?? "UTC";

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <PageHeader
        back={{ href: "/app/plan/new", label: "Plan presets" }}
        title="Build a custom block"
        subtitle="Pick your block length, intensity wave, and what happens on each day. Strength days use whichever variant you've set a TM for. The same prescription pipeline as the curated presets generates the planned sessions."
      />

      <CustomBlockBuilder
        defaultStartedOn={upcomingMondayYmd(todayYmd(timezone))}
        defaultDaysPerWeek={defaultDaysPerWeek}
        hasAnyStrengthTm={hasAnyStrengthTm}
        allowsTwoADays={allowsTwoADays}
        action={createCustomBlock}
        setAllowsTwoADaysAction={updateProfile}
      />
    </div>
  );
}
