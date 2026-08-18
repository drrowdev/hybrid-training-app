/**
 * 5/3/1 assistance-volume resolution.
 *
 * Assistance volume (`low` = Easier / `standard` = Balanced / `high` = Harder)
 * is collected PER BLOCK in the wizard's Loadout step and stored on the
 * program instance.
 *
 * It used to be a single global control (`profiles.effort_preference`) shown on
 * the training-profile settings page. That control was misleading — it was
 * labelled "Accessory volume" and claimed to apply to every program, when 5/3/1
 * assistance was its only live effect — so it moved into the program that
 * actually consumes it.
 *
 * The legacy column is still read as a FALLBACK so deploys that carry no wizard
 * value stay byte-identical:
 *
 *   - clients cached from before the wizard field shipped, and
 *   - edit-mode re-deploys of blocks created before it, whose stored
 *     `setup_input.values` has no `assistanceVolume` key.
 *
 * Kept pure (no Supabase, no I/O) so the precedence is unit-testable and has a
 * single home, per the repo's derived-state rule.
 */

export type AssistanceVolume = "low" | "standard" | "high";

const VALUES: ReadonlySet<string> = new Set<AssistanceVolume>([
  "low",
  "standard",
  "high",
]);

function coerce(raw: unknown): AssistanceVolume | null {
  return typeof raw === "string" && VALUES.has(raw)
    ? (raw as AssistanceVolume)
    : null;
}

/**
 * Resolve the volume for a 5/3/1 deploy: the wizard's per-block choice wins,
 * then the legacy global profile preference, then `standard` (the identity —
 * the template's own assistance level is used unshifted).
 */
export function resolveAssistanceVolume(args: {
  /** `setupValues.assistanceVolume` from the wizard, if the client sent one. */
  fromWizard: unknown;
  /** Legacy `profiles.effort_preference`, for deploys that carry no wizard value. */
  fromProfile: unknown;
}): AssistanceVolume {
  return coerce(args.fromWizard) ?? coerce(args.fromProfile) ?? "standard";
}
