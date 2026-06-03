/**
 * profiles — app-level user data, 1:1 with auth.users.
 *
 * Per plan §4.3: don't extend the auth table; create a sibling row.
 * RLS policy: `USING (id = auth.uid())`.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
  numeric,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/** DC-F11 + DC-Q2: declared body-composition phase. */
export const bodyCompPhase = pgEnum("body_comp_phase", [
  "gain",
  "maintain",
  "lean_out",
]);

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name"),
  timezone: text("timezone").default("UTC").notNull(),
  units: text("units").default("metric").notNull(),
  bodyweightKg: numeric("bodyweight_kg", { precision: 6, scale: 2 }),
  bodyCompPhase: bodyCompPhase("body_comp_phase").default("maintain").notNull(),
  phaseStartedAt: date("phase_started_at"),
  phaseTargetWeeks: smallint("phase_target_weeks"),
  /** Default % of 1RM used as the training max when no per-movement override is set. */
  tmPercentDefault: numeric("tm_percent_default", { precision: 4, scale: 1 })
    .default("90.0")
    .notNull(),
  /** How many days/week the user can realistically train. Drives archetype fit. */
  trainingDaysPerWeek: smallint("training_days_per_week").default(4).notNull(),
  /** When the first-run onboarding wizard finished or was skipped. null = show wizard. */
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  /**
   * When the bodyweight-only onboarding assessment was last completed.
   * NULL = never run (engine can use this to invite the user to
   * calibrate). Updated by `submitBwAssessment` after seeding
   * bw_progress rows; intentionally decoupled from `onboardedAt` so
   * the user can re-open the assessment from settings later without
   * re-running the rest of the wizard. See migration 0043.
   */
  bwAssessmentCompletedAt: timestamp("bw_assessment_completed_at", {
    withTimezone: true,
  }),
  /**
   * Self-reported training age, captured at onboarding. Drives DC-G5
   * (cold-start tier): the lowest two declared buckets (beginner_lt_6m,
   * novice_6m_2y) map to the consumer load tier on the first block; the
   * mid bucket maps to intermediate; the two top buckets map to
   * high_performance. See `packages/engine/src/tier-detection.ts` for
   * the declared → engine-tier projection.
   *
   * Constrained at DB level to {beginner_lt_6m, novice_6m_2y,
   * intermediate_2y_5y, advanced_5y_10y, highly_advanced_10y_plus};
   * null = unknown. See migration 0052.
   */
  trainingExperience: text("training_experience"),
  /**
   * User is open to occasional two-a-day sessions (AM lift + PM cardio).
   * Engine support is deferred; this only records the preference for now.
   * See research-new §interference: ≥6h gap between modalities respects AMPK/mTORC1.
   */
  allowsTwoADays: boolean("allows_two_a_days").default(false).notNull(),
  /** Default AM-session window (used when planned_at is unset). */
  amWindowStart: time("am_window_start").default("07:00").notNull(),
  amWindowEnd: time("am_window_end").default("09:00").notNull(),
  /** Default PM-session window. */
  pmWindowStart: time("pm_window_start").default("17:00").notNull(),
  pmWindowEnd: time("pm_window_end").default("19:00").notNull(),
  intake: jsonb("intake").$type<Record<string, unknown>>().default({}).notNull(),
  /**
   * Phase 3 C1 — short haptic tick on set save when supported. Default
   * TRUE; the Web Vibration API silently no-ops on browsers that don't
   * expose it (Safari iOS).
   */
  hapticsEnabled: boolean("haptics_enabled").default(true).notNull(),
  /**
   * Phase 3 C2 — short tone at rest-timer = 0. Default TRUE; gated by
   * the first user gesture per browser autoplay policy.
   */
  timerSoundEnabled: boolean("timer_sound_enabled").default(true).notNull(),
  /**
   * ADR 0026 — antagonist-superset accessories opt-in. When TRUE, the planner
   * pairs opposing accessory movements (e.g. biceps curl + triceps pushdown)
   * into supersets so the lifter rests once per round instead of twice — a
   * shorter session at preserved volume (Robbins 2010; Weakley 2020). An
   * execution style applied to all blocks (like haptics / timer-sound), NOT a
   * programming choice. Pairing is a post-selection annotation layer: it never
   * changes which accessories are prescribed, only how they group + the
   * displayed time. DEFAULT FALSE reproduces today's output byte-identical —
   * the pairing pass is never invoked. See migration 0084 +
   * `apps/web/src/lib/planner/antagonist-pairs.ts`.
   */
  supersetAccessories: boolean("superset_accessories")
    .default(false)
    .notNull(),
  /**
   * Phase 3 today-redesign — controls whether the Today page renders
   * the inline 1/3/5/7/9 fatigue + soreness `HowRecoveredCard`. The
   * card is the only manual check-in surface (the pre-session
   * interstitial was removed). Default TRUE; setting it to FALSE
   * hides the card entirely without affecting the `wellness` table
   * or the underlying `recordDailyCheckIn` server action.
   * See migration 0049.
   */
  showTodayRecoveryCard: boolean("show_today_recovery_card")
    .default(true)
    .notNull(),
  /**
   * Free-text training profile notes. Writable by both the user (from
   * the /app/profile page) and — once the AI surface lands — the
   * engine, which will append pattern observations the user can prune.
   * Default NULL; no length cap at DB level (server actions trim/limit).
   */
  aiNotes: text("ai_notes"),
  /**
   * Mass of the user's primary Olympic barbell, in kg. Drives the
   * plate-per-side breakdown rendered by the session logger. Default
   * 20.00 kg (standard men's bar).
   */
  barbellKg: numeric("barbell_kg", { precision: 5, scale: 2 })
    .default("20.00")
    .notNull(),
  /**
   * Mass of the user's trap/hex bar, in kg. Movements whose slug
   * contains `trap_bar` / `hex_bar` resolve to this value at the
   * render boundary. Default 25.00 kg.
   */
  trapBarKg: numeric("trap_bar_kg", { precision: 5, scale: 2 })
    .default("25.00")
    .notNull(),
  /**
   * Plate inventory: an array of `{ weight_kg, pair_count }` rows.
   * Always stored in kg — the UI converts at the render boundary
   * when `units = 'imperial'`. Default mirrors a sensible Olympic
   * plate set.
   */
  /**
   * Warmup-ladder configuration. NULL is treated as the default
   * `{ setCount: 3, percentLadder: [40, 50, 60], repLadder: [5, 3, 2] }`
   * at read time. `setCount = 0` disables auto-warmups entirely.
   *
   * Ladders are the practitioner-consensus ramp pattern: rehearse the
   * motor pattern at light loads, then ramp so connective tissue
   * acclimates before the first working set (Baar 2017 tendon-adaptation
   * literature on submaximal exposure prior to heavy loading).
   */
  warmupScheme: jsonb("warmup_scheme").$type<{
    setCount: number;
    percentLadder: number[];
    repLadder: number[];
  }>(),
  plateInventoryKg: jsonb("plate_inventory_kg")
    .$type<Array<{ weight_kg: number; pair_count: number }>>()
    .default(
      sql`'[
        {"weight_kg": 25,   "pair_count": 2},
        {"weight_kg": 20,   "pair_count": 2},
        {"weight_kg": 15,   "pair_count": 1},
        {"weight_kg": 10,   "pair_count": 2},
        {"weight_kg": 5,    "pair_count": 2},
        {"weight_kg": 2.5,  "pair_count": 2},
        {"weight_kg": 1.25, "pair_count": 2}
      ]'::jsonb`,
    )
    .notNull(),
  /**
   * Rich equipment inventory — bars, plates, dumbbells, kettlebells,
   * machines, cardio kit, accessories. Nullable: NULL falls back at
   * read time (see `resolveEquipment` in
   * `apps/web/src/lib/settings/equipment-presets.ts`) to either the
   * Commercial-gym preset (no legacy data) or a "custom" shape
   * synthesised from the legacy `barbell_kg`/`trap_bar_kg`/
   * `plate_inventory_kg` columns.
   *
   * Schema (kept loose at the DB layer — validated in the server
   * action, typed in the editor):
   *   {
   *     preset, bars: { barbellKg, trapBarKg, safetyBarKg },
   *     plates: number[], dumbbells: { minKg, maxKg, stepKg } | null,
   *     kettlebells: number[], machines: string[], cardio: string[],
   *     accessories: { ... },
   *   }
   */
  equipment: jsonb("equipment").$type<Record<string, unknown>>(),
  /**
   * Wall-clock time-format preference. NULL = derive from locale at
   * read time (see `resolveTimeFormat` in
   * `apps/web/src/lib/format/datetime.ts`). Constrained at DB level
   * to {'12h', '24h'}.
   */
  timeFormat: text("time_format"),
  /**
   * Calendar-date format preference. NULL = derive from locale at
   * read time (see `resolveDateFormat`). Constrained at DB level to
   * {'iso', 'dmy_long', 'mdy_long', 'dmy_short', 'mdy_short'}.
   */
  dateFormat: text("date_format"),
  /**
   * Block-wizard per-archetype × per-session-count day-of-week pattern.
   * Shape mirrors the legacy `hta-day-pref-v2` localStorage payload
   * exactly:
   *
   *   { byArchetype: { [archetypeId]: { [sessionCount]:
   *     { days: number[]; twoADay: boolean } } } }
   *
   * NULL on accounts that have never opened the wizard, or pre-0055
   * accounts whose pref still lives in localStorage; the wizard
   * falls back to localStorage in that case and writes to both on
   * the next save. See migration 0055 + `hybrid-sync-audit.md` §3b.
   */
  wizardDayPref: jsonb("wizard_day_pref").$type<{
    byArchetype: Record<
      string,
      Record<string, { days: number[]; twoADay: boolean }>
    >;
  }>(),
  /**
   * 7-day snooze timestamp for the Today-page bodyweight nudge.
   * NULL = never dismissed; visible while now() ≥ value. See
   * migration 0055 + `hybrid-sync-audit.md` §3c.
   */
  bwNudgeHiddenUntil: timestamp("bw_nudge_hidden_until", {
    withTimezone: true,
  }),
  /**
   * Permanent dismissal timestamp for the bodyweight-only early-support
   * banner. NULL = still visible (current behaviour). See migration
   * 0055 + `hybrid-sync-audit.md` §3c.
   */
  bwBannerDismissedAt: timestamp("bw_banner_dismissed_at", {
    withTimezone: true,
  }),
  /**
   * High-water mark for the TopBar bell's "mark all read" gesture.
   * The audit-count query filters
   * `engine_override_events.occurred_at > audit_last_read_at`. NULL
   * means "every audit row counts as unread" — matches the pre-0055
   * behaviour where the badge always showed the full count. See
   * migration 0055 + `hybrid-sync-audit.md` §3d.
   */
  auditLastReadAt: timestamp("audit_last_read_at", {
    withTimezone: true,
  }),
  /**
   * Phase 1 "external cardio" — global default for new blocks. When
   * 'external', the wizard pre-checks the "Follow an external run
   * program" toggle so the user doesn't have to re-pick it every block.
   * Changing this never touches existing blocks (they keep whatever
   * `training_blocks.cardio_source` they were created with). Default
   * 'internal' preserves legacy behaviour. See migration 0064.
   */
  preferredCardioSource: text("preferred_cardio_source")
    .default("internal")
    .notNull(),
  /** Free-text label for the user's preferred external program (e.g. "Runna"). */
  preferredCardioSourceName: text("preferred_cardio_source_name"),
  /**
   * ADR 0016 — user-facing effort / volume dial for the hypertrophy
   * archetype. CHECK-constrained to {'low','standard','high'}. Scales the
   * hypertrophy compound effort anchor (early-set bump + final-set RIR) and
   * the accessory sets-per-movement at block-creation time. DEFAULT
   * 'standard' keeps every existing row byte-identical. No-op for all other
   * archetypes. See migration 0080.
   */
  effortPreference: text("effort_preference").default("standard").notNull(),
  /**
   * ADR 0017 — ranked cardio-modality preference. An ORDERED allow-list
   * (index 0 = first choice) of catalog modalities the planner substitutes
   * the default running cardio toward at block-creation time, holding the
   * prescribed intensity (cardioKind) constant. NULL/empty reproduces the
   * pre-ADR-0017 prescription byte-identical (everyone keeps running).
   * Equipment is a filter on top; running is the terminal fallback. CHECK-
   * constrained to the catalog modality vocabulary. See migration 0081 and
   * `apps/web/src/lib/planner/preferred-cardio-modality.ts`.
   */
  preferredCardioModalities: text("preferred_cardio_modalities").array(),
  /**
   * Which BYOAI provider the stored key targets. CHECK-constrained
   * at the DB level to {'anthropic','openai','gemini'} or null. See
   * migration 0069.
   */
  byoaiProvider: text("byoai_provider"),
  /**
   * Opaque reference into the secret store — the UUID of the row in
   * `byoai_key_secrets` (pgcrypto fallback path) or, if/when Supabase
   * Vault lands, the Vault entry ID. NEVER exposed to client code;
   * `apps/web/src/lib/ai/vault.ts` is the only module that reads it.
   */
  byoaiKeyVaultId: text("byoai_key_vault_id"),
  /**
   * Reserved for a future one-time-payment unlock. Default `now()`
   * means every free-tier user is treated as unlocked today (the
   * gate is purely the opt-in + provider + key trio). See `hasAiAccess`.
   */
  byoaiUnlockedAt: timestamp("byoai_unlocked_at", { withTimezone: true })
    .default(sql`now()`),
  createdAt: timestamp("created_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
});

export const profileInsert = createInsertSchema(profiles);
export const profileSelect = createSelectSchema(profiles);

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type BodyCompPhase = (typeof bodyCompPhase.enumValues)[number];
