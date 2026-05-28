/**
 * BYOAI key audit + ciphertext store.
 *
 * Two tables, both touching BYOAI credentials but with different
 * threat models:
 *
 *   - `byoai_key_events` — append-only audit log. Records that a
 *     user set / rotated / cleared a key. Never stores the key value.
 *     RLS = `user_id = auth.uid()`.
 *
 *   - `byoai_key_secrets` — ciphertext store for the pgcrypto vault
 *     fallback path (see migration 0069 header for why we chose
 *     pgcrypto over Supabase Vault). RLS denies all access to
 *     `authenticated` and `anon`; only `service_role` can read/write
 *     the bytea, and only via the SECURITY DEFINER RPCs `byoai_store_key`,
 *     `byoai_decrypt_key`, `byoai_clear_key`.
 */
import { sql } from "drizzle-orm";
import {
  customType,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type ByoaiKeyAction = "set" | "rotate" | "clear";

export const byoaiKeyEvents = pgTable(
  "byoai_key_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    action: text("action").$type<ByoaiKeyAction>().notNull(),
    provider: text("provider"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userCreatedIdx: index("byoai_key_events_user_created_idx").on(
      t.userId,
      t.createdAt,
    ),
  }),
);

export type ByoaiKeyEvent = typeof byoaiKeyEvents.$inferSelect;
export type NewByoaiKeyEvent = typeof byoaiKeyEvents.$inferInsert;

const bytea = customType<{ data: Uint8Array; default: false }>({
  dataType() {
    return "bytea";
  },
});

export const byoaiKeySecrets = pgTable(
  "byoai_key_secrets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id").notNull(),
    encryptedKey: bytea("encrypted_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => ({
    userIdx: index("byoai_key_secrets_user_idx").on(t.userId),
  }),
);

export type ByoaiKeySecret = typeof byoaiKeySecrets.$inferSelect;
export type NewByoaiKeySecret = typeof byoaiKeySecrets.$inferInsert;
