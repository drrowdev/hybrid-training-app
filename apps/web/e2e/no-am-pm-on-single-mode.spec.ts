import { test, expect } from "./fixtures/seed";
import { signInAs } from "./fixtures/auth";
import { markOnboarded } from "./fixtures/seed-blocks";

/**
 * Regression spec for feat/slot-semantics.
 *
 * Builds a Hypertrophy block whose planned sessions all live on
 * distinct calendar days (no pairing). The user's
 * `allows_two_a_days` preference is left at its default (false).
 *
 * Asserts: across the Month / Timeline / List views, AND in the
 * per-day cards rendered further down the plan page, NO "AM" or "PM"
 * badge is rendered and NO planned-session title contains "(AM)" or
 * "(PM)". A single session that happens to carry a stray AM/PM slot
 * tag from upstream (defensive guard in case of future drift) must
 * still render badgeless when its calendar day has no partner.
 */
test.describe("@desktop /app/plan — no AM/PM badges on single-session blocks", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Chromium-only");

  test("hypertrophy block with single-session mode shows no AM/PM badges or title suffixes", async ({
    page,
    context,
    freshUser,
    seedConfig,
    admin,
    baseURL,
  }) => {
    await markOnboarded(admin, freshUser.userId);

    // Anchor the block on this week's Monday so the "current week"
    // view renders sessions in the visible grid.
    const today = new Date();
    const day = today.getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + mondayOffset),
    );
    const startedOn = monday.toISOString().slice(0, 10);

    // Create the block directly — bypasses the wizard but exercises
    // the same downstream queries / rendering.
    const { data: block, error: blockErr } = await admin
      .from("training_blocks")
      .insert({
        user_id: freshUser.userId,
        archetype: "hypertrophy_anchor",
        started_on: startedOn,
        weeks: 4,
        status: "active",
        days_per_week: 5,
      })
      .select("id")
      .single();
    if (blockErr || !block) {
      throw new Error(`seed block failed: ${blockErr?.message ?? "no row"}`);
    }

    // Five distinct calendar days. The first row mimics a leftover
    // PM tag from upstream (worst case) — the render gate must
    // still ignore it because no partner exists on that day.
    const rows = [
      {
        block_id: block.id,
        user_id: freshUser.userId,
        week_index: 0,
        day_index: 0,
        slot: "pm",
        title: "Easy Z2",
        role: "easy_z2",
        prescription: { items: [{ kind: "cardio_z2", durationMin: 30 }] },
      },
      {
        block_id: block.id,
        user_id: freshUser.userId,
        week_index: 0,
        day_index: 1,
        slot: "single",
        title: "Bench — hypertrophy",
        role: "horizontal_press",
        prescription: { items: [{ kind: "main", sets: 4, reps: 8 }] },
      },
      {
        block_id: block.id,
        user_id: freshUser.userId,
        week_index: 0,
        day_index: 2,
        slot: "single",
        title: "Easy Z2",
        role: "easy_z2",
        prescription: { items: [{ kind: "cardio_z2", durationMin: 40 }] },
      },
      {
        block_id: block.id,
        user_id: freshUser.userId,
        week_index: 0,
        day_index: 3,
        slot: "single",
        title: "Deadlift — hypertrophy",
        role: "deadlift",
        prescription: { items: [{ kind: "main", sets: 4, reps: 8 }] },
      },
      {
        block_id: block.id,
        user_id: freshUser.userId,
        week_index: 0,
        day_index: 4,
        slot: "single",
        title: "Overhead press — hypertrophy",
        role: "vertical_press",
        prescription: { items: [{ kind: "main", sets: 4, reps: 8 }] },
      },
    ];
    const { error: psErr } = await admin.from("planned_sessions").insert(rows);
    if (psErr) throw new Error(`seed planned_sessions failed: ${psErr.message}`);

    await signInAs(context, freshUser, seedConfig, baseURL ?? "http://localhost:3000");

    // Helper: assert no slot badge / AM-PM title suffix is rendered.
    // We check three signals:
    //   1. No DayCard slot label (data-testid="day-card-slot-label").
    //   2. No CalendarItem `slotBadge` (rendered as a span with
    //      aria-label "morning session" / "evening session").
    //   3. No "(AM)" / "(PM)" parenthetical anywhere in the main
    //      region's visible text.
    const assertNoAmPm = async (label: string) => {
      await expect(
        page.getByTestId("day-card-slot-label"),
        `${label}: no DayCard slot label`,
      ).toHaveCount(0);
      await expect(
        page.getByLabel("morning session"),
        `${label}: no AM slotBadge`,
      ).toHaveCount(0);
      await expect(
        page.getByLabel("evening session"),
        `${label}: no PM slotBadge`,
      ).toHaveCount(0);
      const text = (await page.locator("main").innerText()) ?? "";
      expect(text, `${label}: no (AM)/(PM) title suffix`).not.toMatch(/\((?:AM|PM)\)/);
    };

    // ── Month view ─────────────────────────────────────────────────
    await page.goto("/app/plan?view=month");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-month-grid")).toBeVisible();
    await assertNoAmPm("month view");

    // ── Timeline view (default) ────────────────────────────────────
    await page.goto("/app/plan?view=timeline");
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("plan-timeline")).toBeVisible();
    await assertNoAmPm("timeline view");

    // The List view was removed in the /plan redesign — its coverage
    // is folded into the Timeline view assertion above.
  });
});
