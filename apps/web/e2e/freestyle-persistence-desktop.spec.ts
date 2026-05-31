import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Desktop E2E for freestyle movement persistence + remove (PR
 * "feat(session): persist freestyle movements + remove + collapsed
 * chips"). Closes the gap reported in the bug list:
 *
 *   - "Add off-plan movement" used to live only in client state, so a
 *     refresh wiped it before any set was logged.
 *   - There was no UI to remove a mistakenly-added movement.
 *
 * Steps:
 *   1. Create an ad-hoc session row via the admin client (skips the
 *      planned-block seed since this test only cares about the
 *      freestyle surface).
 *   2. Sign in, navigate to the session detail page.
 *   3. Add an off-plan movement → assert the card renders.
 *   4. Reload → assert the card is STILL there (persistence).
 *   5. Add a second off-plan movement.
 *   6. Open the second card's kebab → "Remove movement" → assert the
 *      card is removed from the DOM and, after a reload, doesn't come
 *      back (service-role check on session_movements).
 */
test.describe("@desktop freestyle movement persistence", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("add → refresh → still there → remove → gone", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    const url = baseURL ?? "http://localhost:3000";
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, url);

    // 1) Bare ad-hoc session — no planned block, just a row we own.
    const { data: sessionRow, error: sErr } = await admin
      .from("sessions")
      .insert({ user_id: freshUser.userId, title: "Freestyle persist e2e" })
      .select("id")
      .single();
    expect(sErr).toBeNull();
    const sessionId = sessionRow!.id as string;

    // 2) Pick two real catalog movements to add. We resolve their
    //    slugs to ids via service role so the spec doesn't have to
    //    rely on picker fuzzy-matching for the assertion path.
    const { data: movements } = await admin
      .from("movements")
      .select("id, slug, display_name")
      .in("slug", ["bench-press-flat", "ohp-standing"])
      .is("user_id", null);
    expect(movements?.length).toBe(2);
    const bench = movements!.find((m) => m.slug === "bench-press-flat")!;
    const ohp = movements!.find((m) => m.slug === "ohp-standing")!;

    await page.goto(`/app/sessions/${sessionId}`);
    await page.waitForLoadState("networkidle");

    // 3) Add the first movement via the unified +Add to workout entry.
    //    A bare session (no prescription) is strength-primary, so opening
    //    jumps straight to the strength picker — no Strength|Cardio step.
    await page.getByTestId("add-to-workout-open").click();
    const picker = page.getByPlaceholder(/search the catalog/i);
    await picker.fill("bench press");
    const benchOption = page
      .getByRole("button", { name: new RegExp(bench.display_name as string, "i") })
      .first();
    await expect(benchOption).toBeVisible({ timeout: 10_000 });
    await benchOption.click();

    const benchCard = page.getByTestId(`freestyle-card-${bench.id}`);
    await expect(benchCard).toBeVisible({ timeout: 10_000 });

    // Persistence row should be visible to the service-role check
    // even before the page reload (the action is awaited above).
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("session_movements")
            .select("movement_id")
            .eq("session_id", sessionId);
          return (data ?? []).map((r) => r.movement_id as string);
        },
        { timeout: 10_000 },
      )
      .toContain(bench.id);

    // 4) Reload — the card must still be there because the row is
    //    persisted in session_movements rather than client-state-only.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId(`freestyle-card-${bench.id}`)).toBeVisible();

    // 5) Add a second movement we'll remove.
    await page.getByTestId("add-to-workout-open").click();
    await page.getByPlaceholder(/search the catalog/i).fill("press");
    const ohpOption = page
      .getByRole("button", { name: new RegExp(ohp.display_name as string, "i") })
      .first();
    await expect(ohpOption).toBeVisible({ timeout: 10_000 });
    await ohpOption.click();
    await expect(page.getByTestId(`freestyle-card-${ohp.id}`)).toBeVisible();

    // 6) Remove via the kebab → menu → Remove movement.
    await page.getByTestId(`freestyle-kebab-${ohp.id}`).click();
    await page.getByTestId(`freestyle-remove-${ohp.id}`).click();
    await expect(page.getByTestId(`freestyle-card-${ohp.id}`)).toHaveCount(0);

    // The row is gone from session_movements; the other card is still
    // persisted.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("session_movements")
            .select("movement_id")
            .eq("session_id", sessionId);
          return (data ?? []).map((r) => r.movement_id as string);
        },
        { timeout: 10_000 },
      )
      .toEqual([bench.id]);

    // Cleanup — drop the session so the admin client teardown doesn't
    // leave a stray row in the dev project (the cascade kills
    // session_movements with it).
    await admin.from("sessions").delete().eq("id", sessionId);
  });
});
