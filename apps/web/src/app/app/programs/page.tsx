import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/dates";
import { archetypeDisplayName, getActiveBlocks } from "@/lib/planner/queries";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getSwimNavigation, swimEntryHref } from "@/lib/swim/navigation";
import { ProgramsOverview } from "@/components/program/ProgramsOverview";

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ activity?: string }> }) {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const params = await searchParams;
  const [active, snapshot, swimming, profile] = await Promise.all([
    getActiveBlocks(), loadAvailableTrainingSchedule(client), getSwimNavigation(client, user.id),
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (profile.error) throw new Error("Could not load your training settings.");
  return <ProgramsOverview programs={active.map((block) => ({
    id: block.id, kind: block.programKind, name: archetypeDisplayName(block.archetype, block.notes),
    startedOn: block.startedOn, weeks: block.weeks, editable: block.programId === "authored",
  }))} activity={params.activity} entries={snapshot?.entries ?? null}
    today={todayYmd(profile.data?.timezone ?? "UTC")} swimHref={swimEntryHref(swimming)} hasSwimPlans={swimming.hasPlans} />;
}
