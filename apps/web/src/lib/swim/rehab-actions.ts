"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireIndependentPrograms } from "@/lib/programs/ownership";
import { SwimActionError, swimActionFailure, swimContext } from "./server-context";
import { SWIM_REFRESH_WARNING } from "./action-feedback";
import type { ActionResult } from "@/lib/offline/outbox-core";
import type { Prescription } from "@hta/db";
import { loadOwnedRehabProtocols } from "@/lib/rehab-protocols/owned";
import { compileLibraryRehab } from "@/lib/rehab-protocols/prescription";
import { assertCatalogMovementAllowed, deriveLimitationsContext } from "@/lib/planner/limitations-context";
import { CATALOG_SELECT, toCatalogMovement, type DbMovement } from "@/lib/planner/picker-catalog";
import { ownedSwimWorkout } from "./server-context";
import { readSwimRehabOrigin, readSwimRehabReceipts, readSwimRehabSession } from "./rehab-workouts";

const attachmentsSchema = z.object({
  planId: z.string().uuid(),
  protocolIds: z.array(z.string().uuid()).max(20).refine((ids) => new Set(ids).size === ids.length),
  revision: z.string().regex(/^[a-f0-9]{32}$/),
  requestId: z.string().uuid(),
}).strict();
const savedSchema = z.object({ planId: z.string().uuid(), protocolIds: z.array(z.string().uuid()) });
const startSchema = z.object({
  workoutId: z.string().uuid(), protocolId: z.string().uuid(),
  revision: z.string().regex(/^[a-f0-9]{32}$/), requestId: z.string().uuid(),
}).strict();
const requestSchema = z.object({
  context: z.object({
    kind: z.literal("swim-rehab-request-v1"), sessionId: z.string().uuid(),
    input: z.object({ workoutId: z.string().uuid(), protocolId: z.string().uuid(), prescription: z.unknown() }),
  }),
});

export async function saveSwimRehabAttachments(raw: unknown): Promise<ActionResult & {
  protocolIds?: string[]; warning?: string;
}> {
  const parsed = attachmentsSchema.safeParse(raw);
  if (!parsed.success) return { error: "Choose up to 20 different protocols from your rehab library.", errorCode: "validation" };
  let confirmedIds: string[];
  try {
    const input = parsed.data;
    const { client } = await swimContext();
    await requireIndependentPrograms(client);
    const result = await client.rpc("set_swim_rehab_bindings", {
      p_plan_id: input.planId, p_protocol_ids: input.protocolIds,
      p_expected_revision: input.revision, p_request_id: input.requestId,
    });
    if (result.error?.code === "23503") {
      throw new SwimActionError("A selected protocol is no longer available. Review your rehab library.", "validation");
    }
    if (result.error) throw new Error(result.error.message, { cause: result.error });
    const saved = savedSchema.safeParse(result.data);
    if (!saved.success || saved.data.planId !== input.planId || JSON.stringify(saved.data.protocolIds) !== JSON.stringify(input.protocolIds)) {
      throw new Error("The rehab attachments could not be confirmed. Reload before trying again.");
    }
    confirmedIds = saved.data.protocolIds;
  } catch (error) { return swimActionFailure(error); }

  try {
    revalidatePath("/app/swim");
    revalidatePath("/app/swim/[workoutId]", "page");
    revalidatePath("/app/settings/rehab-protocols");
    return { ok: true, protocolIds: confirmedIds };
  } catch {
    return { ok: true, protocolIds: confirmedIds, warning: SWIM_REFRESH_WARNING };
  }
}

