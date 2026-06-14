/**
 * Schema column-contract for the session-materialisation queries.
 *
 * These server actions build PostgREST `.select(...)` / insert payloads with
 * raw string column names, which are NOT typechecked — a typo or a column
 * rename (e.g. the `training_maxes.value_kg` regression that silently zeroed
 * materialised set weights and broke the Quick Workout "Generate" button) only
 * surfaces at runtime against the real DB.
 *
 * This test validates the exact columns those queries depend on against the
 * live Drizzle schema (the source of truth, kept in lockstep with migrations),
 * so the class of bug fails in normal CI — no database connection required.
 *
 * When a query intentionally changes columns, update the contract below; that
 * is the deliberate review gate.
 */
import { describe, it, expect } from "vitest";
import {
  trainingMaxes,
  profiles,
  setLogs,
  trainingBlocks,
  plannedSessions,
  sessions,
  programInstances,
} from "@hta/db";
import { TM_RESOLUTION_COLUMNS } from "@/lib/training-maxes/columns";

// Drizzle stores a table's columns under this stable symbol (what
// `getTableColumns` reads). Accessed directly so this test needs no
// `drizzle-orm` dependency in the web package.
const DRIZZLE_COLUMNS = Symbol.for("drizzle:Columns");

function dbColumnNames(table: unknown): Set<string> {
  const cols = (table as Record<symbol, Record<string, { name: string }>>)[
    DRIZZLE_COLUMNS
  ];
  return new Set(Object.values(cols).map((c) => c.name));
}

type Contract = {
  name: string;
  table: unknown;
  columns: readonly string[];
};

const CONTRACTS: Contract[] = [
  {
    // fillSessionFromPlan + quick-generate-resolve TM lookup. Shared constant
    // so the query and this test can never drift apart.
    name: "training-max resolution",
    table: trainingMaxes,
    columns: [...TM_RESOLUTION_COLUMNS, "user_id"],
  },
  {
    name: "profile TM% default",
    table: profiles,
    columns: ["tm_percent_default"],
  },
  {
    // The set_logs insert shape both materialisation paths write.
    name: "set_logs materialisation insert",
    table: setLogs,
    columns: [
      "session_id",
      "movement_id",
      "set_index",
      "set_kind",
      "weight_kg",
      "reps",
      "prescription_item_index",
    ],
  },
  {
    name: "planned_sessions fill source",
    table: plannedSessions,
    columns: ["prescription", "week_index", "day_index", "completed_session_id"],
  },
  {
    // The off-plan prescription source for the session detail page (ADR 0029).
    name: "sessions off-plan prescription",
    table: sessions,
    columns: ["prescription", "completed_at", "deleted_at"],
  },
  {
    // quick-generate-resolve archetype context.
    name: "training_blocks quick-generate context",
    table: trainingBlocks,
    columns: [
      "user_id",
      "archetype",
      "focus_muscles",
      "secondary_focus",
      "accessory_volume",
      "status",
      "started_on",
      "deleted_at",
    ],
  },
  {
    // quick-generate-resolve program-aware context (Hybrid focus muscles live on
    // the serialised instance, not training_blocks).
    name: "program_instances quick-generate context",
    table: programInstances,
    columns: ["user_id", "program_id", "instance", "status", "deleted_at"],
  },
  {
    // insert_deload_week RPC (0106) writes these planned_sessions columns via raw
    // SQL — not typechecked, so pin them here. A rename must break CI.
    name: "deload-week RPC insert",
    table: plannedSessions,
    columns: [
      "block_id",
      "user_id",
      "week_index",
      "day_index",
      "slot",
      "title",
      "role",
      "prescription",
      "session_modality",
      "completed_session_id",
    ],
  },
];

describe("session materialisation — column contract", () => {
  for (const c of CONTRACTS) {
    it(`${c.name}: every selected column exists in the schema`, () => {
      const cols = dbColumnNames(c.table);
      for (const col of c.columns) {
        expect(cols.has(col), `missing column "${col}" on ${c.name}`).toBe(true);
      }
    });
  }

  it("training_maxes has no `value_kg` column (the regression that broke materialisation)", () => {
    // Pins the exact bug: the TM weight lives in `one_rm_kg` (× tm_percent),
    // never a `value_kg` column. If this ever flips, the query string typo is
    // back.
    expect(dbColumnNames(trainingMaxes).has("value_kg")).toBe(false);
    expect(dbColumnNames(trainingMaxes).has("one_rm_kg")).toBe(true);
  });
});
