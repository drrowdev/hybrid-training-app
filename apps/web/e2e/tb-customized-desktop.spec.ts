import { expect, test } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded, seedStrengthTms } from "./fixtures/seed-blocks";

function currentMondayYmd(): string {
  const now = new Date();
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - mondayOffset);
  return monday.toISOString().slice(0, 10);
}

test("customized TB builder exposes standalone templates and Activation", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  const url = baseURL ?? "https://getsxc.app";
  await markOnboarded(admin, freshUser.userId);
  await seedStrengthTms(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, url);

  await page.goto("/app/program?program=tactical-barbell");
  await expect(page.getByText("Customize template")).toBeVisible();
  await page.getByText("Customize template").click();
  await expect(page.getByText("Program name")).toBeVisible();
  await expect(
    page.locator('input[value="Tactical Barbell - Customized"]'),
  ).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Rehab protocol")).toBeHidden();

  const tuesday = page.getByRole("button", { name: /Tue Rest/i });
  await tuesday.click();
  await page.getByRole("button", { name: /Tue Strength/i }).click();
  await page.getByRole("button", { name: /Tue Conditioning/i }).click();
  await expect(page.getByText("Rehab protocol")).toBeVisible();
  await page.getByRole("button", { name: "Add rehab movement" }).click();
  await page.locator('input[type="date"]').first().fill(currentMondayYmd());
  await expect(
    page.getByLabel("Rehab movement 1", { exact: true }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Rehab protocol")).toBeVisible();
  const overflow = await page.evaluate(() => ({
    amount: document.documentElement.scrollWidth - window.innerWidth,
    offenders: Array.from(document.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      })
      .filter((element) => element.right > window.innerWidth + 1)
      .slice(0, 12),
  }));
  if (overflow.amount > 1) {
    throw new Error(
      `Mobile overflow ${overflow.amount}px: ${JSON.stringify(overflow.offenders)}`,
    );
  }

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await expect(page.getByText("Customize template")).toBeVisible();
});

