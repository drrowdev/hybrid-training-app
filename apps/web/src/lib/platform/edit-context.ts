"use server";

/**
 * Edit-context loader for the "Edit plan" wizard re-entry (forward-only re-gen).
 *
 * Given the user's ACTIVE platform block, it reconstructs the wizard inputs so
 * the program picker can open mid-flow with the user's existing choices and let
 * them adjust (notably add/remove cardio days). Read-only + user-scoped (RLS):
 * every query is matched on the signed-in user's id, never the service role.
 *
 * v1 supports the strength-only foreign programs (5/3/1, Tactical Barbell) — the
 * only ones that accept wizard-added OPEN cardio days. The concurrent programs
 * (Hybrid, Green Protocol, HYROX) own their own cardio/calendar and aren't
 * editable through this path yet.
 */
import type { Prescription } from "@hta/db";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import {
  tbCustomizationSchema,
  type TbCustomization,
} from "./tb-customization";
import { daysBetweenYmd, mondayOfYmd, todayYmd } from "@/lib/dates";

/** Foreign strength-only programs the edit flow supports (own cardio is wizard-added). */
const EDITABLE_PROGRAM_IDS = new Set<string>(["wendler-531", "tactical-barbell"]);

export interface ProgramEditContext {
  blockId: string;
  programId: string;
  /** The raw wizard setup values captured at deploy (program-specific). */
  setupValues: Record<string, unknown>;
  /** Strength weekdays (0 = Mon … 6 = Sun). */
  strengthWeekdays: number[];
  /** Current OPEN cardio weekdays (0 = Mon … 6 = Sun), derived from cardio rows. */
  cardioWeekdays: number[];
  /** Original block start (YYYY-MM-DD) — fixed; you can't move the past. */
  startedOn: string;
  /** Per-block antagonist-superset accessories choice. */
  supersetAccessories: boolean;
  /** Whether opt-in TB accessory work is present in the block's strength sessions. */
  accessoriesEnabled: boolean;
  customization?: TbCustomization;
  /** Current materialized block week and absolute engine start offset. */
  currentWeekIndex: number;
  programStartWeekIndex: number;
}

/**
 * Returns null when there's no editable active block (none, wrong program, or
 * missing program-instance state) so the caller can fall back to a fresh wizard.
 */
export async function getBlockEditContext(blockId: string): Promise<ProgramEditContext | null> {
  const {
    data: { user },
  } = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();

  const { data: block } = await supabase
    .from("training_blocks")
    .select("id, program_id, started_on, superset_accessories, status, deleted_at")
    .eq("id", blockId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!block) return null;
  if (block.status !== "active" || block.deleted_at != null) return null;
  const programId = (block.program_id as string | null) ?? null;
  if (!programId || !EDITABLE_PROGRAM_IDS.has(programId)) return null;

  // Setup values + strength weekdays come from the active program-instance's
  // serialised wizard input (`{ values, weekdays, startedOn }`).
  const { data: pi } = await supabase
    .from("program_instances")
    .select("setup_input")
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const setupInput = (pi?.setup_input ?? {}) as {
    values?: Record<string, unknown>;
    weekdays?: number[];
    customization?: unknown;
    startWeekIndex?: number;
  };
  const setupValues = setupInput.values ?? {};
  const strengthWeekdays = (setupInput.weekdays ?? [])
    .filter((d): d is number => typeof d === "number" && d >= 0 && d <= 6);
  if (strengthWeekdays.length === 0) return null;

  // OPEN cardio weekdays: distinct day_index of the block's `role = 'cardio'`
  // placeholder rows (one per week per cardio weekday).
  const { data: cardioRows } = await supabase
    .from("planned_sessions")
    .select("day_index")
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .eq("role", "cardio");
  const cardioWeekdays = Array.from(
    new Set((cardioRows ?? []).map((r) => r.day_index as number)),
  )
    .filter((d) => typeof d === "number" && d >= 0 && d <= 6)
    .sort((a, b) => a - b);

  // Detect opt-in TB accessory work so a re-gen doesn't silently drop it: the
  // base templates carry no `accessory` items, so any one is a positive signal.
  const { data: strengthRow } = await supabase
    .from("planned_sessions")
    .select("prescription")
    .eq("block_id", blockId)
    .eq("user_id", user.id)
    .eq("role", "strength")
    .limit(1)
    .maybeSingle();
  const items = ((strengthRow?.prescription as Prescription | null)?.items ?? []) as Array<{
    kind?: string;
  }>;
  const accessoriesEnabled = items.some((i) => i.kind === "accessory");
  const customizationResult = tbCustomizationSchema.safeParse(
    setupInput.customization,
  );
  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();
  const elapsedDays = daysBetweenYmd(
    mondayOfYmd(block.started_on as string),
    todayYmd((profile?.timezone as string | null) ?? "UTC"),
  );
  const currentWeekIndex = Math.max(0, Math.floor(elapsedDays / 7));
  const programStartWeekIndex =
    typeof setupInput.startWeekIndex === "number"
      ? Math.max(0, Math.trunc(setupInput.startWeekIndex))
      : 0;

  return {
    blockId,
    programId,
    setupValues,
    strengthWeekdays,
    cardioWeekdays,
    startedOn: block.started_on as string,
    supersetAccessories: Boolean(block.superset_accessories),
    accessoriesEnabled,
    currentWeekIndex,
    programStartWeekIndex,
    ...(customizationResult.success
      ? { customization: customizationResult.data }
      : {}),
  };
}
