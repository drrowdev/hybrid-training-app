/**
 * Heading dedup helpers shared by the Session Preview body and the
 * in-progress Session detail surfaces.
 *
 * Both surfaces render a page title (e.g. "VO2 intervals") followed by
 * per-movement cards. When a card's heading would just repeat the page
 * title (with or without an engine-protocol shorthand suffix like
 * " — 4×4"), we drop the in-card heading. Comparing on the normalised
 * form keeps cosmetic capitalisation ("VO2 Intervals" vs "VO2
 * intervals") and shorthand-suffix differences from leaking a duplicate
 * heading onto screen.
 *
 * Extracted from `SessionPreviewBody.tsx` (PR #207) so the live
 * session page can reuse the same comparison without forking the
 * logic.
 */

/**
 * Lowercase, trim, and strip a trailing " — X×Y" / " - 4x4" /
 * " – tempo" protocol-shorthand suffix. Returns "" for empty input so
 * callers can short-circuit cleanly.
 */
export function normalizeTitleForDedup(s: string | null | undefined): string {
  if (!s) return "";
  const head = s.split(/\s+[—–-]\s+/)[0] ?? s;
  return head.trim().toLowerCase();
}

/**
 * Strip the protocol-shorthand suffix from a display name so the
 * surviving heading reads cleanly. Used when the heading is NOT
 * deduped but should still drop " — 4×4" from "VO2 Intervals — 4×4".
 */
export function stripShorthandSuffix(name: string): string {
  const head = name.split(/\s+[—–-]\s+/)[0];
  const trimmed = head?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : name;
}

/**
 * Predicate factory: returns a function that decides whether a given
 * card heading is redundant with `pageTitle`.
 */
export function makeShouldHideHeading(
  pageTitle: string | null | undefined,
): (cardHeading: string | null | undefined) => boolean {
  const normalizedTitle = normalizeTitleForDedup(pageTitle);
  return (name) => {
    if (!normalizedTitle) return false;
    return normalizeTitleForDedup(name) === normalizedTitle;
  };
}