test("creates and restores a phase-aware customized Activation plan", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  test.slow();
  const url = baseURL ?? "http://localhost:3000";
  await markOnboarded(admin, freshUser.userId);
  await seedStrengthTms(admin, freshUser.userId);
  await signInAs(context, freshUser, seedConfig, url);

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await page.getByText("Customize template").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const base = page.getByTestId("activation-phase-base");
  await expect(base).toBeVisible();
  // Phases start collapsed, so the list reads as a list; open the one under test.
  await base.locator(":scope > summary").click();
  const abTriad = page.getByTestId(
    "activation-movement-activation.base.base-1-ab-triad",
  );
  await expect(abTriad.getByText("AB Triad", { exact: true })).toHaveCount(2);
  await expect(abTriad).toContainText(
    "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
  );
  await expect(abTriad).toContainText("3 rounds × 5 each");
  const ordinaryMovement = page.getByTestId(
    "activation-movement-activation.base.base-1-goblet-squat",
  );
  const [triadStyle, ordinaryStyle] = await Promise.all([
    abTriad.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
      };
    }),
    ordinaryMovement.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        background: style.backgroundColor,
        borderRadius: style.borderRadius,
      };
    }),
  ]);
  expect(triadStyle).toEqual(ordinaryStyle);
  await abTriad.getByText("Change", { exact: true }).click();
  await abTriad
    .getByLabel("Search the exercise library")
    .fill("Belt Squat");
  await abTriad.getByRole("button", { name: /Belt Squat/ }).click();
  await expect(abTriad).toContainText("Belt Squat");
  await abTriad
    .getByRole("button", { name: "Restore AB Triad" })
    .click();
  await expect(abTriad).toContainText(
    "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
  );
  await expect(
    page.getByTestId(
      "activation-movement-activation.base.base-1-hanging-leg-raise",
    ),
  ).toHaveCount(0);
  await abTriad.getByRole("button", { name: "Remove" }).click();
  await expect(abTriad).toContainText("Removed");
  await abTriad
    .getByRole("button", { name: "Restore AB Triad" })
    .click();
  await expect(abTriad).toContainText(
    "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
  );
  await page
    .getByTestId("activation-session-activation.base.base-1")
    .getByRole("combobox")
    .selectOption("6");
  await page
    .getByTestId(
      "activation-movement-activation.base.base-1-goblet-squat",
    )
    .getByRole("button", { name: "Remove" })
    .click();
  await page
    .getByTestId("activation-session-activation.base.base-lss-3")
    .getByRole("checkbox")
    .uncheck();
  await page
    .getByTestId("activation-session-activation.base.base-lss-3")
    .getByRole("combobox")
    .selectOption("2");
  await expect(
    page
      .getByTestId("activation-session-activation.base.base-2")
      .getByRole("combobox"),
  ).toHaveValue("2");
  const armor = page.getByTestId("activation-phase-armor");
  await armor.locator(":scope > summary").click();
  const armorA1Card = page.getByTestId(
    "activation-session-activation.armor.armor-a1",
  );
  const armorB1Card = page.getByTestId(
    "activation-session-activation.armor.armor-b1",
  );
  const armorSessionCards = armor.locator(
    '[data-testid^="activation-session-"]',
  );
  await expect(armorA1Card.getByText("Armor · Strength 1")).toBeVisible();
  await expect(armorB1Card.getByText("Armor · Strength 2")).toBeVisible();
  await expect(armorSessionCards.nth(0)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-a1",
  );
  await expect(armorSessionCards.nth(1)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-b1",
  );
  await armorA1Card.getByRole("combobox").selectOption("1");
  await expect(armorA1Card.getByText("Armor · Strength 2")).toBeVisible();
  await expect(armorB1Card.getByText("Armor · Strength 1")).toBeVisible();
  await expect(armorB1Card.getByRole("combobox")).toHaveValue("0");
  await expect(armorSessionCards.nth(0)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-b1",
  );
  await expect(armorSessionCards.nth(1)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-a1",
  );
  const armorSquat = page.getByTestId(
    "activation-movement-activation.armor.armor-a1-squat",
  );
  await armorSquat.getByText("Change", { exact: true }).click();
  await armorSquat
    .getByLabel("Search the exercise library")
    .fill("Belt Squat");
  await armorSquat.getByRole("button", { name: /Belt Squat/ }).click();
  await page.getByRole("button", { name: "Add rehab protocol" }).click();
  await page
    .getByTestId("rehab-protocol-protocol-1")
    .getByRole("button", { name: "Add movement" })
    .click();
  await page.getByRole("button", { name: "Add rehab protocol" }).click();
  await page
    .getByTestId("rehab-protocol-protocol-2")
    .getByRole("button", { name: "Add movement" })
    .click();
  await page
    .getByLabel("Protocol 2 movement 1")
    .selectOption({ label: "Dead Bug" });
  await armor
    .getByLabel("Armor Mon rehab protocol")
    .selectOption("protocol-1");
  await armor
    .getByLabel("Armor Sat rehab protocol")
    .selectOption("protocol-2");
  await page
    .getByTestId("activation-phase-operator")
    .locator(":scope > summary")
    .click();
  for (const session of ["operator-d1", "operator-d2"]) {
    const row = page.getByTestId(
      `activation-movement-activation.operator.${session}-squat`,
    );
    await row.getByText("Change", { exact: true }).click();
    await row.getByLabel("Search the exercise library").fill("Deadlift");
    await row
      .getByRole("button", { name: /Conventional Deadlift/ })
      .click();
  }
  await page
    .getByLabel("Protocol 1 instructions 1")
    .fill("Slow and pain-free, as prescribed by physio.");
  await expect(
    page.getByText("3 strength · 2 conditioning · 0 rehab · 2 rest"),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const deploy = page.getByRole("button", { name: "Deploy program" });
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await page.waitForURL("**/app", { timeout: 30_000 });

  const { data: programInstance, error: instanceError } = await admin
    .from("program_instances")
    .select("block_id, display_name, customization_version, setup_input")
    .eq("user_id", freshUser.userId)
    .eq("status", "active")
    .maybeSingle();
  expect(instanceError).toBeNull();
  expect(programInstance).toMatchObject({
    display_name: "Tactical Barbell - Customized",
    customization_version: 3,
  });
  const setupInput = programInstance!.setup_input as {
    customization?: {
      version?: number;
      rehabProtocols?: Array<{
        id?: string;
        name?: string;
        items?: Array<{ instructions?: string }>;
      }>;
      phases?: {
        base?: {
          rehabAssignments?: Array<{ day?: number; protocolId?: string }>;
          sessions?: Record<
            string,
            {
              day?: number;
              enabled?: boolean;
              movementOverrides?: Record<string, unknown>;
            }
          >;
        };
        armor?: {
          rehabAssignments?: Array<{ day?: number; protocolId?: string }>;
          sessions?: Record<
            string,
            {
              day?: number;
              movementOverrides?: Record<string, unknown>;
            }
          >;
        };
      };
    };
  };
  expect(setupInput.customization).toMatchObject({
    version: 3,
    rehabProtocols: [
      {
        id: "protocol-1",
        name: "Protocol 1",
        items: [
          {
            instructions: "Slow and pain-free, as prescribed by physio.",
          },
        ],
      },
      {
        id: "protocol-2",
        name: "Protocol 2",
        items: [
          {
            movementName: "Dead Bug",
          },
        ],
      },
    ],
    phases: {
      base: {
        rehabAssignments: [],
        sessions: {
          "activation.base.base-1": {
            day: 6,
            movementOverrides: { "goblet-squat": null },
          },
          "activation.base.base-lss-3": { day: 2, enabled: false },
        },
      },
      armor: {
        rehabAssignments: [
          { day: 0, protocolId: "protocol-1" },
          { day: 5, protocolId: "protocol-2" },
        ],
        sessions: {
          "activation.armor.armor-a1": {
            day: 1,
            movementOverrides: {
              squat: {
                slug: "belt-squat",
                displayName: "Belt Squat",
              },
            },
          },
          "activation.armor.armor-b1": {
            day: 0,
          },
        },
      },
    },
  });

  const { data: sessions, error: sessionsError } = await admin
    .from("planned_sessions")
    .select("id, week_index, day_index, slot, title, role, prescription, completed_session_id")
    .eq("block_id", programInstance!.block_id);
  expect(sessionsError).toBeNull();
  const weekOne = sessions!.filter((session) => session.week_index === 0);
  expect(
    weekOne.find(
      (session) =>
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "base-1",
        ),
    )?.day_index,
  ).toBe(6);
  expect(
    weekOne.some((session) =>
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "base-lss-3",
      ),
    ),
  ).toBe(false);
  expect(weekOne.some((session) => session.role === "rehab")).toBe(false);
  const baseOne = weekOne.find((session) =>
    (session.prescription as { programRef?: string }).programRef?.endsWith(
      "base-1",
    ),
  )!;
  expect(
    (
      baseOne.prescription as {
        items?: Array<{ movementName?: string }>;
      }
    ).items?.some((item) => item.movementName === "Goblet Squat"),
  ).toBe(false);
  const armorWeek = sessions!.filter((session) => session.week_index === 5);
  expect(
    armorWeek.filter((session) => session.day_index === 0).map(
      (session) => [session.role, session.slot],
    ),
  ).toEqual([["strength", "single"]]);
  const combinedArmorSession = armorWeek.find(
    (session) =>
      session.day_index === 0 &&
      session.role === "strength",
  )!;
  const combinedArmorPrescription = combinedArmorSession.prescription as {
    items?: Array<{
      meta?: {
        rehab?: boolean;
        rehabProtocolId?: string;
        rehabPlacement?: string;
      };
    }>;
    meta?: {
      embeddedRehabSections?: Array<{
        protocolId?: string;
        placement?: string;
      }>;
    };
  };
  expect(
    combinedArmorPrescription.items?.some(
      (item) =>
        item.meta?.rehab === true &&
        item.meta.rehabProtocolId === "protocol-1" &&
        item.meta.rehabPlacement === "during_warmup",
    ),
  ).toBe(true);
  expect(combinedArmorPrescription.meta?.embeddedRehabSections).toEqual([
    expect.objectContaining({
      protocolId: "protocol-1",
      placement: "during_warmup",
    }),
  ]);
  expect(
    armorWeek.find(
      (session) =>
        session.day_index === 5 &&
        session.role === "rehab",
    ),
  ).toMatchObject({
    slot: "pm",
    title: "Rehab · Protocol 2",
  });
  const armorA1 = armorWeek.find((session) =>
    (session.prescription as { programRef?: string }).programRef?.endsWith(
      "armor-a1",
    ),
  )!;
  const beltSquat = (
    armorA1.prescription as {
      items?: Array<{
        movementName?: string;
        percentTm?: number;
        targetWeightKg?: number;
      }>;
    }
  ).items?.find((item) => item.movementName === "Belt Squat");
  expect(beltSquat).toMatchObject({
    movementName: "Belt Squat",
  });
  expect(beltSquat?.percentTm).toBeUndefined();
  expect(beltSquat?.targetWeightKg).toBeUndefined();
  expect(
    sessions!.some(
      (session) => session.week_index === 4 && session.role === "rehab",
    ),
  ).toBe(false);
  const mappedPeak = sessions!.find(
    (session) =>
      session.week_index === 13 &&
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "peak-squat",
      ),
  )!;
  const mappedPeakNames = (
    mappedPeak.prescription as {
      items?: Array<{ movementName?: string; kind?: string }>;
    }
  ).items
    ?.filter((item) => item.kind === "main")
    .map((item) => item.movementName);
  expect(mappedPeakNames?.[0]).toBe("Conventional Deadlift");
  expect(mappedPeakNames).not.toContain("Squat");

  const completedPlanned = sessions!.find(
    (session) =>
      session.week_index === 0 &&
      session.day_index === 2 &&
      (session.prescription as { programRef?: string }).programRef?.endsWith(
        "base-2",
      ),
  )!;
  const { data: completedSession, error: completedInsertError } = await admin
    .from("sessions")
    .insert({
      user_id: freshUser.userId,
      performed_at: new Date().toISOString(),
      title: "Completed Base circuit 2",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  expect(completedInsertError).toBeNull();
  const { error: completedLinkError } = await admin
    .from("planned_sessions")
    .update({ completed_session_id: completedSession!.id })
    .eq("id", completedPlanned.id);
  expect(completedLinkError).toBeNull();

  await page.goto(`/app/program?edit=${programInstance!.block_id}`);
  await expect(
    page.locator('input[value="Tactical Barbell - Customized"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // Phases start collapsed on reopen too — the saved state is asserted below,
  // so open Base before reading it.
  await page
    .getByTestId("activation-phase-base")
    .locator(":scope > summary")
    .click();
  await expect(
    page
      .getByTestId("activation-session-activation.base.base-1")
      .getByRole("combobox"),
  ).toHaveValue("6");
  await expect(
    page.getByTestId(
      "activation-movement-activation.base.base-1-ab-triad",
    ),
  ).toContainText(
    "Hanging Leg Raise → Hanging Knee Raise → Toes-to-Bar",
  );
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.base.base-1-goblet-squat",
      )
      .getByText("Removed"),
  ).toBeVisible();
  await page
    .getByTestId("activation-phase-armor")
    .locator(":scope > summary")
    .click();
  await expect(armorSessionCards.nth(0)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-b1",
  );
  await expect(armorSessionCards.nth(1)).toHaveAttribute(
    "data-testid",
    "activation-session-activation.armor.armor-a1",
  );
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.armor.armor-a1-squat",
      )
      .getByText("Belt Squat"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("activation-phase-armor")
      .getByLabel("Armor Mon rehab protocol"),
  ).toHaveValue("protocol-1");
  await expect(
    page
      .getByTestId("activation-phase-armor")
      .getByLabel("Armor Sat rehab protocol"),
  ).toHaveValue("protocol-2");
  await expect(page.getByLabel("Rehab protocol 1 name")).toHaveValue(
    "Protocol 1",
  );
  await expect(
    page
      .getByTestId("activation-session-activation.base.base-lss-3")
      .getByRole("checkbox"),
  ).not.toBeChecked();
  await page
    .getByTestId("activation-session-activation.base.base-1")
    .getByRole("combobox")
    .selectOption("5");
  await page
    .getByTestId("activation-phase-operator")
    .locator(":scope > summary")
    .click();
  await expect(
    page
      .getByTestId(
        "activation-movement-activation.operator.operator-d1-squat",
      )
      .getByText("Conventional Deadlift"),
  ).toBeVisible();
  await page
    .getByTestId("activation-session-activation.operator.operator-d3")
    .getByRole("combobox")
    .selectOption("6");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL("**/app/plan", { timeout: 30_000 });

  const { data: editedSessions, error: editedError } = await admin
    .from("planned_sessions")
    .select("id, week_index, day_index, prescription, completed_session_id")
    .eq("block_id", programInstance!.block_id);
  expect(editedError).toBeNull();
  expect(
    editedSessions!.find(
      (session) =>
        session.week_index === 0 &&
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "base-1",
        ),
    )?.day_index,
  ).toBe(5);
  expect(
    editedSessions!.find(
      (session) =>
        session.week_index === 8 &&
        (session.prescription as { programRef?: string }).programRef?.endsWith(
          "operator-d3",
        ),
    )?.day_index,
  ).toBe(6);
  expect(
    editedSessions!.find(
      (session) => session.id === completedPlanned.id,
    )?.completed_session_id,
  ).toBe(completedSession!.id);
});

