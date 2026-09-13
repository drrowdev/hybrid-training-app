import { createHash } from "node:crypto";
import { z } from "zod";
import { PRODUCTION, requireInspection } from "./swim-production-readonly-guards";

const tag = z.string().regex(/^\d{4}_[A-Za-z0-9_-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.union([z.string().regex(/^\d{1,16}$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const row = z.object({
  id: z.number().int().positive(), hash: z.string().max(1024).nullable(),
  created_at: z.union([z.string().max(64), z.number().finite(), z.null()]),
}).strict();
export type SourceMigration = { tag: string; hash: string; folderMillis: number };
type Git = (args: string[], input?: string) => Buffer;
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");

export function historicalMigrationHashes(git: Git) {
  const listing = git(["rev-list", "--objects", PRODUCTION.main, "--", "packages/db/drizzle"]).toString("utf8");
  requireInspection(listing.length <= 1024 * 1024, "history_bound");
  const entries = listing.split("\n").flatMap((line) => {
    const match = /^([a-f0-9]{40}) packages\/db\/drizzle\/(\d{4}_[A-Za-z0-9_-]+)\.sql$/.exec(line);
    return match ? [{ oid: match[1]!, tag: match[2]! }] : [];
  });
  requireInspection(entries.length >= PRODUCTION.mainCount && entries.length <= 192 &&
    new Set(entries.map((entry) => entry.oid)).size === entries.length, "history_bound");
  const content = git(["cat-file", "--batch"], entries.map((entry) => entry.oid).join("\n") + "\n");
  requireInspection(content.length <= 2 * 1024 * 1024, "history_bound");
  const known = new Map<string, Set<string>>();
  let offset = 0;
  for (const entry of entries) {
    const newline = content.indexOf(10, offset);
    requireInspection(newline > offset && newline - offset <= 80, "history_shape");
    const header = /^([a-f0-9]{40}) blob (\d+)$/.exec(content.subarray(offset, newline).toString("ascii"));
    requireInspection(header && header[1] === entry.oid, "history_shape");
    const size = Number(header[2]), start = newline + 1, end = start + size;
    requireInspection(Number.isSafeInteger(size) && size > 0 && size <= 128 * 1024 &&
      end < content.length && content[end] === 10, "history_bound");
    const raw = content.subarray(start, end);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    const lf = text.replace(/\r\n/g, "\n");
    for (const value of [raw, Buffer.from(lf), Buffer.from(lf.replace(/\n/g, "\r\n"))]) {
      const key = digest(value), tags = known.get(key) ?? new Set<string>();
      tags.add(entry.tag); known.set(key, tags);
    }
    offset = end + 1;
  }
  requireInspection(offset === content.length, "history_shape");
  return { blobs: entries.length, hashes: known };
}

export function productionHistoryInventory(raw: unknown, source: readonly SourceMigration[],
  history: ReturnType<typeof historicalMigrationHashes>) {
  requireInspection(source.length === PRODUCTION.candidateCount &&
    source.every((entry) => tag.safeParse(entry.tag).success && hash.safeParse(entry.hash).success &&
      Number.isSafeInteger(entry.folderMillis)) &&
    new Set(source.map((entry) => entry.hash)).size === source.length, "source_journal");
  const parsed = z.array(row).max(512).safeParse(raw);
  requireInspection(parsed.success, "ledger_inventory_shape");
  const entries = parsed.data;
  const stamps = entries.map((entry) => timestamp.safeParse(entry.created_at));
  const validStamps = stamps.flatMap((entry) => entry.success ? [BigInt(entry.data)] : []);
  const latest = validStamps.reduce<bigint | null>((value, next) => value === null || next > value ? next : value, null);
  const byHash = new Map(source.map((entry) => [entry.hash, entry]));
  const wellFormed = entries.flatMap((entry) => {
    const parsedHash = hash.safeParse(entry.hash);
    return parsedHash.success ? [{ ...entry, hash: parsedHash.data }] : [];
  });
  const current = source.map((migration) => {
    const canonical = entries.filter((entry) => entry.hash === migration.hash);
    return {
      tag: migration.tag, canonicalRows: canonical.length,
      canonicalTimestampRows: canonical.filter((entry) => String(entry.created_at) === String(migration.folderMillis)).length,
      historicalVariantRows: wellFormed.filter((entry) => !byHash.has(entry.hash) &&
        history.hashes.get(entry.hash)?.has(migration.tag)).length,
      newerThanLatest: latest !== null && validStamps.length === entries.length ? BigInt(migration.folderMillis) > latest : null,
    };
  });
  return {
    rowsRead: entries.length, complete: entries.length < 512,
    fingerprint: digest(JSON.stringify(entries)),
    sourceHistoryBlobs: history.blobs,
    malformedHashRows: entries.length - wellFormed.length,
    duplicateHashRows: wellFormed.length - new Set(wellFormed.map((entry) => entry.hash)).size,
    invalidTimestampRows: entries.length - validStamps.length,
    historicalOnlyRows: wellFormed.filter((entry) => !byHash.has(entry.hash) && history.hashes.has(entry.hash)).length,
    unmatchedHashRows: wellFormed.filter((entry) => !byHash.has(entry.hash) && !history.hashes.has(entry.hash)).length,
    current,
    productionReady: false,
  };
}

export const SWIM_SCHEMA_TABLES = ["swim_plans", "swim_workouts", "swim_connections", "swim_imports", "swim_import_matches"] as const;
export const SWIM_SCHEMA_FUNCTIONS = [
  "swim_storage_ready", "swim_request_user_id", "swim_import_storage_ready", "swim_pool_editing_ready",
  "swim_private_course_ready", "swim_import_matching_ready", "swim_untimed_course_ready",
] as const;
export const SCHEMA_TABLE_SQL = `
SELECT wanted.name,
  c.oid IS NOT NULL AS present,
  CASE WHEN c.oid IS NOT NULL THEN c.relrowsecurity ELSE NULL END AS rls,
  CASE WHEN c.oid IS NOT NULL THEN c.relforcerowsecurity ELSE NULL END AS forced,
  EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid
    AND a.attname = 'user_id' AND a.atttypid = 'uuid'::pg_catalog.regtype AND NOT a.attisdropped) AS owner_uuid,
  (SELECT count(*)::integer FROM pg_catalog.pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
  (SELECT count(*)::integer FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid) AS policies,
  (SELECT count(*)::integer FROM pg_catalog.pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'f') AS foreign_keys
FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS wanted(name, position)
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_class c ON c.relnamespace = n.oid AND c.relname = wanted.name AND c.relkind = 'r'
ORDER BY wanted.position`;
export const SCHEMA_FUNCTION_SQL = `
SELECT wanted.name, count(p.oid)::integer AS definitions
FROM pg_catalog.unnest($1::text[]) WITH ORDINALITY AS wanted(name, position)
LEFT JOIN pg_catalog.pg_namespace n ON n.nspname = 'public'
LEFT JOIN pg_catalog.pg_proc p ON p.pronamespace = n.oid AND p.proname = wanted.name
GROUP BY wanted.name, wanted.position ORDER BY wanted.position`;
export const SCHEMA_SHARED_SQL = `
SELECT
  EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = pg_catalog.to_regclass('public.cardio_logs')
      AND a.attname = 'swim_result' AND a.atttypid = 'jsonb'::pg_catalog.regtype AND NOT a.attisdropped) AS swim_result,
  (SELECT CASE
    WHEN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') =
      '7d123bec0bbca374ea5ddad133640d86ff46ee3e36d6b00611a9d8d1d76b4a4d' THEN 'before'
    WHEN pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc, 'UTF8')), 'hex') =
      'cca40717ed9133607ea0706838ed999beea84af6a90336c66f61abe8b1690b3d' THEN 'after'
    ELSE 'different' END FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.complete_training_session_with_transition(uuid,text,uuid)')) AS completion_body,
  (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', k.conname, 'deferrable', k.condeferrable, 'deferred', k.condeferred,
    'validated', k.convalidated, 'deleteAction', k.confdeltype) ORDER BY k.conname)
    FROM pg_catalog.pg_constraint k
    WHERE k.connamespace = pg_catalog.to_regnamespace('public') AND k.contype = 'f'
      AND ((k.conname = 'set_logs_movement_id_fkey' AND k.conrelid = pg_catalog.to_regclass('public.set_logs'))
        OR (k.conname = 'session_movements_movement_id_fkey' AND k.conrelid = pg_catalog.to_regclass('public.session_movements')))) AS movement_keys`;

export function productionSchemaInventory(tables: unknown, functions: unknown, shared: unknown) {
  const count = z.number().int().min(0).max(128);
  const tableRows = z.array(z.object({
    name: z.enum(SWIM_SCHEMA_TABLES), present: z.boolean(), rls: z.boolean().nullable(),
    forced: z.boolean().nullable(), owner_uuid: z.boolean(), columns: count, policies: count, foreign_keys: count,
  }).strict()).length(SWIM_SCHEMA_TABLES.length).safeParse(tables);
  const functionRows = z.array(z.object({ name: z.enum(SWIM_SCHEMA_FUNCTIONS), definitions: count }).strict())
    .length(SWIM_SCHEMA_FUNCTIONS.length).safeParse(functions);
  const sharedRow = z.array(z.object({
    swim_result: z.boolean(), completion_body: z.enum(["before", "after", "different"]).nullable(),
    movement_keys: z.array(z.object({
      name: z.enum(["session_movements_movement_id_fkey", "set_logs_movement_id_fkey"]),
      deferrable: z.boolean(), deferred: z.boolean(), validated: z.boolean(), deleteAction: z.enum(["a", "r", "c", "n", "d"]),
    }).strict()).max(2).nullable(),
  }).strict()).length(1).safeParse(shared);
  requireInspection(tableRows.success && functionRows.success && sharedRow.success, "schema_inventory_shape");
  requireInspection(tableRows.data.every((entry, index) => entry.name === SWIM_SCHEMA_TABLES[index]) &&
    functionRows.data.every((entry, index) => entry.name === SWIM_SCHEMA_FUNCTIONS[index]), "schema_inventory_shape");
  return { tables: tableRows.data, functions: functionRows.data, shared: sharedRow.data[0]!, compatibilityVerified: false };
}
