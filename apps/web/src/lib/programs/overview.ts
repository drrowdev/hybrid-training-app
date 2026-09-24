import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgramOverviewItem } from "@/components/program/ProgramsOverview";
import { archetypeDisplayName, type getActiveBlocks } from "@/lib/planner/queries";
import { listSwimPlans, type SwimPlanRow } from "@/lib/swim/storage";
import { swimPlanDefinition } from "@/lib/swim/model";
import { daysBetweenYmd } from "@/lib/dates";

export function blockOverviewItems(blocks: Awaited<ReturnType<typeof getActiveBlocks>>): ProgramOverviewItem[] {
  return blocks.map((block) => ({
    id: block.id, kind: block.programKind, name: archetypeDisplayName(block.archetype, block.notes),
    startedOn: block.startedOn, weeks: block.weeks, editable: block.programId === "authored",
    href: `/app/plan?block=${block.id}`,
  }));
}

export async function swimOverviewItems(client: SupabaseClient, userId: string, plans?: readonly SwimPlanRow[]): Promise<ProgramOverviewItem[]> {
  const owned = (plans ?? await listSwimPlans(client)).filter((plan) => plan.user_id === userId);
  return owned.map((plan) => {
    const definition = swimPlanDefinition(plan);
    return {
      id: plan.id, kind: "swimming", name: definition.privateCourse?.title ??
        (definition.setup.goal === "endurance" ? "Swim endurance" : "Swim technique"),
      startedOn: plan.started_on, endsOn: plan.ends_on, editable: false,
      weeks: Math.ceil((daysBetweenYmd(plan.started_on, plan.ends_on) + 1) / 7),
      href: `/app/swim?plan=${plan.id}`, status: plan.status,
    };
  });
}
