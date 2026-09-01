/**
 * Pure decision logic for `UndoBanner.onUndo` (defect #5, client half).
 *
 * `onUndo` used to `dismiss()` on any settled fetch response, without
 * checking `response.ok` — a server-side restore failure (a thrown
 * `deleteSet`/`deleteCardio`, or any other 4xx/5xx from the restore route)
 * still closed the banner and refreshed the route, silently discarding the
 * only recovery affordance for a delete the lifter didn't actually get to
 * undo.
 *
 * Extracted as a pure function (rather than asserted on via source text) so
 * the ok/not-ok branch is directly testable without a DOM: `UndoBanner`
 * itself only renders after a `hta-undo-banner` CustomEvent fires and
 * `onUndo` is only reachable via a real button click, neither of which is
 * drivable through `renderToStaticMarkup` without jsdom (which this repo
 * intentionally avoids).
 */
export type RestoreOutcome =
  | { readonly kind: "restored" }
  | { readonly kind: "failed"; readonly message: string };

/** Shown for both a non-ok HTTP response and a network failure — same
 * class of error from the lifter's point of view. */
export const RESTORE_FAILED_MESSAGE = "Couldn't restore — try again.";
export const RESTORE_NETWORK_ERROR_MESSAGE =
  "Couldn't restore — check your connection and try again.";

/** Called with the resolved fetch `Response` for a restore POST. */
export function resolveRestoreOutcome(
  response: Pick<Response, "ok">,
): RestoreOutcome {
  if (!response.ok) {
    return { kind: "failed", message: RESTORE_FAILED_MESSAGE };
  }
  return { kind: "restored" };
}

/**
 * What `UndoBanner` should do once a `RestoreOutcome` is known — this IS the
 * "recovery affordance stays visible" behavior, expressed as a decision
 * rather than a markup fact. `"dismiss-and-refresh"` is the only action that
 * closes the banner (clears `target`); a failed restore always resolves to
 * `"show-error"`, which leaves `target` untouched, so the Undo button and
 * the banner itself necessarily remain mounted and re-clickable for a retry.
 */
export type UndoBannerAction =
  | { readonly kind: "dismiss-and-refresh" }
  | { readonly kind: "show-error"; readonly message: string };

export function planUndoBannerAction(outcome: RestoreOutcome): UndoBannerAction {
  if (outcome.kind === "failed") {
    return { kind: "show-error", message: outcome.message };
  }
  return { kind: "dismiss-and-refresh" };
}
