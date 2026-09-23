import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { acceptanceAssert as assert } from "../../scripts/swim-acceptance-errors";
import { requireBrowserEnvironment } from "../../scripts/swim-browser-acceptance";

export const MODULAR_LEGACY_FILE = "modular-legacy.json";
export const modularLegacySchema = z.object({
  version: z.literal(1),
  run: z.string().regex(/^swim-acceptance-pr802-[1-9][0-9]*-1$/),
  email: z.string().regex(/^e2e\+[a-f0-9-]{36}@hta-e2e\.com$/),
  password: z.string().uuid(),
  userId: z.string().uuid(),
  blockId: z.string().uuid(),
  instanceId: z.string().uuid(),
  plannedIds: z.array(z.string().uuid()).length(2).refine((ids) => new Set(ids).size === 2),
  sessionId: z.string().uuid(),
  setId: z.string().uuid(),
  beforeSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ModularLegacyFixture = z.infer<typeof modularLegacySchema>;

export const legacyGraphColumns = {
  training_blocks: "id,user_id,program_id,program_family,status,started_on,weeks,days_per_week,day_index_overrides,deleted_at",
  program_instances: "id,user_id,block_id,program_id,program_family,status,instance,setup_input,deleted_at",
  planned_sessions: "id,user_id,block_id,week_index,day_index,slot,title,role,prescription,completed_session_id",
  sessions: "id,user_id,title,prescription,performed_at,completed_at,notes",
} as const;
export const legacyRowsSchema = z.array(z.object({ id: z.string().uuid() }).passthrough());

export async function legacyGraphSnapshot(actor: SupabaseClient, userId: string) {
  const result: Record<string, Array<{ id: string; [key: string]: unknown }>> = {};
  for (const [table, projection] of Object.entries(legacyGraphColumns)) {
    const response = await actor.from(table).select(projection).eq("user_id", userId).order("id");
    assert(response.error === null, "Legacy owned graph read failed");
    result[table] = legacyRowsSchema.parse(response.data);
  }
  assert(result.training_blocks!.length === 1 && result.program_instances!.length === 1 &&
    result.planned_sessions!.length === 2 && result.sessions!.length === 1, "Legacy graph inventory mismatch");
  const sets = await actor.from("set_logs").select("id,session_id,movement_id,set_index,weight_kg,reps,prescription_item_index")
    .eq("session_id", result.sessions![0]!.id).order("id");
  assert(sets.error === null, "Legacy owned result read failed");
  result.set_logs = legacyRowsSchema.length(1).parse(sets.data);
  return { rows: result, sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex") };
}

export function readModularLegacyFixture(): ModularLegacyFixture {
  const paths = requireBrowserEnvironment(process.env);
  assert(process.platform === "linux" && process.env.SXC_ACCEPTANCE_PROFILE === "modular",
    "Disposable modular legacy fixture required");
  const directory = lstatSync(paths.runDirectory);
  assert(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid?.() &&
    (directory.mode & 0o7777) === 0o700 && realpathSync(paths.runDirectory) === paths.runDirectory,
  "Private legacy fixture directory required");
  const fd = openSync(join(paths.runDirectory, MODULAR_LEGACY_FILE), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o7777) === 0o600 &&
      stat.size > 0 && stat.size <= 4096, "Private legacy fixture required");
    const fixture = modularLegacySchema.parse(JSON.parse(readFileSync(fd, "utf8")));
    assert(fixture.run === basename(paths.runDirectory), "Legacy fixture belongs to another run");
    assert(fstatSync(fd).size === stat.size, "Legacy fixture changed");
    return fixture;
  } finally { closeSync(fd); }
}
