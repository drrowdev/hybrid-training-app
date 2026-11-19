import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = new URL("../../drizzle/", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("DC-R5: page reads share the per-user schedule lock", () => {
  const up = read("../../drizzle/0168_shared_schedule_snapshot_lock.sql");
  const down = read("../../rollbacks/0168_shared_schedule_snapshot_lock.down.sql");
  const lock = "PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));";

  it("copies the snapshot, whose lock statement 0156 defines exactly once", () => {
    const snapshot = read("../../drizzle/0156_modular_training_schedule.sql")
      .split("CREATE FUNCTION public.training_schedule_snapshot()")[1]!.split("REVOKE ALL")[0]!;
    expect(count(snapshot, lock)).toBe(1);
    expect(count(up, lock)).toBe(1);
  });

  it("takes the shared lock, bounds the wait and exposes the read to signed-in users only", () => {
    expect(count(up, "pg_advisory_xact_lock_shared(")).toBe(1);
    expect(up).toContain("set_config('lock_timeout', '5s', true)");
    expect(up).toContain("REVOKE ALL ON FUNCTION public.training_schedule_read() FROM PUBLIC, anon;");
    expect(up).toContain("GRANT EXECUTE ON FUNCTION public.training_schedule_read() TO authenticated;");
  });

  it("leaves the pinned snapshot untouched and rolls back by dropping the twin", () => {
    expect(up).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.training_schedule_snapshot/);
    expect(down).toContain("DROP FUNCTION IF EXISTS public.training_schedule_read();");
  });

  it("keeps the twin in step: a later migration that changes the snapshot must update the read too", () => {
    for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql") && file > "0168")) {
      const sql = readFileSync(new URL(name, dir), "utf8");
      if (sql.includes("training_schedule_snapshot")) expect(sql, name).toContain("training_schedule_read");
    }
  });
});
