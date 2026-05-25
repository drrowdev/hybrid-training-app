import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Equipment-settings desktop spec.
 *
 * Verifies the rich inventory editor introduced in this PR:
 *  - Picking the "Home gym" preset clears trap bar + dumbbells +
 *    machines + cardio.
 *  - Picking the "Commercial gym" preset populates the full kit.
 *  - Saving with a preset and reloading keeps the preset's data shape
 *    (preset = "commercial_gym" persists to `profiles.equipment`).
 */
test.describe("@desktop /app/settings/equipment · inventory presets", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("user can switch between presets and save the chosen inventory", async ({
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
    await page.goto("/app/settings/equipment");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("equipment-editor-form")).toBeVisible();
    await expect(page.getByTestId("equipment-preset-row")).toBeVisible();

    // ─── Home gym: no dumbbells, no trap bar, no machines, no cardio.
    await page.getByTestId("equipment-preset-home_gym").click();

    await expect(page.getByTestId("equipment-dumbbells-no")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("equipment-bar-trap")).toHaveAttribute(
      "data-present",
      "false",
    );
    await expect(page.getByTestId("equipment-bar-trap")).toContainText(
      /not available/i,
    );
    // Machines section renders but no machine chip should be active.
    for (const machine of [
      "cable_stack",
      "leg_press",
      "smith_machine",
      "lat_pulldown",
    ]) {
      await expect(page.getByTestId(`equipment-machine-${machine}`)).toHaveAttribute(
        "data-active",
        "false",
      );
    }
    for (const cardio of ["treadmill", "rower", "ski_erg", "elliptical"]) {
      await expect(page.getByTestId(`equipment-cardio-${cardio}`)).toHaveAttribute(
        "data-active",
        "false",
      );
    }

    // ─── Commercial gym: full kit populates again.
    await page.getByTestId("equipment-preset-commercial_gym").click();

    await expect(page.getByTestId("equipment-dumbbells-yes")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("equipment-bar-trap")).toHaveAttribute(
      "data-present",
      "true",
    );
    await expect(page.getByTestId("equipment-bar-trap-kg")).toHaveValue("25");
    await expect(page.getByTestId("equipment-machine-cable_stack")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(page.getByTestId("equipment-cardio-treadmill")).toHaveAttribute(
      "data-active",
      "true",
    );
    // The full preset 25/20/15/10/5/2.5/1.25 plates render as active chips.
    for (const w of ["25", "20", "15", "10", "5", "2_5", "1_25"]) {
      await expect(page.getByTestId(`equipment-plate-${w}`)).toHaveAttribute(
        "data-active",
        "true",
      );
    }

    // Preset selection auto-saves — wait for the inline "Saved" badge.
    await expect(page.getByTestId("equipment-editor-saved")).toBeVisible({
      timeout: 5_000,
    });

    const { data: profile } = await admin
      .from("profiles")
      .select("equipment")
      .eq("id", freshUser.userId)
      .maybeSingle();
    const persisted = profile?.equipment as { preset?: string } | null;
    expect(persisted?.preset).toBe("commercial_gym");

    // Reload and confirm the preset chip is still highlighted.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("equipment-editor-form")).toHaveAttribute(
      "data-preset",
      "commercial_gym",
    );
    await expect(page.getByTestId("equipment-preset-commercial_gym")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("user can select the Functional gym preset and the saved shape matches", async ({
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
    await page.goto("/app/settings/equipment");
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("equipment-preset-functional_gym")).toBeVisible();
    await page.getByTestId("equipment-preset-functional_gym").click();

    // No isolation machines.
    for (const machine of [
      "cable_stack",
      "leg_press",
      "smith_machine",
      "lat_pulldown",
    ]) {
      await expect(page.getByTestId(`equipment-machine-${machine}`)).toHaveAttribute(
        "data-active",
        "false",
      );
    }
    // Conditioning ergs are on; recumbent bike + elliptical are off.
    for (const cardio of ["rower", "ski_erg", "bike_air", "treadmill_curved", "treadmill"]) {
      await expect(page.getByTestId(`equipment-cardio-${cardio}`)).toHaveAttribute(
        "data-active",
        "true",
      );
    }
    for (const cardio of ["bike_recumbent", "elliptical"]) {
      await expect(page.getByTestId(`equipment-cardio-${cardio}`)).toHaveAttribute(
        "data-active",
        "false",
      );
    }
    // Vest + sandbag rendered as kg chips with the typical defaults.
    await expect(page.getByTestId("equipment-accessory-vest-chip-9")).toBeVisible();
    await expect(page.getByTestId("equipment-accessory-sandbag-chip-25")).toBeVisible();

    await expect(page.getByTestId("equipment-editor-saved")).toBeVisible({
      timeout: 5_000,
    });

    const { data: profile } = await admin
      .from("profiles")
      .select("equipment")
      .eq("id", freshUser.userId)
      .maybeSingle();
    const persisted = profile?.equipment as {
      preset?: string;
      cardio?: string[];
      machines?: string[];
      accessories?: { weightedVest?: number[]; sandbag?: number[]; rings?: boolean };
    } | null;
    expect(persisted?.preset).toBe("functional_gym");
    expect(persisted?.machines).toEqual([]);
    expect(persisted?.cardio).toEqual(
      expect.arrayContaining(["rower", "ski_erg", "bike_air", "treadmill_curved", "treadmill"]),
    );
    expect(persisted?.accessories?.weightedVest).toEqual([9]);
    expect(persisted?.accessories?.sandbag).toEqual([25]);
    expect(persisted?.accessories?.rings).toBe(true);
  });
});
