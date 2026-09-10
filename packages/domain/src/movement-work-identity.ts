const TIMED_HOLD_MOVEMENT_SLUGS = new Set(["dead-hang"]);

/** Movements whose work target is elapsed hold time rather than repetitions. */
export function movementUsesTimedHold(
  slug: string | null | undefined,
): boolean {
  return slug != null && TIMED_HOLD_MOVEMENT_SLUGS.has(slug);
}