test("blocks an untouched canonical Activation movement under an active limitation", async ({
  page,
  context,
  freshUser,
  seedConfig,
  admin,
  baseURL,
}) => {
  await markOnboarded(admin, freshUser.userId);
  const { data: pushup } = await admin
    .from("movements")
    .select("id")
    .eq("slug", "push-up")
    .is("user_id", null)
    .maybeSingle();
  expect(pushup).toBeTruthy();
  const { error: limitationError } = await admin.from("limitations").insert({
    user_id: freshUser.userId,
    severity: "moderate",
    kind: "E2E canonical movement gate",
    affected_movement_ids: [pushup!.id],
  });
  expect(limitationError).toBeNull();
  await signInAs(
    context,
    freshUser,
    seedConfig,
    baseURL ?? "http://localhost:3000",
  );

  await page.goto("/app/program?program=tactical-barbell");
  await page.getByTestId("loadout-opt-activation").click();
  await page.getByText("Customize template").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  const deploy = page.getByRole("button", { name: "Deploy program" });
  await expect(deploy).toBeEnabled();
  await deploy.click();
  await expect(
    page.getByText(/active limitations block.*push/i),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/app\/program/);

  const { count } = await admin
    .from("program_instances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", freshUser.userId);
  expect(count).toBe(0);
});
