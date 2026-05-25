import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Settings desktop — training-experience change flow.
 *
 * Verifies:
 *  - The Training-experience section renders five years-anchor radios.
 *  - Selecting "Advanced" auto-saves profiles.training_experience =
 *    'advanced_5y_10y'.
 *  - A DC-K4 override-audit row is inserted (event_type='custom',
 *    reason mentions 'Training experience updated', context.kind =
 *    'training_experience_change' with from/to values).
 *  - The "How does this work?" expansion is present and is free of
 *    internal code leaks.
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
      .update({ training_experience: "beginner_lt_6m" })
      .eq("id", freshUser.userId);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    // The settings page now uses collapsible groups; navigating with a hash
    // auto-expands the relevant group so the form is interactable.
    await page.goto("/app/settings#training-preferences");
    await page.waitForLoadState("networkidle");

    // Section renders with the five years-anchor radios.
    await expect(page.getByTestId("settings-training-experience-form")).toBeVisible();
    await expect(
      page.getByTestId("settings-experience-beginner_lt_6m"),
    ).toHaveAttribute("data-selected", "true");
    // All five tiers render.
    for (const id of [
      "settings-experience-beginner_lt_6m",
      "settings-experience-novice_6m_2y",
      "settings-experience-intermediate_2y_5y",
      "settings-experience-advanced_5y_10y",
      "settings-experience-highly_advanced_10y_plus",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }

    // "How does this work?" inline expansion is present and is free of
    // internal code leaks (no DC-* references in user-visible copy).
    const how = page.getByTestId("settings-experience-how");
    await expect(how).toBeVisible();
    await how.click();
    await expect(how).toContainText(/observed signals/i);
    await expect(how).not.toContainText(/DC-/);

    // Pick the Advanced option — auto-save fires on selection change.
    await page.getByTestId("settings-experience-advanced_5y_10y").click();
    await expect(page.getByTestId("autosave-status-settings-experience")).toHaveAttribute(
      "data-status",
      "saved",
    );
    await page.waitForLoadState("networkidle");

    // After reload the selection sticks.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByTestId("settings-experience-advanced_5y_10y"),
    ).toHaveAttribute("data-selected", "true");

    // DB: profiles.training_experience updated.
    const { data: profile } = await admin
      .from("profiles")
      .select("training_experience")
      .eq("id", freshUser.userId)
      .maybeSingle();
    expect(profile?.training_experience).toBe("advanced_5y_10y");

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
    expect(ctx.from).toBe("beginner_lt_6m");
    expect(ctx.to).toBe("advanced_5y_10y");
  });
});
