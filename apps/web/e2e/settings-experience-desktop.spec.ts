import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Settings desktop — training-experience change flow.
 *
 * Verifies:
 *  - The Training-experience card renders five years-anchor radios.
 *  - Selecting "Advanced" auto-saves profiles.training_experience =
 *    'advanced_5y_10y'.
 *  - A DC-K4 override-audit row is inserted (event_type='custom',
 *    reason mentions 'Training experience updated', context.kind =
 *    'training_experience_change' with from/to values).
 *  - The "?" explainer is present and is free of internal code leaks.
 *  - The removed settings (body composition phase, accessory volume,
 *    display name) no longer render.
 */

test.describe("@desktop /app/settings/profile · training experience", () => {
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
    await page.goto("/app/settings/profile");
    await page.waitForLoadState("networkidle");

    // The card is always open now — no accordion to expand first.
    await expect(page.getByTestId("settings-card-experience")).toBeVisible();
    await expect(page.getByTestId("settings-training-experience-form")).toBeVisible();
    await expect(
      page.getByTestId("settings-experience-beginner_lt_6m"),
    ).toHaveAttribute("data-selected", "true");
    // The card leads with the current value.
    await expect(page.getByTestId("settings-card-experience-value")).toHaveText(
      "Beginner",
    );
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

    // The "?" explainer is present and is free of internal code leaks
    // (no DC-* references in user-visible copy).
    const how = page.getByTestId("settings-experience-how");
    await expect(how).toBeVisible();
    await how.click();
    await expect(how).toContainText(/observed signals/i);
    await expect(how).not.toContainText(/DC-/);

    // Settings that no longer belong on this page are gone: body composition
    // had no engine consumer, accessory volume moved into the 5/3/1 wizard,
    // and the display name is edited on /app/profile.
    await expect(page.getByTestId("settings-group-body-comp-phase")).toHaveCount(0);
    await expect(page.getByTestId("settings-body-comp-phase")).toHaveCount(0);
    await expect(page.getByTestId("settings-effort-preference-form")).toHaveCount(0);
    await expect(page.getByTestId("settings-display-name-input")).toHaveCount(0);

    // Pick the Advanced option — auto-save fires on selection change.
    await page.getByTestId("settings-experience-advanced_5y_10y").click();
    await expect(page.getByTestId("autosave-status-settings-experience")).toHaveAttribute(
      "data-status",
      "saved",
    );
    await page.waitForLoadState("networkidle");

    // After reload the selection sticks, and the headline value follows it.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByTestId("settings-experience-advanced_5y_10y"),
    ).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("settings-card-experience-value")).toHaveText(
      "Advanced",
    );

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

  test("both cards stay usable at a narrow mobile width", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);
    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/app/settings/profile");
    await page.waitForLoadState("networkidle");

    // The two-column grid collapses to one column, so nothing overflows the
    // viewport horizontally.
    const overflows = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflows).toBe(false);

    // Both cards render, and the segmented controls are still tappable.
    await expect(page.getByTestId("settings-card-experience")).toBeVisible();
    await expect(page.getByTestId("settings-card-units")).toBeVisible();
    for (const id of ["settings-gender-male", "settings-gender-female"]) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(36);
    }
  });
});
