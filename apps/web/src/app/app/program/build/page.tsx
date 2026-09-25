import { redirect } from "next/navigation";
import { z } from "zod";
import type { AuthoredCatalogMovement, ProgramActivity } from "@hta/domain";
import { ProgramBuilder } from "@/components/program/ProgramBuilder";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadAuthoredProgram } from "@/lib/programs/authored/actions";
import { authoredWorkoutSchema } from "@/lib/programs/authored/schema";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import Link from "next/link";
import { todayYmd } from "@/lib/dates";
import { getSwimNavigation } from "@/lib/swim/navigation";
import { privateSwimCourseAvailable } from "@/lib/swim/course-capability";
import { listRehabProtocols } from "@/lib/rehab-protocols/queries";
import { formatProtocolSummary } from "@/lib/rehab-protocols/summary";
import { archetypeDisplayName, getActiveBlocks } from "@/lib/planner/queries";

const movementSchema = z.object({
  id: z.string(), slug: z.string(), display_name: z.string(), pattern: z.string(),
  metadata: z.record(z.unknown()).nullable(),
});
const MODALITIES: Record<string, string> = { running: "run", run: "run", cycling: "bike", bike: "bike", rowing: "row", row: "row", ski: "ski", skiing: "ski", ski_erg: "ski" };

export default async function ProgramBuildPage({ searchParams }: {
  searchParams: Promise<{ activity?: string; edit?: string; workout?: string }>;
}) {
  const { data: { user } } = await getAuthUser();
  if (!user) redirect("/login");
  const client = await createClient();
  const params = await searchParams;
  if (!params.edit && !["strength", "running", "hybrid"].includes(params.activity ?? "")) redirect("/app/programs?new=1");
  const editBlockId = params.edit ? z.string().uuid().parse(params.edit) : undefined;
  const snapshot = await loadAvailableTrainingSchedule(client);
  const [profileResult, initial, navigation, courses, rehabProtocols, active] = await Promise.all([
    client.from("profiles").select("timezone").eq("id", user.id).maybeSingle(),
    editBlockId ? loadAuthoredProgram(editBlockId) : undefined,
    getSwimNavigation(client, user.id),
    privateSwimCourseAvailable(client),
    listRehabProtocols(),
    getActiveBlocks(),
  ]);
  if (!snapshot) return <section><h1>New program</h1><p role="status">Program setup is temporarily unavailable. Try again shortly.</p><Link href="/app/programs">Back to programs</Link></section>;
  if (profileResult.error) throw new Error("Couldn't load your training settings.");
  let initialStartDate: string | undefined;
  let workoutId: string | undefined;
  const plannedSessionId = params.workout ? z.string().uuid().parse(params.workout) : undefined;
  if (editBlockId) {
    const result = await client.from("training_blocks").select("started_on").eq("id", editBlockId).eq("user_id", user.id).single();
    if (result.error) throw new Error("Couldn't load the program start date.");
    initialStartDate = result.data.started_on;
    if (plannedSessionId && initial) {
      const selected = await client.from("planned_sessions").select("prescription,completed_session_id,skipped_at")
        .eq("id", plannedSessionId).eq("block_id", editBlockId).eq("user_id", user.id).single();
      if (selected.error || selected.data.completed_session_id || selected.data.skipped_at) throw new Error("Only unstarted workouts can be edited.");
      const prescription = z.object({ programRef: z.string(), meta: z.object({ authoredWorkout: authoredWorkoutSchema }).passthrough() }).parse(selected.data.prescription);
      const workout = prescription.meta.authoredWorkout;
      if (!initial.workouts.some((entry) => entry.id === workout.id) || !prescription.programRef.startsWith(`authored:${workout.id}:`)) throw new Error("This workout is no longer available to edit.");
      workoutId = workout.id;
      initial.workouts = initial.workouts.map((entry) => entry.id === workout.id ? workout : entry);
    }
  }
  const catalog: AuthoredCatalogMovement[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("movements").select("id,slug,display_name,pattern,metadata").order("id").range(offset, offset + 999);
    if (result.error) throw new Error("Couldn't load the exercise library.");
    const rows = z.array(movementSchema).parse(result.data);
    catalog.push(...rows.map((row) => ({
      id: row.id, slug: row.slug, displayName: row.display_name, pattern: row.pattern,
      modality: typeof row.metadata?.modality === "string" ? MODALITIES[row.metadata.modality] ?? null : null,
    })));
    if (rows.length < 1000) break;
  }
  catalog.sort((a, b) => a.displayName.localeCompare(b.displayName));
  const activity: ProgramActivity = params.activity === "strength" || params.activity === "running" ? params.activity : "hybrid";
  const replacing = active.find((block) => block.programKind === activity);
  return <ProgramBuilder catalog={catalog} today={todayYmd(profileResult.data?.timezone ?? "UTC")}
    activitySelected replacesName={!editBlockId && replacing ? archetypeDisplayName(replacing.archetype, replacing.notes) : undefined}
    rehabProtocols={rehabProtocols.map((protocol) => ({ id: protocol.id, name: protocol.name, summary: formatProtocolSummary(protocol.items) }))}
    commitments={snapshot.entries} activity={activity} initial={initial} editBlockId={editBlockId} initialStartDate={initialStartDate}
    workoutId={workoutId} plannedSessionId={plannedSessionId} initialRevision={snapshot.revision}
    swimHref={navigation.setupEnabled && courses ? "/app/swim/import" : navigation.hasPlans ? "/app/swim" : null} />;
}
