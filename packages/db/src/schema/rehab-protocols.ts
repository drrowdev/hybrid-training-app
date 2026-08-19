/**
 * rehab_protocols — the user's reusable rehab library, plus the bindings that
 * attach a library protocol to a program instance.
 *
 * Rehab used to exist only INSIDE a program: the protocol definition lived in
 * `program_instances.setup_input.customization`, so the same clinician-supplied
 * protocol had to be retyped for every program, and editing it meant re-running
 * the wizard. The library makes a protocol a first-class row the user authors
 * once in Settings.
 *
 * WHY A SEPARATE BINDING TABLE rather than writing the library id into the
 * customization blob:
 *
 *   1. That blob is `.strict()`-validated by Zod. Adding a key to it means an
 *      app instance running the previous build rejects the whole customization
 *      — and `edit-context.ts` `safeParse`s it, so the failure is SILENT: the
 *      wizard would open with the user's rehab configuration missing. A rolling
 *      deploy guarantees both builds are live at once.
 *   2. A real foreign key makes "you can't delete a protocol a program is using"
 *      a database guarantee instead of a check-then-delete race.
 *   3. The legacy V1/V2 customizations have no named-protocol array to write an
 *      id into at all; they carry one unnamed item list under the synthetic id
 *      `protocol-1`. A binding row addresses them the same way as V3.
 *
 * Consequence: the customization blob is never rewritten by this feature, so
 * every deployed program keeps parsing exactly as it does today.
 *
 * The library is authoritative for a protocol's CONTENT (its movements and
 * their superset grouping). The program's customization stays authoritative for
 * PLACEMENT (which phase and weekday it runs on) — the same protocol
 * legitimately sits on different days in different programs.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { programInstances } from "./program-instances";

/**
 * One movement entry of a protocol. Mirrors the shape the wizard has always
 * persisted (`rehabItemSchema` in apps/web/src/lib/platform/tb-customization.ts)
 * so a migrated protocol is byte-identical to what it replaced.
 */
export type RehabProtocolItem = {
  movementId: string;
  movementName: string;
  side?: "both" | "left" | "right";
  sets: number;
  reps?: number;
  holdSeconds?: number;
  targetWeightKg?: number;
  instructions?: string;
};

/**
 * A superset/circuit grouping over the protocol's own movements. Same shape as
 * a `SessionLink` (apps/web/src/lib/platform/session-links.ts). Links live with
 * the protocol because how its movements pair up is intrinsic to the protocol,
 * not to the program that runs it.
 */
export type RehabProtocolLink = {
  id: string;
  kind: string;
  members: string[];
  rounds?: number;
  name?: string;
};

/**
 * Everything definitional about a protocol. Held as one blob per the schema
 * discipline in AGENTS.md §6.8: nothing removes an individual item, and the
 * items are not observable outside the engine, so they don't earn top-level
 * columns. `name` IS top-level — it's listed, sorted and searched in the UI.
 */
export type RehabProtocolDefinition = {
  items: RehabProtocolItem[];
  links: RehabProtocolLink[];
};

export const rehabProtocols = pgTable(
  "rehab_protocols",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    definition: jsonb("definition").$type<RehabProtocolDefinition>().notNull(),
    /**
     * Bumped on every content change. The sync path reads it before recomputing
     * and re-checks it inside the write transaction, so two Settings tabs saving
     * at once can't fan out conflicting definitions to the same program.
     */
    revision: integer("revision").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userIdx: index("rehab_protocols_user_idx").on(t.userId),
  }),
);

/**
 * Attaches one library protocol to one protocol slot of one program instance.
 *
 * `localProtocolId` is the id the customization already uses for that slot
 * (`protocol-1`, `protocol-2`, … or the synthetic `protocol-1` for legacy V1/V2
 * blobs). Keeping the local id means `sessionLinks` keys (`rehab.<localId>`),
 * `rehabAssignments[].protocolId` and the `rehabSourceRef` already written into
 * materialised sessions all keep resolving unchanged.
 */
export const programRehabBindings = pgTable(
  "program_rehab_bindings",
  {
    programInstanceId: uuid("program_instance_id")
      .notNull()
      .references(() => programInstances.id, { onDelete: "cascade" }),
    localProtocolId: text("local_protocol_id").notNull(),
    /**
     * RESTRICT, not CASCADE: deleting a protocol a live program depends on must
     * fail loudly rather than quietly emptying that program's rehab.
     */
    rehabProtocolId: uuid("rehab_protocol_id")
      .notNull()
      .references(() => rehabProtocols.id, { onDelete: "restrict" }),
    /** Denormalised for RLS — a policy can't traverse the FK cheaply. */
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.programInstanceId, t.localProtocolId] }),
    protocolIdx: index("program_rehab_bindings_protocol_idx").on(t.rehabProtocolId),
    userIdx: index("program_rehab_bindings_user_idx").on(t.userId),
  }),
);

export type RehabProtocolRow = typeof rehabProtocols.$inferSelect;
export type NewRehabProtocolRow = typeof rehabProtocols.$inferInsert;
export type ProgramRehabBindingRow = typeof programRehabBindings.$inferSelect;
export type NewProgramRehabBindingRow = typeof programRehabBindings.$inferInsert;
