/**
 * Defect #5 (client half) — `onUndo` used to `dismiss()` on any settled
 * fetch response, without checking `response.ok`. A server-side restore
 * failure (e.g. the delete-actions defect #5 fix throwing, or a 4xx/5xx from
 * the restore route) still closed the banner and refreshed the route,
 * silently discarding the only recovery affordance for a delete the lifter
 * didn't actually get to undo.
 *
 * `UndoBanner` renders `null` until a `hta-undo-banner` CustomEvent fires
 * (a `useEffect` subscription), and `onUndo` is only reachable after a real
 * click on the rendered button — neither is drivable via
 * `renderToStaticMarkup` without jsdom, which this repo intentionally
 * avoids (see `LogNowDateForm.test.tsx`). Both the ok/not-ok/network-failure
 * decision (`resolveRestoreOutcome`) and what the banner does with that
 * decision (`planUndoBannerAction`) are extracted into pure functions
 * exercised directly below, so the whole "does the affordance survive a
 * failed restore" property is asserted as behavior, not read out of source
 * text.
 */
import { describe, expect, it } from "vitest";
import {
  planUndoBannerAction,
  RESTORE_FAILED_MESSAGE,
  RESTORE_NETWORK_ERROR_MESSAGE,
  resolveRestoreOutcome,
} from "@/lib/trash/restore-outcome";

describe("resolveRestoreOutcome (defect #5)", () => {
  it("reports success for an ok response", () => {
    expect(resolveRestoreOutcome({ ok: true })).toEqual({ kind: "restored" });
  });

  it("reports failure for a non-ok response, without throwing", () => {
    expect(resolveRestoreOutcome({ ok: false })).toEqual({
      kind: "failed",
      message: RESTORE_FAILED_MESSAGE,
    });
  });
});

describe("planUndoBannerAction — restoreError recovery affordance stays visible", () => {
  it("dismisses and refreshes on a restored outcome", () => {
    expect(planUndoBannerAction({ kind: "restored" })).toEqual({
      kind: "dismiss-and-refresh",
    });
  });

  it("does not dismiss on a failed outcome — it surfaces the error instead", () => {
    // `dismiss-and-refresh` is the only action that closes the banner
    // (`UndoBanner.onUndo` only calls `dismiss()` in that branch). A
    // `show-error` result therefore *is* the guarantee that `target` stays
    // set and the Undo button remains mounted and clickable for a retry.
    const action = planUndoBannerAction({
      kind: "failed",
      message: RESTORE_FAILED_MESSAGE,
    });
    expect(action).toEqual({
      kind: "show-error",
      message: RESTORE_FAILED_MESSAGE,
    });
    expect(action.kind).not.toBe("dismiss-and-refresh");
  });

  it("surfaces the network-error message the same way as an HTTP failure", () => {
    // `UndoBanner.onUndo`'s catch block reports `RESTORE_NETWORK_ERROR_MESSAGE`
    // through the same `show-error` action — a thrown fetch (offline, DNS
    // failure) must keep the recovery affordance up exactly like a 4xx/5xx.
    expect(
      planUndoBannerAction({
        kind: "failed",
        message: RESTORE_NETWORK_ERROR_MESSAGE,
      }),
    ).toEqual({ kind: "show-error", message: RESTORE_NETWORK_ERROR_MESSAGE });
  });
});
