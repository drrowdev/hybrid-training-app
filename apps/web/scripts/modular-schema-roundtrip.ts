import { z } from "zod";
import { acceptanceAssert as assert } from "./swim-acceptance-errors";
import { requireProcess, type ProcessResult } from "./swim-acceptance-guards";

export const MODULAR_SCHEMA_FILES = {
  down: "packages/db/rollbacks/0156_modular_training_schedule.down.sql",
  up: "packages/db/drizzle/0156_modular_training_schedule.sql",
} as const;

export const MODULAR_CATALOG_SQL = `
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL search_path = pg_catalog, public;
WITH entries AS (
  SELECT 'function' AS kind, p.oid::regprocedure::text AS key,
    jsonb_build_array(pg_get_functiondef(p.oid), p.proowner::regrole::text, p.proacl IS NULL,
      (SELECT jsonb_agg(jsonb_build_array(a.grantor, a.grantee, a.privilege_type, a.is_grantable)
        ORDER BY a.grantor, a.grantee, a.privilege_type, a.is_grantable)
       FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a)) AS value
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind='f'
  UNION ALL
  SELECT 'trigger', c.oid::regclass::text || ':' || t.tgname,
    jsonb_build_array(pg_get_triggerdef(t.oid, false), t.tgenabled)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'check', c.oid::regclass::text || ':' || k.conname,
    jsonb_build_array(pg_get_constraintdef(k.oid, false), k.convalidated, k.connoinherit)
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND k.contype='c'
)
SELECT jsonb_build_object(
  'functions', count(*) FILTER (WHERE kind='function'),
  'triggers', count(*) FILTER (WHERE kind='trigger'),
  'sha256', encode(sha256(convert_to(jsonb_agg(jsonb_build_array(kind,key,value) ORDER BY kind,key)::text,'UTF8')),'hex')
) FROM entries;
ROLLBACK;`;

const catalogueSchema = z.object({
  functions: z.number().int().min(1).max(1024),
  triggers: z.number().int().min(1).max(1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Catalogue = z.infer<typeof catalogueSchema>;
type Command = (executable: string, args: string[], options: {
  capture: true; allowFailure: true; timeout: number;
}) => Promise<{ text: string; result: ProcessResult }>;
export type ModularRoundTripProof = {
  before: Catalogue | null;
  after: Catalogue | null;
  down: "not-attempted" | "running" | "completed" | "aborted";
  up: "not-attempted" | "running" | "completed" | "aborted";
  restored: boolean;
};
export const createModularRoundTripProof = (): ModularRoundTripProof => ({
  before: null, after: null, down: "not-attempted", up: "not-attempted", restored: false,
});

export async function modularSchemaRoundTrip(options: {
  phase: "down" | "up"; command: Command; dbId: string; proof: ModularRoundTripProof;
  verifiedSql: (file: typeof MODULAR_SCHEMA_FILES[keyof typeof MODULAR_SCHEMA_FILES]) => string;
}) {
  const { phase, command, dbId, proof } = options;
  assert(/^[a-f0-9]{64}$/.test(dbId), "Owned database container required");
  const args = (sql: string) => ["exec", "-e", "PGOPTIONS=-c statement_timeout=30s -c lock_timeout=5s", dbId,
    "psql", "-XqAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", sql];
  const snapshot = async () => {
    const response = await command("docker", args(MODULAR_CATALOG_SQL),
      { capture: true, allowFailure: true, timeout: 10_000 });
    requireProcess(response.result);
    assert(response.text.length <= 1024, "Modular catalogue output bound");
    return catalogueSchema.parse(JSON.parse(response.text));
  };
  if (phase === "down") {
    assert(proof.down === "not-attempted" && proof.up === "not-attempted" && proof.before === null,
      "Modular down already attempted");
    proof.before = await snapshot();
  } else {
    assert(proof.down === "completed" && proof.up === "not-attempted" && proof.before !== null,
      "Modular restoration requires one completed unused down");
  }
  const sql = options.verifiedSql(MODULAR_SCHEMA_FILES[phase]);
  assert(sql.length > 0 && Buffer.byteLength(sql, "utf8") <= 2 * 1024 * 1024, "Modular SQL source bound");
  proof[phase] = "running";
  try {
    const response = await command("docker", args(sql), { capture: true, allowFailure: true, timeout: 30_000 });
    requireProcess(response.result);
    proof[phase] = "completed";
  } catch (error) {
    proof[phase] = "aborted";
    throw error;
  }
  if (phase === "up") {
    proof.after = await snapshot();
    assert(JSON.stringify(proof.after) === JSON.stringify(proof.before), "Modular schema restoration mismatch");
    proof.restored = true;
  }
}
