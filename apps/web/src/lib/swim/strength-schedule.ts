import type { SupabaseClient } from "@supabase/supabase-js";
import type { SwimStrengthContext } from "@hta/domain";
import { z } from "zod";
import { dayDate } from "@/lib/planner/queries";
import { SwimActionError } from "./server-context";

const rowSchema = z.object({
  id: z.string(), week_index: z.number().int().nonnegative(), day_index: z.number().int().min(0).max(6),
  role: z.string(), prescription: z.object({ items: z.array(z.object({ kind: z.string() }).passthrough()) }).passthrough(),
});
const strengthKinds = new Set(["main", "back_off", "accessory", "tendon", "power_potentiation"]);

export async function loadSwimStrengthContext(client: SupabaseClient, userId: string): Promise<SwimStrengthContext> {
  // Same active-block selection as the planner; unlike its display fallback,
  // schedule advice must fail closed on read errors.
  const { data: block, error } = await client.from("training_blocks")
    .select("id,started_on").eq("user_id", userId).eq("status", "active").is("deleted_at", null)
    .order("started_on", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new SwimActionError("Could not check your strength schedule. Try again.", "transient");
  if (!block) return { blockId: null, sessions: [] };
  const sessions: SwimStrengthContext["sessions"][number][] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await client.from("planned_sessions")
      .select("id,week_index,day_index,role,prescription").eq("user_id", userId).eq("block_id", block.id)
      .is("skipped_at", null).order("id").range(offset, offset + 999);
    const rows = z.array(rowSchema).safeParse(result.data);
    if (result.error || !rows.success) throw new SwimActionError("Could not check your strength schedule. Try again.", "transient");
    for (const row of rows.data) {
      if (row.role === "strength" || row.prescription.items.some((item) => strengthKinds.has(item.kind))) {
        // Includes fixed and explicit-date foreign schedules after materialization,
        // and native plans. day_index is Monday=0; dayDate is canonical.
        sessions.push({ id: row.id, date: dayDate(block.started_on, row.week_index, row.day_index) });
      }
    }
    if (rows.data.length < 1000) break;
  }
  return { blockId: block.id, sessions };
}
