import type {
  ProgramMeta,
  SetupSchema,
  ProgramSetupInput,
  PlatformContext,
  PlannedSessionSpec,
} from "@hta/program-core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlannedSessionInsertRow } from "@/lib/planner/assemble-block-sessions";

export type NativeMaterializeResult =
  | {
      ok: true;
      rows: PlannedSessionInsertRow[];
      meta: { hasAnyTm: boolean; bwHasAnyFamily: boolean };
      /**
       * Distinct movement ids of the block's resolved MAIN lifts (primary +
       * dual-main secondary). The deploy path seeds `training_maxes.tm_percent`
       * for these so the program's chosen loading basis renders correctly.
       */
      mainMovementIds: string[];
    }
  | { ok: false; error: string };

/** A platform program whose sessions are inter-dependent within a block (e.g. cross-day
 *  accessory rotation), so it materialises the WHOLE block at once instead of per-session.
 *  Distinct from the per-session `ProgramEngine` (program-core) used by foreign methodologies. */
export interface NativeProgramEngine<Instance = unknown> {
  readonly meta: ProgramMeta;
  describeSetup(): SetupSchema;
  setup(input: ProgramSetupInput, ctx: PlatformContext): Instance;       // returns a JSON-serialisable instance
  timeline(instance: Instance): PlannedSessionSpec[];                     // pure calendar skeleton
  materializeNative(instance: Instance, supabase: SupabaseClient, userId: string, blockId: string): Promise<NativeMaterializeResult>;
}
