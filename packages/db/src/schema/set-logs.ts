/**
 * set_logs — per-set strength entries.
 *
 * A set must record SOMETHING (CHECK constraint at SQL level):
 *   - reps × weight_kg (standard strength)
 *   - duration_sec (isometric holds, Baar tendon protocols DC-J4)
 *   - distance_m (sled push / loaded carry)
 *
 * set_kind drives DC-E1 anchor-vs-filler classification at log time.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type { PrescribedSnapshot } from "@hta/domain";

/**
 * ADR 0070 — prescription slot semantics captured at log time, alongside the
 * typed `target_weight_kg` / `target_reps` scalars.
 *
 * This carries what a scalar cannot express, and what the engine needs to judge
 * whether a set "landed as programmed": 5 reps at target weight is not the same
 * result at RIR 2 as at RPE 10, and a discretionary 4th set of a 3–5 cluster is
 * not a missed set. Engine-internal detail, hence JSONB per plan §6.8.
 *
 * The type is owned by `@hta/domain` (the canonical resolver produces it) and
 * re-exported here so storage and derivation cannot drift apart.
 */
export type { PrescribedSnapshot } from "@hta/domain";

export const setKind = pgEnum("set_kind", [
  "warmup",
  "main",
  "back_off",
  "accessory",
  "tendon",
]);

export const setLogs = pgTable(
  "set_logs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionId: uuid("session_id").notNull(),
    movementId: uuid("movement_id").notNull(),
    setIndex: smallint("set_index").notNull(),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    reps: smallint("reps"),
    durationSec: integer("duration_sec"),
    distanceM: integer("distance_m"),
    rpe: numeric("rpe", { precision: 3, scale: 1 }),
    setKind: setKind("set_kind").default("main").notNull(),
    percentOfTm: numeric("percent_of_tm", { precision: 5, scale: 2 }),
    notes: text("notes"),
    // Index into the planned_session.prescription.items array that this
    // set was logged against (when the user tapped a prescription row to
    // prefill the logger). Null for free-form / legacy logs and for
    // sessions with no linked plan. See migration
    // 0036_set_logs_prescription_link.sql.
    prescriptionItemIndex: smallint("prescription_item_index"),
    // Migration 0037: per-set skip with reason. Skipped rows still occupy
    // a slot in the dot strip / "covered" count, but never contribute to
    // tonnage, PR detection, or e1RM. CHECK constraint at the SQL layer
    // restricts the reason to the picker's chip allowlist.
    skipped: boolean("skipped").default(false).notNull(),
    skipReason: text("skip_reason"),
    // Offline-logging idempotency key (migration 0097). Client-generated UUID
    // set on the outbox path BEFORE the network write; the server upserts ON
    // CONFLICT DO NOTHING so a retried flush can't double-insert. NULL on the
    // regular online path and on legacy rows (partial-unique, NULLs coexist).
    clientLogId: uuid("client_log_id"),
    // ADR 0074 — actual added or assisted load for a bodyweight set. This is
    // separate from weight_kg, which records the standard strength load.
    externalLoadKg: numeric("external_load_kg", { precision: 6, scale: 2 }),
    // ADR 0070 (migration 0128) — prescribed-vs-actual snapshot. These record
    // what the app ASKED for; the columns above record what the user DID.
    //
    // Written once at log time from the values the user actually SAW (the
    // client submits them; the server validates but never re-derives, because
    // re-resolving at insert reads current TM / modification state and would
    // persist numbers that were never on screen after an offline replay).
    //
    // Immutable after insert, enforced by the `set_logs_freeze_prescribed`
    // trigger — RLS grants table-wide UPDATE, so convention is not enough.
    //
    // NULL means "unknown, no deviation inferable": free-form logs, off-plan
    // sets, HYROX race rows, and every row predating migration 0128 (no
    // backfill is possible — see the migration header).
    targetWeightKg: numeric("target_weight_kg", { precision: 6, scale: 2 }),
    targetReps: smallint("target_reps"),
    prescribed: jsonb("prescribed").$type<PrescribedSnapshot>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    // Migration 0053 — composite history index. Backs PR detection and
    // movement-history queries that filter by movement_id and scan
    // recent rows first. set_logs has no `performed_at` column (that
    // lives on the joined `sessions` row), so we order by `created_at`
    // — which is set at insert time and tracks `sessions.performed_at`
    // closely in practice. Replaces the per-movement-only
    // `set_logs_movement_idx` for ordered scans (the older index is
    // kept; both are cheap).
    movementCreatedAtIdx: index("set_logs_movement_created_at_idx").on(
      t.movementId,
      t.createdAt.desc(),
    ),
    // Migration 0097 — unique idempotency key for offline replay (nullable;
    // NULLs are distinct in Postgres so legacy/online rows coexist).
    clientLogIdKey: uniqueIndex("set_logs_client_log_id_key").on(t.clientLogId),
  }),
);

export const setLogInsert = createInsertSchema(setLogs);
export const setLogSelect = createSelectSchema(setLogs);
export type SetLog = typeof setLogs.$inferSelect;
export type NewSetLog = typeof setLogs.$inferInsert;
export type SetKind = (typeof setKind.enumValues)[number];

export const SKIP_REASONS = ["pain", "fatigue", "time", "equipment", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