export async function startSwimRehab(raw: unknown): Promise<ActionResult & { sessionId?: string; warning?: string }> {
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) return { error: "Reload this workout and choose a rehab protocol.", errorCode: "validation" };
  const input = parsed.data;
  let confirmedSessionId: string;
  try {
    const { client, user } = await swimContext();
    await requireIndependentPrograms(client);
    const requestResult = await client.from("engine_override_events").select("context")
      .eq("user_id", user.id).eq("id", input.requestId).maybeSingle();
    if (requestResult.error) throw new Error("Could not check your previous start. Try again.");
    let prescription: unknown;
    let previousSessionId: string | undefined;
    if (requestResult.data) {
      const request = requestSchema.safeParse(requestResult.data);
      if (!request.success || request.data.context.input.workoutId !== input.workoutId ||
        request.data.context.input.protocolId !== input.protocolId) {
        throw new SwimActionError("This request was used for a different workout. Reload and try again.", "validation");
      }
      prescription = request.data.context.input.prescription;
      previousSessionId = request.data.context.sessionId;
    } else {
      const receipt = (await readSwimRehabReceipts(client, user.id, input.workoutId, input.protocolId))[0];
      previousSessionId = receipt?.sessionId;
      if (receipt) {
        const session = await readSwimRehabSession(client, user.id, receipt.sessionId);
        if (session && JSON.stringify(readSwimRehabOrigin(session.prescription)) !== JSON.stringify(receipt.origin)) {
          throw new Error("The rehab workout could not be confirmed. Reload and try again.");
        }
        prescription = session?.prescription;
      }
    }
    if (previousSessionId) {
      const session = await readSwimRehabSession(client, user.id, previousSessionId);
      if (!session) throw new SwimActionError("This rehab workout was permanently removed.", "validation");
      if (session.deleted_at) throw new SwimActionError("Restore this rehab workout from Trash first.", "validation");
      const origin = readSwimRehabOrigin(prescription);
      if (!origin || origin.workoutId !== input.workoutId || origin.protocolId !== input.protocolId ||
        JSON.stringify(origin) !== JSON.stringify(readSwimRehabOrigin(session.prescription))) {
        throw new Error("The rehab workout could not be confirmed. Reload and try again.");
      }
    } else {
      const workout = await ownedSwimWorkout(client, user.id, input.workoutId);
      const protocol = (await loadOwnedRehabProtocols(client, user.id, [input.protocolId]))[0];
      if (!protocol) throw new SwimActionError("Choose an available rehab protocol.", "validation");
      const movementIds = [...new Set(protocol.items.map((item) => item.movementId))];
      const [catalogResult, limitationsResult] = await Promise.all([
        client.from("movements").select(CATALOG_SELECT).in("id", movementIds).returns<DbMovement[]>(),
        client.from("limitations").select("region,kind,resolved_at,affected_muscles,affected_movement_ids,allowed_movement_ids")
          .eq("user_id", user.id).is("resolved_at", null),
      ]);
      if (catalogResult.error || limitationsResult.error || !catalogResult.data || !limitationsResult.data) {
        throw new Error("Could not check your rehab exercises and limitations. Try again.");
      }
      const catalog = catalogResult.data;
      if (movementIds.some((id) => !catalog.some((movement) => movement.id === id && movement.pattern !== "cardio"))) {
        throw new SwimActionError("A rehab exercise is no longer available. Update the protocol in your library.", "validation");
      }
      const limits = deriveLimitationsContext(limitationsResult.data);
      for (const movement of catalog) assertCatalogMovementAllowed(toCatalogMovement(movement), limits);
      const issued: Prescription = {
        items: compileLibraryRehab(protocol, `swim:${workout.id}`).map((item) => ({
          ...item, movementName: catalog.find((movement) => movement.id === item.movementId)!.display_name,
        })),
        meta: {
          swimRehab: {
            version: 1, planId: workout.plan_id, workoutId: workout.id, scheduledDate: workout.scheduled_date,
            protocolId: protocol.id, protocolRevision: protocol.revision, protocolName: protocol.name,
          }
        },
      };
      prescription = issued;
    }
    const result = await client.rpc("start_swim_rehab_session", {
      p_workout_id: input.workoutId, p_protocol_id: input.protocolId, p_expected_revision: input.revision,
      p_prescription: prescription, p_request_id: input.requestId,
    });
    if (result.error?.code === "22023") throw new SwimActionError(result.error.message, "validation");
    if (result.error) throw new Error(result.error.message, { cause: result.error });
    const sessionId = z.string().uuid().safeParse(result.data);
    if (!sessionId.success || (previousSessionId && sessionId.data !== previousSessionId)) {
      throw new Error("The rehab start could not be confirmed. Retry to check the same request.");
    }
    const session = await readSwimRehabSession(client, user.id, sessionId.data);
    const origin = readSwimRehabOrigin(session?.prescription);
    if (!session || session.deleted_at || !origin || origin.workoutId !== input.workoutId || origin.protocolId !== input.protocolId) {
      throw new Error("The rehab start could not be confirmed. Retry to check the same request.");
    }
    confirmedSessionId = session.id;
  } catch (error) { return swimActionFailure(error); }
  try {
    revalidatePath(`/app/swim/${input.workoutId}`);
    revalidatePath("/app/sessions");
    revalidatePath("/app");
    return { ok: true, sessionId: confirmedSessionId };
  } catch { return { ok: true, sessionId: confirmedSessionId, warning: SWIM_REFRESH_WARNING }; }
}
