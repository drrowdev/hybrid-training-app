import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Settings desktop — training-experience change flow.
 *
 * Verifies:
 *  - The Training-experience section renders three years-anchor radios.
 *  - Selecting "3+ years" + Save writes profiles.training_experience = 'gte_3y'.
 *  - A DC-K4 override-audit row is inserted (event_type='custom',
 *    reason mentions 'Training experience updated', context.kind =
 *    'training_experience_change' with from/to values).
 *  - The "How does this work?" expansion is present.
 */

test.describe("@desktop /app/settings · training experience", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("user can change declared experience and the change is audited (DC-K4)", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    // Pre-seed an initial declaration so the change is observable as a
    // transition (not just a first-set).
    await admin
      .from("profiles")
      .update({ training_experience: "lt_1y" })
      .eq("id", freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    // The settings page now uses collapsible groups; navigating with a hash
    // auto-expands the relevant group so the form is interactable.
    await page.goto("/app/settings#training-preferences");
    await page.waitForLoadState("networkidle");

    // Section renders with the three years-anchor radios.
    await expect(page.getByTestId("settings-training-experience-form")).toBeVisible();
    await expect(page.getByTestId("settings-experience-lt_1y")).toHaveAttribute(
      "data-selected",
      "true",
    );

    // "How does this work?" inline expansion is present and cites DC-G1..G6.
    const how = page.getByTestId("settings-experience-how");
    await expect(how).toBeVisible();
    await how.click();
    await expect(how).toContainText(/DC-G1/i);

    // Pick the 3+ years option and save.
    await page.getByTestId("settings-experience-gte_3y").click();
    await page.getByTestId("settings-experience-save").click();
    await page.waitForLoadState("networkidle");

    // After reload the selection sticks.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-experience-gte_3y")).toHaveAttribute(
      "data-selected",
      "true",
    );

    // DB: profiles.training_experience updated.
    const { data: profile } = await admin
      .from("profiles")
      .select("training_experience")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(profile?.training_experience).toBe("gte_3y");

    // DB: a DC-K4 override-audit row was inserted (custom event).
    const { data: overrides } = await admin
      .from("engine_override_events")
      .select("event_type, reason, context")
      .eq("user_id", freshUser.userId)
      .eq("event_type", "custom")
      .order("occurred_at", { ascending: false })
      .limit(5);
    expect(overrides?.length ?? 0).toBeGreaterThanOrEqual(1);
    const top = overrides?.[0];
    expect(top?.reason ?? "").toMatch(/Training experience updated/i);
    const ctx = (top?.context ?? {}) as Record<string, unknown>;
    expect(ctx.kind).toBe("training_experience_change");
    expect(ctx.from).toBe("lt_1y");
    expect(ctx.to).toBe("gte_3y");
  });
});
