/**
 * Resolve a platform `program_id` to its user-facing label for the AI surface.
 *
 * Platform blocks (ADR 0046) carry their identity in `training_blocks.program_id`
 * (e.g. "wendler-531", "tactical-barbell", "green-protocol", "hyrox", "hybrid"),
 * NOT in the legacy `archetype` column. This resolves that id to the program's
 * display name + one-line summary via the pure registry helpers, so the AI can
 * name the program the user is actually following.
 *
 * Returns null for legacy archetype blocks (program_id null) or unknown ids.
 */
import {
  getNativeProgramEngine,
  getProgramEngine,
} from "@/lib/platform/registry";

export type ProgramLabel = {
  id: string;
  name: string;
  summary: string;
};

export function resolveProgramLabel(
  programId: string | null | undefined,
): ProgramLabel | null {
  if (!programId) return null;
  const meta = (getProgramEngine(programId) ?? getNativeProgramEngine(programId))
    ?.meta;
  if (!meta) return null;
  return { id: meta.id, name: meta.name, summary: meta.summary };
}
