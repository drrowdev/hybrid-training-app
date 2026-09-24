import { redirect } from "next/navigation";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { todayYmd } from "@/lib/dates";
import { getActiveBlocks } from "@/lib/planner/queries";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getSwimNavigation } from "@/lib/swim/navigation";
import { blockOverviewItems, swimOverviewItems } from "@/lib/programs/overview";
import { hasTemplateWorkoutTitles } from "@/lib/programs/presentation";
import { ProgramsOverview } from "@/components/program/ProgramsOverview";

export default async function ProgramsPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const params = await searchParams;
  const [active, snapshot, swimming, profile] = await Promise.all([
    getActiveBlocks(), loadAvailableTrainingSchedule(client), getSwimNavigation(client, user.id),
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
  ]);
  if (profile.error) throw new Error("Couldn't load your training settings.");
  const swimPrograms = swimming.storageAvailable ? await swimOverviewItems(client, user.id) : [];
  return <ProgramsOverview programs={[...blockOverviewItems(active), ...swimPrograms]}
    initiallyOpen={params.new === "1"} entries={snapshot?.entries ?? null}
    templateBlockIds={active.filter(hasTemplateWorkoutTitles).map((block) => block.id)}
    today={todayYmd(profile.data?.timezone ?? "UTC")} swimHref={swimming.setupEnabled ? "/app/swim/setup" : null} />;
}
