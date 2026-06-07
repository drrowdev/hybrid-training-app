import type { DayTemplate } from "./archetypes";

/**
 * Compose a descriptive default workout name: "<Modality> · <focus>"
 * (e.g. "Strength · Front Squat + Overhead Press", "Cardio · VO2
 * intervals", "Tendon · HSR — knee").
 *
 * The title is a USER-FACING LABEL ONLY — nothing reads `session.title`
 * for logic (strength detection keys off `prescription.items[].kind`,
 * not the name), and the user can rename a workout afterwards. The
 * modality prefix makes any list of sessions legible at a glance without
 * opening each one. The optional "(deload)" suffix is preserved.
 */
export function descriptiveSessionTitle(
  kind: DayTemplate["kind"],
  focus: string,
  isDeload: boolean,
): string {
  const deload = isDeload ? " (deload)" : "";
  const modality =
    kind === "strength"
      ? "Strength"
      : kind === "cardio"
        ? "Cardio"
        : kind === "tendon"
          ? "Tendon"
          : null;
  return modality ? `${modality} · ${focus}${deload}` : `${focus}${deload}`;
}
