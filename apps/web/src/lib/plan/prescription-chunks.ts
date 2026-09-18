/**
 * Split a formatted prescription value into its atomic chunks.
 *
 * `formatPrescriptionItem` joins independent facts with " · " ("3 × 15s hold ·
 * each side"), and the row renderers join multiple items the same way. Every
 * chunk is an independent fact — short doses such as "3 × 15" should stay
 * together, while long user-authored instructions may wrap within the card.
 *
 * Renderers choose the wrapping behavior for their available width.
 */
export function splitPrescriptionChunks(value: string): string[] {
  return value
    .split(" · ")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}
