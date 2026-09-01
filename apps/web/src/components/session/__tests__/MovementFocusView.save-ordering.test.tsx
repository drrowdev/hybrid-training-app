/**
 * Defect #2 — `handleSubmit` must not tell the parent FocusStrip a set is
 * covered (and let it advance `activeId` to another movement) until
 * `addStrengthSet` actually resolves without an error. The strip reuses this
 * same component instance across movements, so firing `onSaved` eagerly
 * (before the write settles) let a validation rejection surface its error on
 * whatever movement the strip had already advanced to, instead of the slot
 * that actually failed.
 *
 * Revision follow-up (late `onSaved` stale-closure race): even gated behind
 * the resolved write, `onSaved` still fired from whatever movement was
 * active WHEN THE WRITE STARTED. If the lifter manually navigated to a
 * different movement while that write was in flight, the stale `onSaved`
 * call could yank them back to "next after the old movement", overriding
 * their manual choice. The fix is `shouldFireOnSaved`, a pure comparison
 * between the movement key captured at submit time and the live key read
 * from a ref kept current on every render — exercised directly here.
 *
 * The repo intentionally avoids @testing-library/react/jsdom (see
 * `LogNowDateForm.test.tsx`), so `handleSubmit` itself isn't drivable without
 * mounting the component. Its decision is delegated to `shouldFireOnSaved`
 * precisely so the behavior is testable without a renderer.
 */
import { describe, expect, it } from "vitest";
import { shouldFireOnSaved } from "@/lib/sessions/focus-advance";

describe("shouldFireOnSaved — late onSaved stale-closure guard (defect #2)", () => {
  it("fires when the lifter is still on the movement that was submitted", () => {
    expect(shouldFireOnSaved("bench-press", "bench-press")).toBe(true);
  });

  it("does NOT fire when the lifter has since navigated to a different movement", () => {
    // Submitted while on "bench-press", but the live ref now reads
    // "overhead-press" — the lifter tapped away before the write resolved.
    expect(shouldFireOnSaved("bench-press", "overhead-press")).toBe(false);
  });
});

