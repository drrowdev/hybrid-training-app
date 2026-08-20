/**
 * Split a formatted prescription value into its atomic chunks.
 *
 * `formatPrescriptionItem` joins independent facts with " · " ("3 × 15s hold ·
 * each side"), and the row renderers join multiple items the same way. Every
 * chunk is a single indivisible fact — "3 × 15" must never be read as "3 ×" on
 * one line and "15" on the next.
 *
 * Renderers pair this with a nowrap span per chunk, so a narrow row can only
 * break BETWEEN facts.
 */
export function splitPrescriptionChunks(value: string): string[] {
  return value
    .split(" · ")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}
