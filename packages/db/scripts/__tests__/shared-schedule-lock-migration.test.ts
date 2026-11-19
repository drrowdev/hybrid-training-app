import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replaceAll("\r\n", "\n");
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("DC-R5: schedule reads share the per-user lock", () => {
  const up = read("../../drizzle/0168_shared_schedule_snapshot_lock.sql");
  const down = read("../../rollbacks/0168_shared_schedule_snapshot_lock.down.sql");
  const snapshotLock = "PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:' || u::text, 0));";
  const saveLock = "PERFORM pg_advisory_xact_lock(hashtextextended('program-deploy:'||u::text,0));";

  it("rewrites the one lock statement each function carries today", () => {
    const snapshot = read("../../drizzle/0156_modular_training_schedule.sql").split("CREATE FUNCTION public.training_schedule_snapshot()")[1]!.split("REVOKE ALL")[0]!;
    const save = read("../../drizzle/0159_prescription_edit_revisions.sql").split("CREATE FUNCTION public.save_prescription_if_current(")[1]!.split("REVOKE ALL")[0]!;
    expect(count(snapshot, snapshotLock)).toBe(1);
    expect(count(save, saveLock)).toBe(1);
    expect(count(up, snapshotLock)).toBe(1);
    expect(count(up, saveLock)).toBe(2);
  });

  it("makes only the snapshot a shared reader and bounds both waits", () => {
    expect(count(up, "pg_advisory_xact_lock_shared(")).toBe(1);
    expect(count(up, "set_config('lock_timeout', '5s', true)")).toBe(2);
    expect(up).toContain("attributes changed");
  });

  it("restores both original statements", () => {
    expect(count(down, snapshotLock)).toBe(1);
    expect(count(down, saveLock)).toBe(2);
    expect(count(down, "pg_advisory_xact_lock_shared(")).toBe(1);
  });
});
