import { createClient } from "@/lib/supabase/server";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getActiveBlock } from "@/lib/planner/queries";
import { TrainingWeek } from "./TrainingWeek";

export async function SharedTrainingWeek({ today }: { today: string }) {
  const client = await createClient();
  const [snapshot, active] = await Promise.all([loadAvailableTrainingSchedule(client), getActiveBlock()]);
  if (!snapshot) return null;
  return <TrainingWeek entries={snapshot.entries} today={today} authoredBlockId={active?.programId === "authored" ? active.id : undefined} />;
}
