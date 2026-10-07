import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const bodyOf = (sql: string, name: string) => {
  const start = sql.search(new RegExp(`CREATE(?: OR REPLACE)? FUNCTION public\\.${name}\\(`));
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start).split("AS $$")[1]!.split("$$")[0]!;
};

describe("DC-R5/DC-R6: start-date patches retain current ownership guards", () => {
  it("pins all four actual baselines, including prior function-only patches", () => {
    const original = read("../../drizzle/0144_atomic_user_workflows.sql");
    const schedule = read("../../drizzle/0156_modular_training_schedule.sql");
    const ownership = read("../../drizzle/0158_independent_program_ownership.sql");
    const resume = read("../../drizzle/0162_resume_ended_program.sql");
    const up = read("../../drizzle/0164_authored_program_start_date.sql");
    const down = read("../../rollbacks/0164_authored_program_start_date.down.sql");
    const prefix = ownership.split("('public.update_program_instance_atomically(")[1]!
      .match(/E'((?:''|[^'])*)'/)![1]!.replaceAll("''", "'").replaceAll("\\n", "\n");
    const update = bodyOf(original, "update_program_instance_atomically").replace(/\bBEGIN\b/, "BEGIN" + prefix);
    expect(update).toContain("typed programs never overwrite an account loading percentage");
    const snapshotPatch = ownership.slice(ownership.indexOf("DECLARE routine oid:=to_regprocedure('public.training_schedule_snapshot()')"));
    const snapshot = bodyOf(schedule, "training_schedule_snapshot")
      .replace(snapshotPatch.split("$old$")[1]!, snapshotPatch.split("$new$")[1]!);
    const commit = bodyOf(schedule, "training_schedule_commit")
      .replace("    WHEN 'primary-end' THEN", resume.split("$resume$")[1]!);
    for (const [name, body] of [
      ["update_program_instance_atomically", update],
      ["independent_program_schedule_commit", bodyOf(ownership, "independent_program_schedule_commit")],
      ["training_schedule_commit", commit],
      ["training_schedule_snapshot", snapshot],
    ]) {
      const fingerprint = createHash("md5").update(body!).digest("hex");
      for (const sql of [up, down]) expect(sql, name).toContain(`'${fingerprint}'`);
    }
    expect(up).not.toMatch(/\b(?:GRANT|REVOKE|ALTER TABLE|CREATE TABLE)\b/);
    expect(down).not.toMatch(/\b(?:DELETE FROM|UPDATE public\.)/);
  });
});
